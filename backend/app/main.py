import uuid
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import create_tables, engine, get_db
from app.models.recipe import Recipe
from app.routers import recipes, ingredients, settings, share, meal_plan
from app.services.ai import AIService
import app.models  # noqa: F401 — ensures models are registered before create_all

# Load environment variables from the project root first, then backend/app/.env.
PROJECT_ROOT = Path(__file__).resolve().parents[2]
APP_ENV_FILE = Path(__file__).resolve().parent / '.env'
load_dotenv(PROJECT_ROOT / '.env')
load_dotenv(APP_ENV_FILE)

app = FastAPI(title="Mise API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AITestRequest(BaseModel):
    prompt: str


class AITestResponse(BaseModel):
    response: str


UPLOADS_DIR = PROJECT_ROOT / 'uploads'
UPLOADS_DIR.mkdir(exist_ok=True)

ALLOWED_MIME_TYPES = {'image/jpeg', 'image/png', 'image/webp', 'image/gif'}
ALLOWED_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp', '.gif'}
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB


class RecipeImageResponse(BaseModel):
    image_url: str | None = None


def _migrate():
    """Safely add new nullable columns that may not exist in older databases."""
    with engine.connect() as conn:
        result = conn.execute(text("PRAGMA table_info(recipes)"))
        existing = {row[1] for row in result.fetchall()}
        for col, col_type in [("instructions", "TEXT"), ("source_url", "TEXT"), ("image_url", "TEXT")]:
            if col not in existing:
                conn.execute(text(f"ALTER TABLE recipes ADD COLUMN {col} {col_type}"))

        result = conn.execute(text("PRAGMA table_info(ingredients)"))
        ing_cols = {row[1] for row in result.fetchall()}
        if "serving_quantity" not in ing_cols:
            conn.execute(text("ALTER TABLE ingredients ADD COLUMN serving_quantity INTEGER DEFAULT 1"))
        conn.commit()


@app.on_event("startup")
def on_startup():
    create_tables()
    _migrate()


app.include_router(recipes.router)
app.include_router(ingredients.router)
app.include_router(settings.router)
app.include_router(share.router)
app.include_router(meal_plan.router)


app.mount('/uploads', StaticFiles(directory=str(UPLOADS_DIR)), name='uploads')


@app.get("/api/health")
def health_check():
    return {"status": "ok"}


@app.post('/api/recipes/{recipe_id}/image', response_model=RecipeImageResponse)
async def upload_recipe_image(
    recipe_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    recipe = db.query(Recipe).filter(Recipe.id == recipe_id).first()
    if not recipe:
        raise HTTPException(status_code=404, detail='Recipe not found')

    if file.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(status_code=415, detail='Unsupported image type. Use JPEG, PNG, WebP, or GIF.')

    suffix = Path(file.filename or '').suffix.lower() or '.jpg'
    if suffix not in ALLOWED_EXTENSIONS:
        suffix = '.jpg'

    contents = await file.read()
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail='Image must be under 10 MB.')

    # Delete old file if it was a local upload
    if recipe.image_url and recipe.image_url.startswith('/uploads/'):
        old_path = PROJECT_ROOT / recipe.image_url.lstrip('/')
        old_path.unlink(missing_ok=True)

    filename = f'{recipe_id}_{uuid.uuid4().hex}{suffix}'
    dest = UPLOADS_DIR / filename
    dest.write_bytes(contents)

    recipe.image_url = f'/uploads/{filename}'
    recipe.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(recipe)

    return RecipeImageResponse(image_url=recipe.image_url)


@app.delete('/api/recipes/{recipe_id}/image', response_model=RecipeImageResponse)
def delete_recipe_image(recipe_id: int, db: Session = Depends(get_db)):
    recipe = db.query(Recipe).filter(Recipe.id == recipe_id).first()
    if not recipe:
        raise HTTPException(status_code=404, detail='Recipe not found')

    if recipe.image_url and recipe.image_url.startswith('/uploads/'):
        old_path = PROJECT_ROOT / recipe.image_url.lstrip('/')
        old_path.unlink(missing_ok=True)

    recipe.image_url = None
    recipe.updated_at = datetime.utcnow()
    db.commit()

    return RecipeImageResponse(image_url=None)


@app.post('/api/ai/test', response_model=AITestResponse)
async def ai_test(payload: AITestRequest):
    try:
        response_text = await AIService().complete(payload.prompt)
        return AITestResponse(response=response_text)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
