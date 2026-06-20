import json
import re

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.ingredient import Ingredient
from app.models.recipe import Recipe
from app.routers.recipes import _to_grams, _reference_grams

router = APIRouter(prefix="/share", tags=["share"])


def _compute_macros(recipe: Recipe, db: Session) -> dict | None:
    ingredients = recipe.ingredients or []
    servings = recipe.servings or 1
    totals = {"calories": 0.0, "protein": 0.0, "carbs": 0.0, "fat": 0.0}
    matched = 0

    for ing in ingredients:
        ing_name = (ing.get("name") or "").strip()
        amount_raw = ing.get("amount") or 0
        unit_raw = str(ing.get("unit") or "")

        db_ing = None
        ing_id = ing.get("ingredient_id")
        if ing_id:
            db_ing = db.query(Ingredient).filter(Ingredient.id == int(ing_id)).first()
        if db_ing is None and ing_name:
            db_ing = db.query(Ingredient).filter(Ingredient.name.ilike(ing_name)).first()

        if db_ing is None or any(v is None for v in [db_ing.calories, db_ing.protein, db_ing.carbs, db_ing.fat]):
            continue

        amount = float(amount_raw)
        grams = _to_grams(amount, unit_raw, getattr(db_ing, "serving_grams", None), ing_name)
        if grams is None or grams <= 0:
            continue

        ref_g = _reference_grams(db_ing)
        factor = grams / ref_g
        totals["calories"] += db_ing.calories * factor
        totals["protein"] += db_ing.protein * factor
        totals["carbs"] += db_ing.carbs * factor
        totals["fat"] += db_ing.fat * factor
        matched += 1

    if matched == 0:
        return None

    return {k: round(v / servings, 1) for k, v in totals.items()}


def _ingredient_string(ing: dict) -> str:
    amount_raw = ing.get("amount")
    unit = (ing.get("unit") or "").strip()
    name = (ing.get("name") or "").strip()
    parts = []
    if amount_raw is not None:
        try:
            amt = float(amount_raw)
            if amt > 0:
                parts.append(str(int(amt)) if amt == int(amt) else str(amt))
        except (ValueError, TypeError):
            pass
    if unit:
        parts.append(unit)
    if name:
        parts.append(name)
    return " ".join(parts) if parts else name


def _steps_to_instructions(steps: list) -> list[dict]:
    result = []
    for step in steps:
        if isinstance(step, str):
            text = step.strip()
        elif isinstance(step, dict):
            text = (step.get("text") or step.get("instruction") or "").strip()
        else:
            continue
        if text:
            result.append({"@type": "HowToStep", "text": text})
    return result


def _html_escape(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


@router.get("/recipe/{recipe_id}", response_class=HTMLResponse)
def share_recipe(recipe_id: int, db: Session = Depends(get_db)):
    recipe = db.query(Recipe).filter(Recipe.id == recipe_id).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    ingredients = recipe.ingredients or []
    steps = recipe.steps or []

    ingredient_strings = [_ingredient_string(i) for i in ingredients]
    instructions = _steps_to_instructions(steps)
    if not instructions and recipe.instructions:
        for line in recipe.instructions.strip().split("\n"):
            line = line.strip()
            if line:
                instructions.append({"@type": "HowToStep", "text": line})

    macros = _compute_macros(recipe, db)

    jsonld: dict = {
        "@context": "https://schema.org",
        "@type": "Recipe",
        "name": recipe.title or "Untitled Recipe",
        "recipeYield": f"{recipe.servings or 1} serving{'s' if (recipe.servings or 1) != 1 else ''}",
        "recipeIngredient": ingredient_strings,
        "recipeInstructions": instructions,
    }

    if recipe.image_url:
        jsonld["image"] = recipe.image_url

    if recipe.notes:
        jsonld["description"] = recipe.notes

    if macros:
        jsonld["nutrition"] = {
            "@type": "NutritionInformation",
            "calories": f"{round(macros['calories'])} calories",
            "proteinContent": f"{macros['protein']}g",
            "carbohydrateContent": f"{macros['carbs']}g",
            "fatContent": f"{macros['fat']}g",
        }

    title_esc = _html_escape(recipe.title or "Recipe")
    notes_esc = _html_escape(recipe.notes or "")
    ing_items = "".join(f"<li>{_html_escape(s)}</li>" for s in ingredient_strings)
    step_items = "".join(
        f"<li>{_html_escape(s['text'])}</li>" for s in instructions
    )
    macro_html = ""
    if macros:
        macro_html = f"""
        <p class="macros">
            Per serving: {round(macros['calories'])} kcal &middot;
            {macros['protein']}g protein &middot;
            {macros['carbs']}g carbs &middot;
            {macros['fat']}g fat
        </p>"""

    image_html = f'<img src="{_html_escape(recipe.image_url)}" alt="{title_esc}">' if recipe.image_url else ""

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title_esc}</title>
  <script type="application/ld+json">{json.dumps(jsonld, ensure_ascii=False)}</script>
  <style>
    body {{ font-family: system-ui, sans-serif; max-width: 680px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }}
    img {{ width: 100%; border-radius: 8px; margin-bottom: 1rem; }}
    h1 {{ font-size: 1.75rem; margin-bottom: 0.25rem; }}
    .meta {{ color: #666; font-size: 0.9rem; margin-bottom: 1rem; }}
    .macros {{ background: #f5f5f5; border-radius: 6px; padding: 0.5rem 0.75rem; font-size: 0.875rem; }}
    h2 {{ font-size: 1.1rem; margin-top: 1.5rem; }}
    ul, ol {{ padding-left: 1.25rem; }}
    li {{ margin-bottom: 0.3rem; }}
    p.notes {{ color: #555; font-size: 0.9rem; font-style: italic; }}
  </style>
</head>
<body>
  {image_html}
  <h1>{title_esc}</h1>
  <p class="meta">Serves {recipe.servings or 1}</p>
  {macro_html}
  {"<p class='notes'>" + notes_esc + "</p>" if notes_esc else ""}
  <h2>Ingredients</h2>
  <ul>{ing_items}</ul>
  {"<h2>Instructions</h2><ol>" + step_items + "</ol>" if step_items else ""}
</body>
</html>"""

    return HTMLResponse(content=html)
