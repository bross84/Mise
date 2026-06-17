from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime
from app.database import Base


class BlockedIngredient(Base):
    __tablename__ = "blocked_ingredients"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    source = Column(String, nullable=False)
    source_id = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
