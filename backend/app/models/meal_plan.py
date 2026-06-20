from datetime import datetime
from sqlalchemy import Column, Integer, DateTime
from app.database import Base


class MealPlanItem(Base):
    __tablename__ = "meal_plan_items"

    id = Column(Integer, primary_key=True, index=True)
    recipe_id = Column(Integer, nullable=False, index=True)
    added_at = Column(DateTime, default=datetime.utcnow)
