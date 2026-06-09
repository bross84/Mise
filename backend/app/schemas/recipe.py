from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class IngredientItem(BaseModel):
    id: str
    name: str
    amount: float
    unit: str
    ingredient_id: Optional[int] = None


class StepItem(BaseModel):
    id: str
    title: str
    content: str
    timer_seconds: Optional[int] = None


class RecipeBase(BaseModel):
    title: str
    servings: int
    tags: list[str] = []
    ingredients: list[IngredientItem] = []
    steps: list[StepItem] = []
    notes: Optional[str] = None
    rating: Optional[int] = None
    thumbs: Optional[str] = None
    image_url: Optional[str] = None


class RecipeCreate(RecipeBase):
    pass


class RecipeUpdate(BaseModel):
    title: Optional[str] = None
    servings: Optional[int] = None
    tags: Optional[list[str]] = None
    ingredients: Optional[list[IngredientItem]] = None
    steps: Optional[list[StepItem]] = None
    notes: Optional[str] = None
    rating: Optional[int] = None
    thumbs: Optional[str] = None
    image_url: Optional[str] = None


class RecipeResponse(RecipeBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
