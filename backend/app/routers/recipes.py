import json
import re
from datetime import datetime
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
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
    'lb': 453.6, 'pound': 453.6, 'pounds': 453.6,
    'tsp': 4.0, 'teaspoon': 4.0, 'teaspoons': 4.0,
    'tbsp': 12.0, 'tablespoon': 12.0, 'tablespoons': 12.0,
    'cup': 240.0, 'cups': 240.0,
    'ml': 1.0, 'milliliter': 1.0, 'milliliters': 1.0, 'millilitre': 1.0, 'millilitres': 1.0,
}


def _to_grams(amount: float, unit: str) -> float | None:
    factor = _UNIT_TO_GRAMS.get(unit.lower().strip())
    return None if factor is None else amount * factor


class MacroValues(BaseModel):
    calories: float
    protein: float
    carbs: float
    fat: float


class MacrosResponse(BaseModel):
    per_serving: MacroValues
    total: MacroValues
    servings: int
    matched_count: int
    total_count: int


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

    # Diagnostic: log stored fields on first ingredient so mismatches are visible in docker logs
    if ingredients:
        import sys
        print(f"[macros] recipe {recipe_id} first ingredient keys: {list(ingredients[0].keys())}", file=sys.stderr, flush=True)

    for ing in ingredients:
        db_ing = None

        # Path 1: numeric ingredient_id stored by the matching service
        ing_id = ing.get("ingredient_id")
        if ing_id:
            db_ing = db.query(Ingredient).filter(Ingredient.id == int(ing_id)).first()

        # Path 2: canonical name stored on the ingredient (matches exact DB name)
        if db_ing is None:
            ing_name = (ing.get("name") or "").strip()
            if ing_name:
                db_ing = (
                    db.query(Ingredient)
                    .filter(Ingredient.name.ilike(ing_name))
                    .first()
                )

        if db_ing is None:
            continue
        if any(v is None for v in [db_ing.calories, db_ing.protein, db_ing.carbs, db_ing.fat]):
            continue

        amount = float(ing.get("amount") or 0)
        unit = str(ing.get("unit") or "g")
        grams = _to_grams(amount, unit)
        if grams is None or grams <= 0:
            continue

        factor = grams / 100.0
        totals["calories"] += db_ing.calories * factor
        totals["protein"] += db_ing.protein * factor
        totals["carbs"] += db_ing.carbs * factor
        totals["fat"] += db_ing.fat * factor
        matched_count += 1

    per_serving = {k: v / servings for k, v in totals.items()}

    return MacrosResponse(
        per_serving=MacroValues(**{k: round(v, 1) for k, v in per_serving.items()}),
        total=MacroValues(**{k: round(v, 1) for k, v in totals.items()}),
        servings=servings,
        matched_count=matched_count,
        total_count=total_count,
    )


@router.get("", response_model=list[RecipeResponse])
def list_recipes(db: Session = Depends(get_db)):
    return db.query(Recipe).order_by(Recipe.created_at.desc()).all()


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
