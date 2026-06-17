from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, JSON
from app.database import Base


class Recipe(Base):
    __tablename__ = "recipes"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    servings = Column(Integer, nullable=False)
    tags = Column(JSON, default=list)
    ingredients = Column(JSON, default=list)
    steps = Column(JSON, default=list)
    notes = Column(String, nullable=True)
    instructions = Column(String, nullable=True)
    source_url = Column(String, nullable=True)
    rating = Column(Integer, nullable=True)
    thumbs = Column(String, nullable=True)
    image_url = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
