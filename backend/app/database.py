from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# backend/app/database.py -> backend/data (matches the mise_data volume mounted at
# /app/data in Docker, since backend/ is the build context and becomes /app there).
DATA_DIR = Path(__file__).resolve().parents[1] / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
SQLALCHEMY_DATABASE_URL = f"sqlite:///{DATA_DIR / 'mise.db'}"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def create_tables():
    Base.metadata.create_all(bind=engine)
    # Add incremental columns to existing DBs that predate the fields
    from sqlalchemy import text
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE ingredients ADD COLUMN source VARCHAR DEFAULT 'local'"))
            conn.execute(text("UPDATE ingredients SET source = 'local' WHERE source IS NULL"))
            conn.commit()
        except Exception:
            pass  # Column already exists
        try:
            conn.execute(text("ALTER TABLE ingredients ADD COLUMN barcode VARCHAR"))
            conn.commit()
        except Exception:
            pass  # Column already exists
        try:
            conn.execute(text("ALTER TABLE recipes ADD COLUMN cookbook VARCHAR"))
            conn.commit()
        except Exception:
            pass  # Column already exists


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
