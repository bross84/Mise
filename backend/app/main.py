from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin

import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import create_tables, engine, get_db
from app.models.recipe import Recipe
from app.routers import recipes, ingredients, settings
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


class RecipeImageResponse(BaseModel):
    image_url: str | None = None


IMAGE_CATEGORY_KEYWORDS: dict[str, str] = {
    'butter chicken': 'butter-chicken',
    'butter-chicken': 'butter-chicken',
    'biryani': 'biryani',
    'burger': 'burger',
    'cake': 'cake',
    'chicken': 'chicken',
    'dessert': 'dessert',
    'dosa': 'dosa',
    'idli': 'idli',
    'ihop': 'ihop',
    'pasta': 'pasta',
    'pizza': 'pizza',
    'rice': 'rice',
    'salad': 'salad',
    'sandwich': 'sandwich',
    'samosa': 'samosa',
    'soup': 'soup',
    'taco': 'taco',
    'waffle': 'waffle',
}


def _pick_image_category(title: str) -> str:
    normalized = (title or '').lower()
    for keyword, category in IMAGE_CATEGORY_KEYWORDS.items():
        if keyword in normalized:
            return category
    return 'food'


async def _fetch_recipe_image(category: str) -> str:
    url = f'https://loremflickr.com/640/480/{category}'
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=False) as client:
            response = await client.get(url)
        # loremflickr 301s to a stable Flickr CDN URL — capture that instead of
        # the category URL so the same image is served on every subsequent load.
        if response.status_code in (301, 302, 303, 307, 308):
            location = response.headers.get('location')
            if location:
                return urljoin(url, location)
        if response.status_code == 200:
            return url
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail='Could not fetch image from loremflickr.') from exc
    raise HTTPException(status_code=502, detail='Could not fetch image from loremflickr.')


def _build_image_category(recipe: Recipe) -> str:
    """Return the loremflickr search term to use for a recipe.

    Preference order:
    1. Up to 3 of the recipe's saved tags joined by commas (e.g. "mexican,ground beef,high protein")
    2. Single keyword derived from the recipe title via the existing keyword map
    3. Generic fallback: "food"
    """
    tags = [t.strip() for t in (recipe.tags or []) if t and t.strip()]
    if tags:
        return ','.join(tags[:2])
    return _pick_image_category(recipe.title or '')


def _migrate():
    """Safely add new nullable columns that may not exist in older databases."""
    with engine.connect() as conn:
        result = conn.execute(text("PRAGMA table_info(recipes)"))
        existing = {row[1] for row in result.fetchall()}
        for col, col_type in [("instructions", "TEXT"), ("source_url", "TEXT"), ("image_url", "TEXT")]:
            if col not in existing:
                conn.execute(text(f"ALTER TABLE recipes ADD COLUMN {col} {col_type}"))
        conn.commit()


@app.on_event("startup")
def on_startup():
    create_tables()
    _migrate()


app.include_router(recipes.router)
app.include_router(ingredients.router)
app.include_router(settings.router)


@app.get("/api/health")
def health_check():
    return {"status": "ok"}


@app.get('/api/recipes/{recipe_id}/image', response_model=RecipeImageResponse)
async def get_recipe_image(recipe_id: int, db: Session = Depends(get_db)):
    recipe = db.query(Recipe).filter(Recipe.id == recipe_id).first()
    if not recipe:
        raise HTTPException(status_code=404, detail='Recipe not found')

    if recipe.image_url:
        return RecipeImageResponse(image_url=recipe.image_url)

    category = _build_image_category(recipe)
    image_url = await _fetch_recipe_image(category)

    recipe.image_url = image_url
    recipe.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(recipe)

    return RecipeImageResponse(image_url=image_url)


@app.patch('/api/recipes/{recipe_id}/image/clear', response_model=RecipeImageResponse)
def clear_recipe_image(recipe_id: int, db: Session = Depends(get_db)):
    recipe = db.query(Recipe).filter(Recipe.id == recipe_id).first()
    if not recipe:
        raise HTTPException(status_code=404, detail='Recipe not found')

    recipe.image_url = None
    recipe.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(recipe)

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
