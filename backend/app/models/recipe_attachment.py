from sqlalchemy import Column, ForeignKey, Integer, String

from app.database import Base
from app.models.timestamps import UTCDateTime, utcnow


class RecipeAttachment(Base):
    """A file stored locally and associated with one recipe."""

    __tablename__ = "recipe_attachments"

    id = Column(Integer, primary_key=True, index=True)
    recipe_id = Column(Integer, ForeignKey("recipes.id"), nullable=False, index=True)
    original_filename = Column(String, nullable=False)
    stored_filename = Column(String, nullable=False, unique=True)
    media_type = Column(String, nullable=False)
    size_bytes = Column(Integer, nullable=False)
    created_at = Column(UTCDateTime, default=utcnow, nullable=False)
