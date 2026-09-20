from sqlalchemy import Column, Integer, String, Float
from app.database import Base
from app.models.timestamps import UTCDateTime, utcnow


class Ingredient(Base):
    __tablename__ = "ingredients"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    calories = Column(Float, nullable=False)
    protein = Column(Float, nullable=False)
    carbs = Column(Float, nullable=False)
    fat = Column(Float, nullable=False)
    unit = Column(String, default="per 100g")
    source = Column(String, default="local", server_default="local")
    barcode = Column(String, nullable=True)
    serving_grams = Column(Float, nullable=True)
    serving_quantity = Column(Integer, default=1, server_default="1", nullable=True)
    created_at = Column(UTCDateTime, default=utcnow)
