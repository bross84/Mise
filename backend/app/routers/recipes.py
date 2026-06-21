import io
import json
import re
import zipfile
from datetime import date, datetime
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.ingredient import Ingredient
from app.models.recipe import Recipe
from app.schemas.recipe import RecipeCreate, RecipeUpdate, RecipeResponse
from app.services.ai import AIService
from app.services.matching import IngredientMatcher

router = APIRouter(prefix="/api/recipes", tags=["recipes"])

PARSE_SYSTEM_PROMPT = """You are a recipe formatter. Convert the provided recipe text into clean markdown format.
Use exactly this structure:

# Recipe Title

**Servings:** N
**Tags:** tag1, tag2, tag3

## Ingredients
- Xg ingredient name
- Xg ingredient name

## Steps
1. Step content here
2. Step content here

## Notes
Optional notes here

Rules:
- Convert ALL ingredient amounts to grams where possible
- For items that cannot be weighed (e.g. "to taste"), use a reasonable gram estimate
- Generate 2-4 relevant tags
- Keep steps concise but complete
- Return ONLY the markdown, no explanation, no code fences
- Multiple recipes separated by --- in input should each get their own markdown block separated by ---"""


class ParseRequest(BaseModel):
    text: str = ""
    url: Optional[str] = None


class ParseResponse(BaseModel):
    markdown: str


def _extract_jsonld_recipe(html: str) -> Optional[str]:
    """Pull Schema.org Recipe JSON-LD out of a page if present."""
    pattern = re.compile(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        re.DOTALL | re.IGNORECASE,
    )
    for match in pattern.finditer(html):
        try:
            data = json.loads(match.group(1))
            if isinstance(data, dict) and data.get("@graph"):
                data = data["@graph"]
            if isinstance(data, list):
                for item in data:
                    if isinstance(item, dict) and "Recipe" in str(item.get("@type", "")):
                        return json.dumps(item)
            elif isinstance(data, dict) and "Recipe" in str(data.get("@type", "")):
                return json.dumps(data)
        except (json.JSONDecodeError, KeyError):
            continue
    return None


def _slugify(title: str) -> str:
    """Lowercase, spaces → hyphens, strip non-word characters, collapse repeated hyphens."""
    s = (title or "recipe").lower().strip()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[\s_]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s or "recipe"


def _recipe_to_markdown(recipe: Recipe) -> str:
    lines: list[str] = []

    lines.append(f"# {recipe.title or 'Untitled Recipe'}")
    lines.append("")
    lines.append(f"**Servings:** {recipe.servings or 1}")
    lines.append("")

    ingredients = recipe.ingredients or []
    if ingredients:
        lines.append("## Ingredients")
        lines.append("")
        current_group: str | None = None
        for ing in ingredients:
            group = (ing.get("group_name") or "").strip() or None
            if group and group != current_group:
                current_group = group
                lines.append(f"### {group}")
                lines.append("")
            amount_raw = ing.get("amount")
            unit = (ing.get("unit") or "").strip()
            name = (ing.get("name") or "").strip()
            parts: list[str] = []
            if amount_raw is not None:
                try:
                    amt = float(amount_raw)
                    if amt > 0:
                        parts.append(str(int(amt)) if amt == int(amt) else str(amt))
                except (ValueError, TypeError):
                    pass
            if unit:
                parts.append(unit)
            if name:
                parts.append(name)
            lines.append(f"- {' '.join(parts)}" if parts else f"- {name}")
        lines.append("")

    if recipe.instructions:
        lines.append("## Instructions")
        lines.append("")
        lines.append(recipe.instructions.strip())
        lines.append("")

    if recipe.notes:
        lines.append("## Notes")
        lines.append("")
        lines.append(recipe.notes.strip())
        lines.append("")

    tags = recipe.tags or []
    if tags:
        lines.append(f"**Tags:** {', '.join(tags)}")
    if recipe.source_url:
        lines.append(f"**Source:** {recipe.source_url}")

    return "\n".join(lines).strip() + "\n"


@router.post("/parse", response_model=ParseResponse)
async def parse_recipe(payload: ParseRequest):
    content = payload.text.strip()

    if payload.url and payload.url.strip():
        try:
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                resp = await client.get(
                    payload.url.strip(),
                    headers={"User-Agent": "Mozilla/5.0 (compatible; MiseRecipeParser/1.0)"},
                )
                resp.raise_for_status()
                html = resp.text
            jsonld = _extract_jsonld_recipe(html)
            content = jsonld if jsonld else html[:12000]
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=422, detail=f"Could not fetch URL: {exc}") from exc

    if not content:
        raise HTTPException(status_code=422, detail="Provide recipe text or a URL.")

    prompt = f"Format the following into recipe markdown:\n\n{content}"
    try:
        markdown = await AIService().complete_with_system(PARSE_SYSTEM_PROMPT, prompt)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    # Strip any accidental code fences
    markdown = re.sub(r"^```(?:markdown)?\s*|\s*```$", "", markdown.strip(), flags=re.MULTILINE).strip()

    return ParseResponse(markdown=markdown)


INGREDIENT_PARSE_SYSTEM_PROMPT = """You are an ingredient parser. Convert ingredient text into a JSON array.

Rules:
- Return ONLY a JSON array, no explanation, no code fences
- One object per ingredient line: {"raw": "original line", "name": "ingredient name", "amount": "quantity as a string or null", "unit": "unit or null", "group_name": "section name or null"}
- Detect section headers (e.g. "***Beef Mix***", "For the Sauce:", "## Marinade") — assign their name as group_name to all following ingredients until the next header
- Skip blank lines and section header lines themselves (they become group_name, not ingredients)
- amount and unit should reflect exactly what is written; use null if not present
- Do not invent amounts or units that are not in the text"""


TAG_GENERATION_SYSTEM_PROMPT = """Based on the recipe name and ingredient list provided, suggest 3-5 short tags describing the recipe.
Draw from: cuisine type, main protein or dish type, and obvious dietary characteristics (e.g. high protein, vegetarian, quick meal).
Rules:
- Return ONLY a JSON array of strings, no explanation, no code fences
- Tags must be lowercase, 1-2 words each
- Example: ["mexican", "ground beef", "high protein", "quick meal"]"""


class ParseIngredientsRequest(BaseModel):
    text: str
    recipe_name: Optional[str] = None


class ParsedIngredientItem(BaseModel):
    raw: str
    name: str
    amount: Optional[str] = None
    unit: Optional[str] = None
    group_name: Optional[str] = None


class ParseIngredientsResponse(BaseModel):
    ingredients: list[ParsedIngredientItem]
    suggested_tags: list[str] = []


@router.post("/parse-ingredients", response_model=ParseIngredientsResponse)
async def parse_ingredients_endpoint(payload: ParseIngredientsRequest):
    import asyncio
    if not payload.text.strip():
        return ParseIngredientsResponse(ingredients=[], suggested_tags=[])

    ingredient_prompt = f"Parse these ingredients:\n\n{payload.text}"
    tag_prompt = (
        f"Recipe name: {payload.recipe_name or 'Unknown'}\n"
        f"Ingredients:\n{payload.text}"
    )

    try:
        ai = AIService()
        ingredient_result, tag_result = await asyncio.gather(
            ai.complete_with_system(INGREDIENT_PARSE_SYSTEM_PROMPT, ingredient_prompt),
            ai.complete_with_system(TAG_GENERATION_SYSTEM_PROMPT, tag_prompt),
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    ingredient_result = re.sub(r"^```(?:json)?\s*|\s*```$", "", ingredient_result.strip(), flags=re.MULTILINE).strip()
    tag_result = re.sub(r"^```(?:json)?\s*|\s*```$", "", tag_result.strip(), flags=re.MULTILINE).strip()

    try:
        data = json.loads(ingredient_result)
        ingredients = [ParsedIngredientItem(**item) for item in data]
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to parse AI ingredient response: {exc}") from exc

    try:
        raw_tags = json.loads(tag_result)
        suggested_tags = [str(t).lower().strip() for t in raw_tags if str(t).strip()] if isinstance(raw_tags, list) else []
    except Exception:
        suggested_tags = []

    return ParseIngredientsResponse(ingredients=ingredients, suggested_tags=suggested_tags)


class MatchIngredientItem(BaseModel):
    name: str
    amount: float = 0
    unit: str = "g"


class MatchIngredientsRequest(BaseModel):
    ingredients: list[MatchIngredientItem]


class MatchResult(BaseModel):
    name: str
    amount: float
    unit: str
    match: Optional[dict] = None


class MatchIngredientsResponse(BaseModel):
    results: list[MatchResult]


@router.post("/match-ingredients", response_model=MatchIngredientsResponse)
async def match_ingredients(payload: MatchIngredientsRequest, db: Session = Depends(get_db)):
    matcher = IngredientMatcher()
    results = []
    for item in payload.ingredients:
        match = await matcher.match(item.name, db)
        results.append(MatchResult(name=item.name, amount=item.amount, unit=item.unit, match=match))
    return MatchIngredientsResponse(results=results)


_UNIT_TO_GRAMS: dict[str, float] = {
    'g': 1.0, 'gram': 1.0, 'grams': 1.0,
    'kg': 1000.0, 'kilogram': 1000.0, 'kilograms': 1000.0,
    'oz': 28.35, 'ounce': 28.35, 'ounces': 28.35,
    'lb': 453.6, 'lbs': 453.6, 'pound': 453.6, 'pounds': 453.6,
    'tsp': 4.0, 'teaspoon': 4.0, 'teaspoons': 4.0,
    'tbsp': 12.0, 'tablespoon': 12.0, 'tablespoons': 12.0,
    'cup': 240.0, 'cups': 240.0,
    'ml': 1.0, 'milliliter': 1.0, 'milliliters': 1.0, 'millilitre': 1.0, 'millilitres': 1.0,
}


# Average whole-piece weights (grams) for common count-based produce.
# Used as a last-resort fallback when unit is absent and serving_grams is unset.
_PRODUCE_WEIGHTS: dict[str, float] = {
    'apple': 182, 'apricot': 35, 'avocado': 150,
    'banana': 118, 'beet': 82, 'bell pepper': 119,
    'broccoli': 91,  # per floret/small head
    'carrot': 61, 'celery': 40,  # per stalk
    'cucumber': 201, 'egg': 50,
    'garlic': 3,  # per clove
    'grapefruit': 246, 'jalapeño': 14, 'jalapeno': 14,
    'kiwi': 69, 'leek': 89, 'lemon': 58, 'lime': 44,
    'mango': 207, 'mushroom': 18,  # per medium mushroom
    'onion': 110, 'orange': 131, 'parsnip': 85,
    'peach': 150, 'pear': 178, 'pepper': 119,
    'plum': 66, 'potato': 150, 'radish': 10,
    'scallion': 15, 'shallot': 30,
    'sweet potato': 130, 'tomato': 123,
    'turnip': 122, 'zucchini': 196,
}


def _count_weight_lookup(ingredient_name: str) -> float | None:
    """Return a fallback gram weight for count-based produce by matching name keywords."""
    name = re.sub(r'[^a-z ]', ' ', ingredient_name.lower())
    name = re.sub(r'\s+', ' ', name).strip()
    # Longest-match first so "bell pepper" beats "pepper"
    for key in sorted(_PRODUCE_WEIGHTS, key=len, reverse=True):
        if key in name:
            return _PRODUCE_WEIGHTS[key]
    return None


_COUNT_UNITS: frozenset[str] = frozenset({'count', 'whole', 'piece', 'pieces', 'item', 'items', 'each'})

def _to_grams(amount: float, unit: str, serving_grams: float | None = None,
              ingredient_name: str = '') -> float | None:
    stripped = unit.lower().strip()
    if stripped and stripped not in _COUNT_UNITS:
        factor = _UNIT_TO_GRAMS.get(stripped)
        return None if factor is None else amount * factor
    # No unit or count-based unit: prefer DB serving_grams, then produce table, else skip
    if serving_grams and serving_grams > 0:
        return amount * serving_grams
    fallback = _count_weight_lookup(ingredient_name)
    if fallback:
        return amount * fallback
    return None


def _reference_grams(db_ing: Ingredient) -> float:
    """Return the gram quantity that db_ing's stored macro values are based on."""
    if db_ing.serving_grams and db_ing.serving_grams > 0:
        return float(db_ing.serving_grams)
    unit = (db_ing.unit or '').lower().strip()
    m = re.match(r'^per\s+([\d.]+)\s*g', unit)
    if m:
        try:
            v = float(m.group(1))
            if v > 0:
                return v
        except ValueError:
            pass
    return 100.0


class MacroValues(BaseModel):
    calories: float
    protein: float
    carbs: float
    fat: float


class IngredientBreakdown(BaseModel):
    recipe_ingredient_id: Optional[str] = None
    name: str
    amount_display: str
    calories: float | None
    protein: float | None
    carbs: float | None
    fat: float | None
    matched: bool


class MacrosResponse(BaseModel):
    per_serving: MacroValues
    total: MacroValues
    servings: int
    matched_count: int
    total_count: int
    breakdown: list[IngredientBreakdown] = []


IMPORT_MARKDOWN_SYSTEM_PROMPT = """You are a recipe data extractor. Given a markdown recipe document, extract the following and return ONLY a JSON object with these exact keys:

{
  "title": "string — the recipe name (required)",
  "servings": integer — number of servings (default 1 if not specified),
  "ingredients_text": "string — all ingredient lines, one per line, preserving any section/group headers exactly as written (e.g. '## Sauce', '**For the marinade:**')",
  "instructions": "string — the full instructions section as markdown, do not summarize, rewrite, or shorten",
  "notes": "string or null — any notes, tips, or storage section; null if absent",
  "tags": ["array of lowercase tag strings if present in the document, otherwise empty array"],
  "source_url": "string or null — source URL if present, otherwise null"
}

If you cannot identify BOTH a clear recipe title AND at least one ingredient line in the document, return instead:
{"error": "brief explanation of what is missing or why this does not appear to be a recipe"}

Return ONLY valid JSON. No explanation, no markdown, no code fences."""


class ImportMarkdownRequest(BaseModel):
    markdown: str


class ImportMarkdownResponse(BaseModel):
    title: str
    servings: int
    ingredients_text: str
    instructions: str
    notes: str
    tags: list[str]
    source_url: Optional[str]


@router.post("/import-markdown", response_model=ImportMarkdownResponse)
async def import_markdown(payload: ImportMarkdownRequest):
    if not payload.markdown.strip():
        raise HTTPException(status_code=422, detail="Markdown content is required.")

    try:
        raw = await AIService().complete_with_system(
            IMPORT_MARKDOWN_SYSTEM_PROMPT,
            f"Extract recipe data from the following markdown:\n\n{payload.markdown}",
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.MULTILINE).strip()

    try:
        data = json.loads(raw)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI returned invalid JSON: {exc}") from exc

    if "error" in data:
        raise HTTPException(status_code=422, detail=str(data["error"]))

    missing = [k for k in ("title", "ingredients_text") if not str(data.get(k, "")).strip()]
    if missing:
        raise HTTPException(status_code=422, detail=f"Could not extract required fields: {', '.join(missing)}")

    return ImportMarkdownResponse(
        title=str(data.get("title", "")).strip(),
        servings=int(data.get("servings") or 1),
        ingredients_text=str(data.get("ingredients_text", "")).strip(),
        instructions=str(data.get("instructions", "")).strip(),
        notes=str(data.get("notes") or "").strip(),
        tags=[str(t).lower().strip() for t in (data.get("tags") or []) if str(t).strip()],
        source_url=str(data["source_url"]).strip() if data.get("source_url") else None,
    )


@router.get("/{recipe_id}/macros", response_model=MacrosResponse)
def get_recipe_macros(recipe_id: int, db: Session = Depends(get_db)):
    recipe = db.query(Recipe).filter(Recipe.id == recipe_id).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    ingredients = recipe.ingredients or []
    servings = recipe.servings or 1
    total_count = len(ingredients)
    matched_count = 0
    totals = {"calories": 0.0, "protein": 0.0, "carbs": 0.0, "fat": 0.0}
    breakdown: list[IngredientBreakdown] = []

    for ing in ingredients:
        rid = ing.get("id") or None
        ing_name = (ing.get("name") or "").strip()
        amount_raw = ing.get("amount") or 0
        unit_raw = str(ing.get("unit") or "")
        amount_display = f"{amount_raw} {unit_raw}".strip()

        db_ing = None
        ing_id = ing.get("ingredient_id")
        if ing_id:
            db_ing = db.query(Ingredient).filter(Ingredient.id == int(ing_id)).first()
        if db_ing is None and ing_name:
            db_ing = db.query(Ingredient).filter(Ingredient.name.ilike(ing_name)).first()

        if db_ing is None or any(v is None for v in [db_ing.calories, db_ing.protein, db_ing.carbs, db_ing.fat]):
            breakdown.append(IngredientBreakdown(
                recipe_ingredient_id=rid, name=ing_name, amount_display=amount_display,
                calories=None, protein=None, carbs=None, fat=None, matched=False,
            ))
            continue

        amount = float(amount_raw)
        stripped_unit = unit_raw.lower().strip()
        if stripped_unit in _COUNT_UNITS or not stripped_unit:
            # Count-based: divide count by serving_quantity so e.g. "6 count" of a
            # 3-per-serving item gives factor=2 (2 servings' worth of macros)
            serving_qty = float(getattr(db_ing, "serving_quantity", None) or 1)
            factor = amount / serving_qty
        else:
            grams = _to_grams(amount, unit_raw, getattr(db_ing, "serving_grams", None), ing_name)
            if grams is None or grams <= 0:
                breakdown.append(IngredientBreakdown(
                    recipe_ingredient_id=rid, name=ing_name, amount_display=amount_display,
                    calories=None, protein=None, carbs=None, fat=None, matched=False,
                ))
                continue
            ref_g = _reference_grams(db_ing)
            factor = grams / ref_g
        cal = db_ing.calories * factor
        prot = db_ing.protein * factor
        carbs_v = db_ing.carbs * factor
        fat_v = db_ing.fat * factor

        totals["calories"] += cal
        totals["protein"] += prot
        totals["carbs"] += carbs_v
        totals["fat"] += fat_v
        matched_count += 1

        breakdown.append(IngredientBreakdown(
            recipe_ingredient_id=rid, name=db_ing.name, amount_display=amount_display,
            calories=round(cal, 1), protein=round(prot, 1),
            carbs=round(carbs_v, 1), fat=round(fat_v, 1), matched=True,
        ))

    per_serving = {k: v / servings for k, v in totals.items()}

    return MacrosResponse(
        per_serving=MacroValues(**{k: round(v, 1) for k, v in per_serving.items()}),
        total=MacroValues(**{k: round(v, 1) for k, v in totals.items()}),
        servings=servings,
        matched_count=matched_count,
        total_count=total_count,
        breakdown=breakdown,
    )


class ShoppingListRequest(BaseModel):
    recipe_ids: list[int]


def _fmt_amount(value: float) -> str:
    rounded = round(value, 2)
    return str(int(rounded)) if rounded == int(rounded) else str(rounded)


@router.post("/shopping-list", response_class=PlainTextResponse)
def generate_shopping_list(payload: ShoppingListRequest, db: Session = Depends(get_db)):
    if not payload.recipe_ids:
        return PlainTextResponse("")

    db_recipes = db.query(Recipe).filter(Recipe.id.in_(payload.recipe_ids)).all()

    # ingredient_id → {name, total_grams, dominant_unit, dominant_grams, is_count, count_total}
    merged: dict[int, dict] = {}
    unmatched: list[tuple[str, float, str]] = []

    for recipe in db_recipes:
        for ing in (recipe.ingredients or []):
            ing_id = ing.get("ingredient_id")
            name = (ing.get("name") or "").strip()
            unit_raw = str(ing.get("unit") or "").strip()
            try:
                amount = float(ing.get("amount") or 0)
            except (ValueError, TypeError):
                amount = 0.0

            if not ing_id:
                unmatched.append((name, amount, unit_raw))
                continue

            db_ing = db.query(Ingredient).filter(Ingredient.id == int(ing_id)).first()
            serving_g = getattr(db_ing, "serving_grams", None) if db_ing else None
            grams = _to_grams(amount, unit_raw, serving_g, name)
            display_name = db_ing.name if db_ing else name

            if ing_id not in merged:
                merged[ing_id] = {
                    "name": display_name,
                    "total_grams": grams,
                    "dominant_unit": unit_raw,
                    "dominant_grams": grams if grams is not None else 0.0,
                    "is_count": grams is None,
                    "count_total": amount if grams is None else 0.0,
                }
            else:
                entry = merged[ing_id]
                if grams is not None:
                    entry["total_grams"] = (entry["total_grams"] or 0.0) + grams
                    if grams > entry["dominant_grams"]:
                        entry["dominant_unit"] = unit_raw
                        entry["dominant_grams"] = grams
                    entry["is_count"] = False
                else:
                    entry["count_total"] += amount

    lines: list[str] = []

    for entry in merged.values():
        name = entry["name"]
        if entry["is_count"]:
            total = entry["count_total"]
            unit = entry["dominant_unit"]
            lines.append(f"{name} - {_fmt_amount(total)}{' ' + unit if unit else ''}")
        else:
            total_g = entry["total_grams"] or 0.0
            dom_unit = entry["dominant_unit"] or "g"
            factor = _UNIT_TO_GRAMS.get(dom_unit.lower(), 1.0)
            converted = total_g / factor
            lines.append(f"{name} - {_fmt_amount(converted)} {dom_unit}")

    for name, amount, unit in unmatched:
        if not name:
            continue
        amt_str = _fmt_amount(amount) if amount else ""
        suffix = f"{' ' + unit if unit else ''}" if amt_str else ""
        lines.append(f"{name}{' - ' + amt_str + suffix if amt_str else ''}")

    lines.sort(key=lambda s: s.lower())
    return PlainTextResponse("\n".join(lines))


@router.get("/export-all")
def export_all_recipes(db: Session = Depends(get_db)):
    recipes = db.query(Recipe).order_by(Recipe.created_at.asc()).all()
    buf = io.BytesIO()
    used: set[str] = set()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for recipe in recipes:
            base = _slugify(recipe.title or "recipe")
            slug = base
            counter = 2
            while slug in used:
                slug = f"{base}-{counter}"
                counter += 1
            used.add(slug)
            zf.writestr(f"{slug}.md", _recipe_to_markdown(recipe))
    filename = f"mise-recipes-{date.today().isoformat()}.zip"
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/cookbooks", response_model=list[str])
def list_cookbooks(db: Session = Depends(get_db)):
    rows = (
        db.query(Recipe.cookbook)
        .filter(Recipe.cookbook.isnot(None), Recipe.cookbook != "")
        .distinct()
        .order_by(Recipe.cookbook.asc())
        .all()
    )
    return [r.cookbook for r in rows]


@router.get("", response_model=list[RecipeResponse])
def list_recipes(db: Session = Depends(get_db)):
    return db.query(Recipe).order_by(Recipe.created_at.desc()).all()


@router.get("/{recipe_id}/export")
def export_recipe(recipe_id: int, db: Session = Depends(get_db)):
    recipe = db.query(Recipe).filter(Recipe.id == recipe_id).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    slug = _slugify(recipe.title or "recipe")
    return Response(
        content=_recipe_to_markdown(recipe).encode("utf-8"),
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{slug}.md"'},
    )


@router.get("/{recipe_id}", response_model=RecipeResponse)
def get_recipe(recipe_id: int, db: Session = Depends(get_db)):
    recipe = db.query(Recipe).filter(Recipe.id == recipe_id).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return recipe


@router.post("", response_model=RecipeResponse, status_code=201)
def create_recipe(data: RecipeCreate, db: Session = Depends(get_db)):
    recipe = Recipe(**data.model_dump())
    db.add(recipe)
    db.commit()
    db.refresh(recipe)
    return recipe


@router.patch("/{recipe_id}", response_model=RecipeResponse)
def update_recipe(recipe_id: int, data: RecipeUpdate, db: Session = Depends(get_db)):
    recipe = db.query(Recipe).filter(Recipe.id == recipe_id).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(recipe, field, value)
    recipe.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(recipe)
    return recipe


@router.delete("/{recipe_id}")
def delete_recipe(recipe_id: int, db: Session = Depends(get_db)):
    recipe = db.query(Recipe).filter(Recipe.id == recipe_id).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    db.delete(recipe)
    db.commit()
    return {"deleted": True}
