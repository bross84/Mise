import asyncio
import os
import re
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
import httpx
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.ingredient import Ingredient
from app.models.blocked_ingredient import BlockedIngredient
from app.schemas.ingredient import IngredientCreate, IngredientUpdate, IngredientResponse
from app.services import nutrition

router = APIRouter(prefix="/api/ingredients", tags=["ingredients"])


class SearchResult(BaseModel):
    """One search hit. Macros are always per 100 g; they are None when the source did not
    provide one complete set (see `incomplete_reason`) and the food needs manual entry."""
    name: str
    calories: float | None = None
    protein: float | None = None
    carbs: float | None = None
    fat: float | None = None
    unit: str = "per 100g"
    source: str
    serving_grams: float | None = None
    barcode: str | None = None
    ingredient_id: int | None = None
    source_url: str | None = None
    source_id: str | None = None
    nutrition_complete: bool = True
    incomplete_reason: str | None = None
    converted_from_serving: bool = False


class BlockRequest(BaseModel):
    name: str
    source: str
    source_id: str


class BlockedResponse(BaseModel):
    id: int
    name: str
    source: str
    source_id: str

    model_config = {"from_attributes": True}


class SearchResponse(BaseModel):
    results: list[SearchResult]


def _round(value: float | None) -> float:
    if value is None:
        return 0.0
    return round(float(value), 1)


# USDA portions like "1 cup" or "1 tbsp" describe volume, not a countable piece, so they must
# not become the serving weight.
_VOLUME_PORTION_RE = re.compile(
    r"\b(cups?|tbsp|tablespoons?|tsp|teaspoons?|fl\.? ?oz|fluid|ml|milliliters?|liters?|litres?|quarts?|pints?|gallons?)\b",
    re.IGNORECASE,
)


def _usda_serving_grams(food: dict) -> float | None:
    size = nutrition.parse_number(food.get("servingSize"))
    unit = str(food.get("servingSizeUnit") or "").strip().lower()
    if size and unit in ("g", "grm", "gram", "grams"):
        return round(size, 1)
    for portion in (food.get("foodPortions") or []):
        grams = nutrition.parse_number(portion.get("gramWeight"))
        if not grams:
            continue
        measure = portion.get("measureUnit")
        label = " ".join([
            str(portion.get("portionDescription") or ""),
            str(portion.get("modifier") or ""),
            str(measure.get("name") or "") if isinstance(measure, dict) else "",
        ])
        if _VOLUME_PORTION_RE.search(label):
            continue
        return round(grams, 1)
    return None


def _off_serving_grams(product: dict) -> float | None:
    import re

    def _extract_grams(s: str) -> float | None:
        if not s:
            return None
        # parenthesised value first: "0.66 cup (170 g)" → 170
        m = re.search(r"\(\s*([\d.]+)\s*g\s*\)", s, re.IGNORECASE)
        if m:
            return round(float(m.group(1)), 1)
        # bare grams: "170 g" or "170g"
        m = re.search(r"^\s*([\d.]+)\s*g\s*$", s, re.IGNORECASE)
        if m:
            return round(float(m.group(1)), 1)
        return None

    # 1. serving_size string
    v = _extract_grams(product.get("serving_size") or "")
    if v is not None:
        return v

    # 2. nutriments.serving_size string
    v = _extract_grams((product.get("nutriments") or {}).get("serving_size") or "")
    if v is not None:
        return v

    # 3. serving_quantity plain number (already grams)
    sq = product.get("serving_quantity")
    if sq:
        try:
            return round(float(sq), 1)
        except (ValueError, TypeError):
            pass

    return None


def _macro_fields(selection: "nutrition.MacroSelection") -> dict:
    if selection.macros is None:
        return {
            "calories": None, "protein": None, "carbs": None, "fat": None,
            "nutrition_complete": False, "incomplete_reason": selection.reason,
        }
    return {**selection.macros, "nutrition_complete": True, "converted_from_serving": selection.converted_from_serving}


_USDA_ENERGY_NAMES = ("Energy", "Energy (Atwater General Factors)", "Energy (Atwater Specific Factors)")
_USDA_NUTRIENT_NAMES = {
    "protein": ("Protein",),
    "carbs": ("Carbohydrate, by difference", "Carbohydrate, by summation"),
    "fat": ("Total lipid (fat)", "Total fat (NLEA)"),
}


def _usda_per_100g(food: dict) -> dict:
    """USDA foodNutrients are per 100 g. A missing nutrient stays None (it is not 0)."""
    entries = [n for n in (food.get("foodNutrients") or []) if isinstance(n, dict)]

    def lookup(names: tuple[str, ...], unit: str | None = None) -> float | None:
        for name in names:
            for entry in entries:
                if entry.get("nutrientName") != name:
                    continue
                if unit and str(entry.get("unitName") or "").upper() != unit:
                    continue
                value = nutrition.parse_number(entry.get("value"))
                if value is not None:
                    return value
        return None

    calories = lookup(_USDA_ENERGY_NAMES, "KCAL")
    if calories is None:
        kilojoules = lookup(_USDA_ENERGY_NAMES, "KJ")
        calories = kilojoules / 4.184 if kilojoules is not None else None
    return {"calories": calories, **{key: lookup(names) for key, names in _USDA_NUTRIENT_NAMES.items()}}


def _usda_per_serving(food: dict) -> dict:
    """Branded foods may list label (per-serving) values under labelNutrients."""
    label = food.get("labelNutrients") or {}

    def value(key: str) -> float | None:
        entry = label.get(key)
        return nutrition.parse_number(entry.get("value")) if isinstance(entry, dict) else None

    return {"calories": value("calories"), "protein": value("protein"), "carbs": value("carbohydrates"), "fat": value("fat")}


def _parse_usda(data: dict) -> list[SearchResult]:
    results = []
    for food in (data.get("foods") or [])[:15]:
        fdc_id = str(food.get("fdcId") or "")
        serving_grams = _usda_serving_grams(food)
        selection = nutrition.pick_macro_set(_usda_per_100g(food), _usda_per_serving(food), serving_grams)
        results.append(SearchResult(
            name=food.get("description", "Unknown"),
            **_macro_fields(selection),
            source="usda",
            serving_grams=serving_grams,
            source_id=fdc_id or None,
            source_url=f"https://fdc.nal.usda.gov/food-details/{fdc_id}/nutrients" if fdc_id else None,
        ))
    return results


def _off_energy_kcal(nutriments: dict, suffix: str) -> float | None:
    kilocalories = nutrition.parse_number(nutriments.get(f"energy-kcal_{suffix}"))
    if kilocalories is not None:
        return kilocalories
    kilojoules = nutrition.parse_number(nutriments.get(f"energy_{suffix}"))
    return kilojoules / 4.184 if kilojoules is not None else None


def _off_macro_set(nutriments: dict, suffix: str) -> dict:
    """suffix is "100g" or "serving"; every value in the set is for that same basis."""
    return {
        "calories": _off_energy_kcal(nutriments, suffix),
        "protein": nutrition.parse_number(nutriments.get(f"proteins_{suffix}")),
        "carbs": nutrition.parse_number(nutriments.get(f"carbohydrates_{suffix}")),
        "fat": nutrition.parse_number(nutriments.get(f"fat_{suffix}")),
    }


def _parse_off(data: dict) -> list[SearchResult]:
    results = []
    for product in (data.get("products") or [])[:15]:
        nutriments = product.get("nutriments") or {}
        name = product.get("product_name") or product.get("generic_name") or ""
        if not name.strip():
            continue
        serving_grams = _off_serving_grams(product)
        selection = nutrition.pick_macro_set(
            _off_macro_set(nutriments, "100g"), _off_macro_set(nutriments, "serving"), serving_grams,
        )

        barcode = str(product.get("code") or "").strip() or None
        results.append(SearchResult(
            name=name.strip(),
            **_macro_fields(selection),
            source="openfoodfacts",
            serving_grams=serving_grams,
            barcode=barcode,
            source_id=barcode,
            source_url=f"https://world.openfoodfacts.org/product/{barcode}" if barcode else None,
        ))
    return results


@router.get("/search", response_model=SearchResponse)
async def search_ingredients(
    q: str,
    include_external: bool = True,
    external_source: str | None = Query(default=None, pattern="^(usda|openfoodfacts)$"),
    db: Session = Depends(get_db),
):
    if not q.strip():
        return SearchResponse(results=[])

    blocked_rows = db.query(BlockedIngredient).all()
    blocked_set: set[tuple[str, str]] = {(b.source, b.source_id) for b in blocked_rows}

    def _filter_blocked(results: list[SearchResult]) -> list[SearchResult]:
        return [r for r in results if not (r.source_id and (r.source, r.source_id) in blocked_set)]

    query_text = q.strip()
    is_barcode = query_text.isdigit() and 8 <= len(query_text) <= 14 and " " not in q
    if is_barcode and (external_source == "openfoodfacts" or include_external):
        off_product_url = f"https://us.openfoodfacts.org/api/v0/product/{query_text}.json"
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                response = await client.get(off_product_url)
            if response.status_code != 200:
                return SearchResponse(results=[])
            data = response.json()
            if data.get("status") != 1 or not data.get("product"):
                return SearchResponse(results=[])
            parsed = _filter_blocked(_parse_off({"products": [data["product"]]}))
            return SearchResponse(results=parsed[:1])
        except Exception:
            return SearchResponse(results=[])

    if external_source not in ("usda", "openfoodfacts"):
        # Local DB first — candidate fetch via any-word ilike, then quality-filtered
        from sqlalchemy import or_
        from rapidfuzz import fuzz as _fuzz

        query_words = set(q.strip().lower().split())
        search_terms = list(query_words)
        filters = [Ingredient.name.ilike(f"%{term}%") for term in search_terms if term]
        query_obj = db.query(Ingredient)
        if filters:
            query_obj = query_obj.filter(or_(*filters))
        candidates = query_obj.order_by(Ingredient.name.asc()).limit(50).all()

        def _local_quality(name: str) -> bool:
            nl = name.lower()
            # Require ≥60% of query words to appear in the ingredient name
            name_words = set(nl.split())
            if query_words and len(query_words & name_words) / len(query_words) >= 0.6:
                return True
            # Fallback: fuzzy similarity ≥70
            return _fuzz.WRatio(q.strip().lower(), nl) >= 70

        local_rows = [r for r in candidates if _local_quality(r.name)][:15]

        if local_rows:
            return SearchResponse(results=_filter_blocked([
                SearchResult(
                    name=row.name,
                    calories=_round(row.calories),
                    protein=_round(row.protein),
                    carbs=_round(row.carbs),
                    fat=_round(row.fat),
                    unit=row.unit,
                    source="local",
                    barcode=row.barcode,
                    serving_grams=row.serving_grams,
                    ingredient_id=row.id,
                )
                for row in local_rows
            ]))

    if not include_external:
        return SearchResponse(results=[])

    # Fallback — USDA + OFF (only when local has no matches)
    usda_url = "https://api.nal.usda.gov/fdc/v1/foods/search"
    off_url = "https://us.openfoodfacts.org/cgi/search.pl"
    usda_api_key = os.getenv("USDA_API_KEY") or os.getenv("FDC_API_KEY") or "DEMO_KEY"

    async with httpx.AsyncClient(timeout=8.0) as client:
        request_specs: list[tuple[str, asyncio.Future]] = []
        if external_source in (None, "usda"):
            request_specs.append(("usda", client.get(usda_url, params={"query": q, "pageSize": 15, "api_key": usda_api_key})))
        if external_source in (None, "openfoodfacts"):
            request_specs.append(("openfoodfacts", client.get(off_url, params={
                "search_terms": q, "search_simple": 1, "action": "process", "json": 1, "page_size": 15
            })))
        responses = await asyncio.gather(*(req for _, req in request_specs), return_exceptions=True)

    usda_results: list[SearchResult] = []
    off_results: list[SearchResult] = []

    for (source_name, _), response in zip(request_specs, responses):
        if not (isinstance(response, httpx.Response) and response.status_code == 200):
            continue
        try:
            if source_name == "usda":
                usda_results = _parse_usda(response.json())
            elif source_name == "openfoodfacts":
                off_results = _parse_off(response.json())
        except Exception:
            pass

    def _dedup_by_fdc_id(results: list[SearchResult]) -> list[SearchResult]:
        seen_ids: set[str] = set()
        out: list[SearchResult] = []
        for r in results:
            key = r.source_id or r.name.lower().strip()
            if key in seen_ids:
                continue
            seen_ids.add(key)
            out.append(r)
        return out

    if external_source == "usda":
        return SearchResponse(results=_filter_blocked(_dedup_by_fdc_id(usda_results))[:15])
    if external_source == "openfoodfacts":
        return SearchResponse(results=_filter_blocked(_dedup_by_fdc_id(off_results))[:15])

    # USDA first, then OFF; dedup by source_id (fdcId / barcode), cap at 15
    merged = _dedup_by_fdc_id(usda_results + off_results)[:15]
    return SearchResponse(results=_filter_blocked(merged))


@router.post("/block", response_model=BlockedResponse, status_code=201)
def block_ingredient(data: BlockRequest, db: Session = Depends(get_db)):
    existing = db.query(BlockedIngredient).filter(
        BlockedIngredient.source == data.source,
        BlockedIngredient.source_id == data.source_id,
    ).first()
    if existing:
        return existing
    blocked = BlockedIngredient(name=data.name, source=data.source, source_id=data.source_id)
    db.add(blocked)
    db.commit()
    db.refresh(blocked)
    return blocked


@router.get("/blocked", response_model=list[BlockedResponse])
def list_blocked(db: Session = Depends(get_db)):
    return db.query(BlockedIngredient).order_by(BlockedIngredient.created_at.desc()).all()


@router.delete("/blocked/{blocked_id}")
def unblock_ingredient(blocked_id: int, db: Session = Depends(get_db)):
    blocked = db.query(BlockedIngredient).filter(BlockedIngredient.id == blocked_id).first()
    if not blocked:
        raise HTTPException(status_code=404, detail="Blocked ingredient not found")
    db.delete(blocked)
    db.commit()
    return {"deleted": True}


class AuditItem(BaseModel):
    id: int
    name: str
    source: str | None = None
    unit: str | None = None
    calories: float
    protein: float
    carbs: float
    fat: float
    serving_grams: float | None = None
    serving_quantity: int | None = None
    expected_calories: float | None = None
    delta_pct: float | None = None


class AuditResponse(BaseModel):
    tolerance: float
    total: int
    calorie_mismatch: list[AuditItem]
    non_standard_basis: list[AuditItem]
    missing_serving_weight: list[AuditItem]


def _audit_item(row: Ingredient, **extra) -> AuditItem:
    return AuditItem(
        id=row.id, name=row.name, source=row.source, unit=row.unit,
        calories=row.calories, protein=row.protein, carbs=row.carbs, fat=row.fat,
        serving_grams=row.serving_grams, serving_quantity=row.serving_quantity, **extra,
    )


@router.get("/audit", response_model=AuditResponse)
def audit_ingredients(
    tolerance: float = Query(default=nutrition.CALORIE_TOLERANCE, ge=0, le=1),
    db: Session = Depends(get_db),
):
    """Foods to review. Read-only: nothing is changed.

    - calorie_mismatch: calories are not within `tolerance` of 4*protein + 4*carbs + 9*fat.
      Worst offenders first.
    - non_standard_basis: `unit` is not "per 100g", so the macros may be for a serving or
      another amount. The calorie check cannot see this, because the numbers can still agree
      with each other.
    - missing_serving_weight: pieces per serving is above 1 but no serving weight is known,
      so amounts in pieces cannot be converted.
    """
    rows = db.query(Ingredient).order_by(Ingredient.name.asc()).all()
    mismatched: list[tuple[float, AuditItem]] = []
    non_standard: list[AuditItem] = []
    missing_weight: list[AuditItem] = []

    for row in rows:
        check = nutrition.check_calories(row.calories, row.protein, row.carbs, row.fat, tolerance)
        if not check.ok:
            severity = abs(check.delta_pct) if check.delta_pct is not None else float("inf")
            mismatched.append((severity, _audit_item(row, expected_calories=check.expected, delta_pct=check.delta_pct)))
        if not nutrition.is_standard_unit(row.unit):
            non_standard.append(_audit_item(row))
        if (row.serving_quantity or 1) > 1 and nutrition.serving_weight(row.unit, row.serving_grams) is None:
            missing_weight.append(_audit_item(row))

    mismatched.sort(key=lambda pair: pair[0], reverse=True)
    return AuditResponse(
        tolerance=tolerance,
        total=len(rows),
        calorie_mismatch=[item for _, item in mismatched],
        non_standard_basis=non_standard,
        missing_serving_weight=missing_weight,
    )


@router.get("", response_model=list[IngredientResponse])
def list_ingredients(db: Session = Depends(get_db)):
    return db.query(Ingredient).order_by(Ingredient.name.asc()).all()


@router.get("/{ingredient_id}", response_model=IngredientResponse)
def get_ingredient(ingredient_id: int, db: Session = Depends(get_db)):
    ingredient = db.query(Ingredient).filter(Ingredient.id == ingredient_id).first()
    if not ingredient:
        raise HTTPException(status_code=404, detail="Ingredient not found")
    return ingredient


def _calorie_mismatch_409(values: dict) -> HTTPException:
    check = nutrition.check_calories(values["calories"], values["protein"], values["carbs"], values["fat"])
    if check.expected > 0:
        message = (
            f"Calories don't match the macros: {values['calories']:g} kcal entered, but "
            f"4\u00d7protein + 4\u00d7carbs + 9\u00d7fat = {check.expected:g} kcal "
            f"({check.delta_pct:+.0f}%)."
        )
    else:
        message = f"Calories are {values['calories']:g} kcal but the protein, carbs and fat add up to 0 kcal."
    return HTTPException(status_code=409, detail={
        "code": "calorie_mismatch",
        "message": message,
        "calories": values["calories"],
        "expected_calories": check.expected,
        "delta_pct": check.delta_pct,
    })


def _convert_per_serving(values: dict, serving_grams: float | None) -> dict:
    if not serving_grams or serving_grams <= 0:
        raise HTTPException(status_code=422, detail="Serving weight (g) is required when values are per serving.")
    return {**values, **nutrition.per_serving_to_per_100g(values, serving_grams), "serving_grams": serving_grams}


@router.post("", response_model=IngredientResponse, status_code=201)
def create_ingredient(data: IngredientCreate, db: Session = Depends(get_db)):
    existing = db.query(Ingredient).filter(Ingredient.name.ilike(data.name)).first()
    if existing:
        # Idempotent update: preserve existing record but backfill barcode when provided
        if data.barcode and not existing.barcode:
            existing.barcode = data.barcode
            db.commit()
            db.refresh(existing)
        return existing

    values = data.model_dump(exclude={"nutrition_basis", "override_calorie_check"})
    if data.nutrition_basis == "per_serving":
        values = _convert_per_serving(values, data.serving_grams)
    # Everything is stored per 100 g, whatever basis it arrived in.
    values["unit"] = nutrition.STANDARD_UNIT
    values["serving_quantity"] = max(int(values.get("serving_quantity") or 1), 1)
    if values.get("serving_grams") is not None and values["serving_grams"] <= 0:
        values["serving_grams"] = None

    if not data.override_calorie_check and not nutrition.check_calories(
        values["calories"], values["protein"], values["carbs"], values["fat"],
    ).ok:
        raise _calorie_mismatch_409(values)

    ingredient = Ingredient(**values)
    db.add(ingredient)
    db.commit()
    db.refresh(ingredient)
    return ingredient


@router.patch("/{ingredient_id}", response_model=IngredientResponse)
def update_ingredient(ingredient_id: int, data: IngredientUpdate, db: Session = Depends(get_db)):
    ingredient = db.query(Ingredient).filter(Ingredient.id == ingredient_id).first()
    if not ingredient:
        raise HTTPException(status_code=404, detail="Ingredient not found")

    changes = data.model_dump(exclude_unset=True)
    basis = changes.pop("nutrition_basis", None)
    override = changes.pop("override_calorie_check", False)

    if basis == "per_serving":
        supplied = {key: changes.get(key) for key in nutrition.MACRO_KEYS}
        if any(value is None for value in supplied.values()):
            raise HTTPException(status_code=422, detail="Calories, protein, carbs and fat are all required for per-serving values.")
        changes.update(_convert_per_serving(supplied, changes.get("serving_grams", ingredient.serving_grams)))
    if basis is not None:
        # The macros in this request were declared per 100 g (or were just converted to it).
        changes["unit"] = nutrition.STANDARD_UNIT
    if "serving_quantity" in changes:
        changes["serving_quantity"] = max(int(changes["serving_quantity"] or 1), 1)
    if changes.get("serving_grams") is not None and changes["serving_grams"] <= 0:
        changes["serving_grams"] = None

    # Only re-check when the macros are being edited, so renaming a food that already fails
    # the check is never blocked.
    if not override and any(key in changes for key in nutrition.MACRO_KEYS):
        merged = {key: changes.get(key, getattr(ingredient, key)) for key in nutrition.MACRO_KEYS}
        if not nutrition.check_calories(**merged).ok:
            raise _calorie_mismatch_409(merged)

    for field, value in changes.items():
        setattr(ingredient, field, value)
    db.commit()
    db.refresh(ingredient)
    return ingredient


@router.delete("/{ingredient_id}")
def delete_ingredient(ingredient_id: int, db: Session = Depends(get_db)):
    ingredient = db.query(Ingredient).filter(Ingredient.id == ingredient_id).first()
    if not ingredient:
        raise HTTPException(status_code=404, detail="Ingredient not found")
    db.delete(ingredient)
    db.commit()
    return {"deleted": True}
