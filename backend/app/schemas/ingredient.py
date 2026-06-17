from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class IngredientBase(BaseModel):
    name: str
    calories: float
    protein: float
    carbs: float
    fat: float
    unit: str = "per 100g"
    source: str = "local"
    barcode: Optional[str] = None
    serving_grams: Optional[float] = None


class IngredientCreate(IngredientBase):
    pass


class IngredientUpdate(BaseModel):
    name: Optional[str] = None
    calories: Optional[float] = None
    protein: Optional[float] = None
    carbs: Optional[float] = None
    fat: Optional[float] = None
    unit: Optional[str] = None
    source: Optional[str] = None
    barcode: Optional[str] = None
    serving_grams: Optional[float] = None


class IngredientResponse(IngredientBase):
    id: int
    created_at: datetime

    model_config = {"from_attributes": True}
