import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.pdf_document import PdfDocument

router = APIRouter(prefix="/api/pdfs", tags=["pdfs"])

PROJECT_ROOT = Path(__file__).resolve().parents[2]
UPLOADS_DIR = PROJECT_ROOT / "uploads"
MAX_PDF_UPLOAD_BYTES = 50 * 1024 * 1024
PDF_CHUNK_BYTES = 1024 * 1024


class PdfDocumentResponse(BaseModel):
    id: int
    original_filename: str
    media_type: str
    size_bytes: int
    created_at: datetime
    url: str


def _response(document: PdfDocument) -> PdfDocumentResponse:
    return PdfDocumentResponse(
        id=document.id,
        original_filename=document.original_filename,
        media_type=document.media_type,
        size_bytes=document.size_bytes,
        created_at=document.created_at,
        url=f"/uploads/{document.stored_filename}",
    )


@router.get("", response_model=list[PdfDocumentResponse])
def list_pdf_documents(db: Session = Depends(get_db)):
    documents = db.query(PdfDocument).order_by(PdfDocument.created_at.desc()).all()
    return [_response(document) for document in documents]


@router.post("", response_model=PdfDocumentResponse, status_code=201)
async def upload_pdf_document(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if Path(file.filename or "").suffix.lower() != ".pdf" or file.content_type != "application/pdf":
        raise HTTPException(status_code=415, detail="Unsupported file type. Upload a PDF file.")

    UPLOADS_DIR.mkdir(exist_ok=True)
    stored_filename = f"pdf-{uuid.uuid4().hex}.pdf"
    temporary_path = UPLOADS_DIR / f".{uuid.uuid4().hex}.upload"
    destination = UPLOADS_DIR / stored_filename
    bytes_written = 0
    first_chunk = b""

    try:
        with temporary_path.open("wb") as output:
            while chunk := await file.read(PDF_CHUNK_BYTES):
                if not first_chunk:
                    first_chunk = chunk
                bytes_written += len(chunk)
                if bytes_written > MAX_PDF_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="PDF must be 50 MB or smaller.")
                output.write(chunk)

        if b"%PDF-" not in first_chunk[:1024]:
            raise HTTPException(status_code=415, detail="The uploaded file is not a valid PDF.")

        temporary_path.replace(destination)
    except HTTPException:
        temporary_path.unlink(missing_ok=True)
        raise
    except OSError as exc:
        temporary_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="Could not save the PDF.") from exc
    finally:
        await file.close()

    document = PdfDocument(
        original_filename=Path(file.filename or "document.pdf").name,
        stored_filename=stored_filename,
        media_type="application/pdf",
        size_bytes=bytes_written,
    )
    try:
        db.add(document)
        db.commit()
        db.refresh(document)
    except Exception:
        db.rollback()
        destination.unlink(missing_ok=True)
        raise

    return _response(document)


@router.delete("/{document_id}")
def delete_pdf_document(document_id: int, db: Session = Depends(get_db)):
    document = db.query(PdfDocument).filter(PdfDocument.id == document_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="PDF not found")

    file_path = UPLOADS_DIR / document.stored_filename
    db.delete(document)
    db.commit()
    file_path.unlink(missing_ok=True)
    return {"deleted": True}
