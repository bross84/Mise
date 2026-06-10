from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.database import create_tables
from app.routers import recipes, ingredients, settings
from app.services.ai import AIService
import app.models  # noqa: F401 — ensures models are registered before create_all

# Load environment variables from the project root first, then backend/app/.env.
PROJECT_ROOT = Path(__file__).resolve().parents[2]
APP_ENV_FILE = Path(__file__).resolve().parent / '.env'
load_dotenv(PROJECT_ROOT / '.env')
load_dotenv(APP_ENV_FILE)

app = FastAPI(title="Mise API")


class AITestRequest(BaseModel):
    prompt: str


class AITestResponse(BaseModel):
    response: str


@app.on_event("startup")
def on_startup():
    create_tables()


app.include_router(recipes.router)
app.include_router(ingredients.router)
app.include_router(settings.router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health_check():
    return {"status": "ok"}


@app.post('/api/ai/test', response_model=AITestResponse)
async def ai_test(payload: AITestRequest):
    try:
        response_text = await AIService().complete(payload.prompt)
        return AITestResponse(response=response_text)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
