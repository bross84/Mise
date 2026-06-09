from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import create_tables
from app.routers import recipes, ingredients
import app.models  # noqa: F401 — ensures models are registered before create_all

app = FastAPI(title="Mise API")


@app.on_event("startup")
def on_startup():
    create_tables()


app.include_router(recipes.router)
app.include_router(ingredients.router)

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
