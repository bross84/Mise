from sqlalchemy import Column, Integer
from app.database import Base
from app.models.timestamps import UTCDateTime, utcnow


class MealPlanItem(Base):
    __tablename__ = "meal_plan_items"

    id = Column(Integer, primary_key=True, index=True)
    recipe_id = Column(Integer, nullable=False, index=True)
    added_at = Column(UTCDateTime, default=utcnow)
