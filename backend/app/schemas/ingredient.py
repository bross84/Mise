from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, computed_field

from app.services import nutrition

# What the four macro numbers in a create/update request are for. The server always stores
# per 100 g; "per_serving" values are converted using `serving_grams`.
NutritionBasis = Literal["per_100g", "per_serving"]


class MacroValues(BaseModel):
    calories: float
    protein: float
    carbs: float
    fat: float


class CalorieCheckOut(BaseModel):
    ok: bool
    expected_calories: float
    delta_pct: Optional[float] = None


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
    serving_quantity: Optional[int] = 1


class IngredientCreate(IngredientBase):
    nutrition_basis: NutritionBasis = "per_100g"
    override_calorie_check: bool = False


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
    serving_quantity: Optional[int] = None
    nutrition_basis: Optional[NutritionBasis] = None
    override_calorie_check: bool = False


class IngredientResponse(IngredientBase):
    id: int
    created_at: datetime

    model_config = {"from_attributes": True}

    def _macros(self) -> dict[str, float]:
        return {key: getattr(self, key) for key in nutrition.MACRO_KEYS}

    def _derived(self):
        return nutrition.derive_values(self.unit, self._macros(), self.serving_grams, self.serving_quantity)

    @computed_field
    @property
    def per_serving(self) -> Optional[MacroValues]:
        values = self._derived()[0]
        return MacroValues(**values) if values else None

    @computed_field
    @property
    def per_piece(self) -> Optional[MacroValues]:
        values = self._derived()[1]
        return MacroValues(**values) if values else None

    @computed_field
    @property
    def grams_per_piece(self) -> Optional[float]:
        return self._derived()[2]

    @computed_field
    @property
    def calorie_check(self) -> CalorieCheckOut:
        result = nutrition.check_calories(self.calories, self.protein, self.carbs, self.fat)
        return CalorieCheckOut(ok=result.ok, expected_calories=result.expected, delta_pct=result.delta_pct)
