from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.meal_plan import MealPlanItem
from app.models.recipe import Recipe

router = APIRouter(prefix="/api/meal-plan", tags=["meal-plan"])


class AddToMealPlanRequest(BaseModel):
    recipe_id: int


class MealPlanItemResponse(BaseModel):
    id: int
    recipe_id: int
    title: str
    image_url: str | None = None
    added_at: datetime

    model_config = {"from_attributes": True}


@router.get("", response_model=list[MealPlanItemResponse])
def get_meal_plan(db: Session = Depends(get_db)):
    items = db.query(MealPlanItem).order_by(MealPlanItem.added_at.asc()).all()
    result = []
    for item in items:
        recipe = db.query(Recipe).filter(Recipe.id == item.recipe_id).first()
        if recipe:
            result.append(MealPlanItemResponse(
                id=item.id,
                recipe_id=item.recipe_id,
                title=recipe.title or "Untitled",
                image_url=recipe.image_url,
                added_at=item.added_at,
            ))
    return result


@router.post("", response_model=MealPlanItemResponse, status_code=201)
def add_to_meal_plan(payload: AddToMealPlanRequest, db: Session = Depends(get_db)):
    recipe = db.query(Recipe).filter(Recipe.id == payload.recipe_id).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    existing = db.query(MealPlanItem).filter(MealPlanItem.recipe_id == payload.recipe_id).first()
    if existing:
        raise HTTPException(status_code=409, detail="Recipe already on meal plan")

    item = MealPlanItem(recipe_id=payload.recipe_id)
    db.add(item)
    db.commit()
    db.refresh(item)

    return MealPlanItemResponse(
        id=item.id,
        recipe_id=item.recipe_id,
        title=recipe.title or "Untitled",
        image_url=recipe.image_url,
        added_at=item.added_at,
    )


@router.delete("/{item_id}", status_code=204)
def remove_from_meal_plan(item_id: int, db: Session = Depends(get_db)):
    item = db.query(MealPlanItem).filter(MealPlanItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    db.delete(item)
    db.commit()


@router.delete("", status_code=204)
def clear_meal_plan(db: Session = Depends(get_db)):
    db.query(MealPlanItem).delete()
    db.commit()
