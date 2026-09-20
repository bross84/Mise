from sqlalchemy import Column, Integer, String
from app.database import Base
from app.models.timestamps import UTCDateTime, utcnow


class BlockedIngredient(Base):
    __tablename__ = "blocked_ingredients"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    source = Column(String, nullable=False)
    source_id = Column(String, nullable=False)
    created_at = Column(UTCDateTime, default=utcnow)
