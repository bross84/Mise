import asyncio
import os
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
import httpx
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.ingredient import Ingredient
from app.schemas.ingredient import IngredientCreate, IngredientUpdate, IngredientResponse

router = APIRouter(prefix="/api/ingredients", tags=["ingredients"])


class SearchResult(BaseModel):
    name: str
    calories: float
    protein: float
    carbs: float
    fat: float
    unit: str = "per 100g"
    source: str
    serving_grams: float | None = None
    barcode: str | None = None
    ingredient_id: int | None = None


class SearchResponse(BaseModel):
    results: list[SearchResult]


def _round(value: float | None) -> float:
    if value is None:
        return 0.0
    return round(float(value), 1)


def _usda_serving_grams(food: dict) -> float | None:
    for portion in (food.get("foodPortions") or []):
        grams = portion.get("gramWeight")
        if grams:
            return round(float(grams), 1)
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


def _parse_usda(data: dict) -> list[SearchResult]:
    results = []
    for food in (data.get("foods") or [])[:15]:
        nutrients = {n["nutrientName"]: n.get("value", 0) for n in (food.get("foodNutrients") or [])}
        results.append(SearchResult(
            name=food.get("description", "Unknown"),
            calories=_round(nutrients.get("Energy") or nutrients.get("Energy (Atwater General Factors)")),
            protein=_round(nutrients.get("Protein")),
            carbs=_round(nutrients.get("Carbohydrate, by difference")),
            fat=_round(nutrients.get("Total lipid (fat)")),
            source="usda",
            serving_grams=_usda_serving_grams(food),
        ))
    return results


def _parse_off(data: dict) -> list[SearchResult]:
    results = []
    for product in (data.get("products") or [])[:15]:
        nutriments = product.get("nutriments") or {}
        name = product.get("product_name") or product.get("generic_name") or ""
        if not name.strip():
            continue
        serving_grams = _off_serving_grams(product)

        calories_serving = nutriments.get("energy-kcal_serving")
        protein_serving = nutriments.get("proteins_serving")
        carbs_serving = nutriments.get("carbohydrates_serving")
        fat_serving = nutriments.get("fat_serving")
        has_serving_macros = any(v is not None for v in [calories_serving, protein_serving, carbs_serving, fat_serving])

        calories_100g = nutriments.get("energy-kcal_100g")
        if calories_100g is None and nutriments.get("energy_100g") is not None:
            calories_100g = nutriments.get("energy_100g") / 4.184
        protein_100g = nutriments.get("proteins_100g")
        carbs_100g = nutriments.get("carbohydrates_100g")
        fat_100g = nutriments.get("fat_100g")

        if has_serving_macros:
            calories = calories_serving
            protein = protein_serving
            carbs = carbs_serving
            fat = fat_serving
            unit = f"per {serving_grams}g" if serving_grams else "per 100g"
        elif serving_grams:
            factor = serving_grams / 100.0
            calories = (float(calories_100g) if calories_100g is not None else 0.0) * factor
            protein = (float(protein_100g) if protein_100g is not None else 0.0) * factor
            carbs = (float(carbs_100g) if carbs_100g is not None else 0.0) * factor
            fat = (float(fat_100g) if fat_100g is not None else 0.0) * factor
            unit = f"per {serving_grams}g"
        else:
            calories = calories_100g
            protein = protein_100g
            carbs = carbs_100g
            fat = fat_100g
            unit = "per 100g"

        results.append(SearchResult(
            name=name.strip(),
            calories=_round(calories),
            protein=_round(protein),
            carbs=_round(carbs),
            fat=_round(fat),
            unit=unit,
            source="openfoodfacts",
            serving_grams=serving_grams,
            barcode=str(product.get("code") or "").strip() or None,
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
        return SearchResponse(results=[
            SearchResult(
                name=row.name,
                calories=_round(row.calories),
                protein=_round(row.protein),
                carbs=_round(row.carbs),
                fat=_round(row.fat),
                unit=row.unit,
                source="local",
                barcode=row.barcode,
                ingredient_id=row.id,
            )
            for row in local_rows
        ])

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

    if external_source == "usda":
        return SearchResponse(results=usda_results[:15])
    if external_source == "openfoodfacts":
        return SearchResponse(results=off_results[:15])

    # USDA first, then OFF; dedup by normalised name, cap at 15
    seen: set[str] = set()
    merged: list[SearchResult] = []
    for result in usda_results + off_results:
        key = result.name.lower().strip()
        if key in seen:
            continue
        seen.add(key)
        merged.append(result)
        if len(merged) == 15:
            break

    return SearchResponse(results=merged)


@router.get("", response_model=list[IngredientResponse])
def list_ingredients(db: Session = Depends(get_db)):
    return db.query(Ingredient).order_by(Ingredient.name.asc()).all()


@router.get("/{ingredient_id}", response_model=IngredientResponse)
def get_ingredient(ingredient_id: int, db: Session = Depends(get_db)):
    ingredient = db.query(Ingredient).filter(Ingredient.id == ingredient_id).first()
    if not ingredient:
        raise HTTPException(status_code=404, detail="Ingredient not found")
    return ingredient


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
    ingredient = Ingredient(**data.model_dump())
    db.add(ingredient)
    db.commit()
    db.refresh(ingredient)
    return ingredient


@router.patch("/{ingredient_id}", response_model=IngredientResponse)
def update_ingredient(ingredient_id: int, data: IngredientUpdate, db: Session = Depends(get_db)):
    ingredient = db.query(Ingredient).filter(Ingredient.id == ingredient_id).first()
    if not ingredient:
        raise HTTPException(status_code=404, detail="Ingredient not found")
    for field, value in data.model_dump(exclude_unset=True).items():
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
