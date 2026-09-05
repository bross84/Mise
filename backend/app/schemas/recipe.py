from datetime import datetime
from typing import Any, Literal, Optional
from pydantic import BaseModel


class IngredientItem(BaseModel):
    id: str
    name: str
    amount: float
    unit: str
    ingredient_id: Optional[int] = None
    group_name: Optional[str] = None


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
    instructions: Optional[str] = None
    source_url: Optional[str] = None
    cookbook: Optional[str] = None
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
    instructions: Optional[str] = None
    source_url: Optional[str] = None
    cookbook: Optional[str] = None
    rating: Optional[int] = None
    thumbs: Optional[str] = None
    image_url: Optional[str] = None


class RecipeResponse(RecipeBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AiEditMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class AiEditRequest(BaseModel):
    instruction: str
    conversation: list[AiEditMessage] = []


class Change(BaseModel):
    id: str
    op: Literal["update", "add", "remove"]
    field: str
    target_id: Optional[str] = None
    label: str
    before: Any = None
    after: Any = None
    why: str = ""


class AiEditResponse(BaseModel):
    reply: str
    proposed: RecipeUpdate = RecipeUpdate()
    changes: list[Change] = []
