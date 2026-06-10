import asyncio
from fastapi import APIRouter, Depends, HTTPException
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
    for food in (data.get("foods") or [])[:5]:
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
    for product in (data.get("products") or [])[:5]:
        nutriments = product.get("nutriments") or {}
        name = product.get("product_name") or product.get("generic_name") or ""
        if not name.strip():
            continue
        results.append(SearchResult(
            name=name.strip(),
            calories=_round(nutriments.get("energy-kcal_100g") or nutriments.get("energy_100g", 0) / 4.184),
            protein=_round(nutriments.get("proteins_100g")),
            carbs=_round(nutriments.get("carbohydrates_100g")),
            fat=_round(nutriments.get("fat_100g")),
            source="openfoodfacts",
            serving_grams=_off_serving_grams(product),
        ))
    return results


@router.get("/search", response_model=SearchResponse)
async def search_ingredients(q: str):
    if not q.strip():
        return SearchResponse(results=[])

    usda_url = "https://api.nal.usda.gov/fdc/v1/foods/search"
    off_url = "https://world.openfoodfacts.org/cgi/search.pl"

    async with httpx.AsyncClient(timeout=8.0) as client:
        usda_task = client.get(usda_url, params={"query": q, "pageSize": 5, "api_key": "DEMO_KEY"})
        off_task = client.get(off_url, params={
            "search_terms": q, "search_simple": 1, "action": "process", "json": 1, "page_size": 5
        })
        responses = await asyncio.gather(usda_task, off_task, return_exceptions=True)

    usda_results: list[SearchResult] = []
    off_results: list[SearchResult] = []

    usda_resp = responses[0]
    if isinstance(usda_resp, httpx.Response) and usda_resp.status_code == 200:
        try:
            usda_results = _parse_usda(usda_resp.json())
        except Exception:
            pass

    off_resp = responses[1]
    if isinstance(off_resp, httpx.Response) and off_resp.status_code == 200:
        try:
            off_results = _parse_off(off_resp.json())
        except Exception:
            pass

    # USDA first; deduplicate by normalised name
    seen: set[str] = set()
    merged: list[SearchResult] = []
    for result in usda_results + off_results:
        key = result.name.lower().strip()
        if key not in seen:
            seen.add(key)
            merged.append(result)
        if len(merged) == 8:
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
    existing = db.query(Ingredient).filter(Ingredient.name == data.name).first()
    if existing:
        raise HTTPException(status_code=409, detail="Ingredient with this name already exists")
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
