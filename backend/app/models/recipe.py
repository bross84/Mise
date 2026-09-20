from sqlalchemy import Column, Integer, String, JSON
from app.database import Base
from app.models.timestamps import UTCDateTime, utcnow


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
    cookbook = Column(String, nullable=True)
    rating = Column(Integer, nullable=True)
    thumbs = Column(String, nullable=True)
    image_url = Column(String, nullable=True)
    created_at = Column(UTCDateTime, default=utcnow)
    updated_at = Column(UTCDateTime, default=utcnow, onupdate=utcnow)
