# Mise

Personal recipe manager with serving scaling, per-recipe macro calculation, and AI-assisted recipe creation. Built with React, FastAPI, and SQLite.

## Features

- **Recipe library** – create, edit, tag, rate, and organize recipes by cookbook, with image upload or URL.
- **Serving scaling** – view ingredients per serving or scale the whole recipe up/down, and save the scaled amounts back.
- **Macros** – ingredients link to a nutrition database (local, [USDA FoodData Central](https://fdc.nal.usda.gov/), or [Open Food Facts](https://world.openfoodfacts.org/), including barcode lookup); total and per-serving calories/protein/carbs/fat are calculated from the linked ingredients and displayed on the recipe, with a per-ingredient breakdown. No food diary or day-level tracking.
- **AI assistance** (via [OpenRouter](https://openrouter.ai/)) – parse a recipe from pasted text or a URL, parse and match free-text ingredient lists to the database, and suggest tags.
- **Cook mode** – full-screen, checklist-style step view that keeps the screen awake.
- **Meal planning** – add recipes to a meal plan and generate a consolidated shopping list.
- **Sharing & export** – Markdown export/import, and a shareable recipe page that embeds schema.org Recipe metadata (with the calculated macros) so it can be pulled straight into [MacroFactor](https://macrofactorapp.com/)'s "import recipe from URL".

## Tech stack

| Layer    | Stack                                                            |
| -------- | --------------------------------------------------------------- |
| Frontend | React 19, React Router, Vite, Tailwind CSS                      |
| Backend  | FastAPI, SQLAlchemy, SQLite, httpx, RapidFuzz                   |
| AI       | OpenRouter (`deepseek/deepseek-chat` by default)               |
| Infra    | Docker Compose; images published to GHCR via GitHub Actions    |

## Project structure

```
backend/          FastAPI app
  app/
    routers/      recipes, ingredients, meal_plan, settings, share
    services/     AI, ingredient matching
    models/       SQLAlchemy models
    schemas/      Pydantic schemas
frontend/         React + Vite app
  src/pages/      RecipeBrowser, RecipeDetail, AddRecipe, IngredientDatabase, Settings
docs/             planning notes
```

## Getting started

### Docker Compose (recommended)

```bash
docker compose up
```

- Frontend: http://localhost:5173
- Backend API + docs: http://localhost:8001 / http://localhost:8001/docs

### Manual

Backend:

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

## Configuration

Create a `.env` file in the project root (it is git-ignored):

```
OPENROUTER_API_KEY=sk-or-...      # required for AI features
USDA_API_KEY=...                  # optional, enables USDA ingredient search
```

The frontend reads `VITE_API_URL` (defaults to `http://localhost:8001/api`).

The SQLite database is created automatically at `backend/data/mise.db`; lightweight column migrations run on startup.

## Deployment

Pushing to `main` builds and publishes `mise-backend` and `mise-frontend` images to GHCR. Deploy with:

```bash
docker compose -f docker-compose.prod.yml up -d
```

The production frontend is served by nginx on port 8080.
