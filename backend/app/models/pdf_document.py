from sqlalchemy import Column, Integer, String

from app.database import Base
from app.models.timestamps import UTCDateTime, utcnow


class PdfDocument(Base):
    """A PDF kept in Mise's document library."""

    __tablename__ = "pdf_documents"

    id = Column(Integer, primary_key=True, index=True)
    original_filename = Column(String, nullable=False)
    stored_filename = Column(String, nullable=False, unique=True)
    media_type = Column(String, nullable=False)
    size_bytes = Column(Integer, nullable=False)
    created_at = Column(UTCDateTime, default=utcnow, nullable=False)
