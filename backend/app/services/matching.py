from rapidfuzz import process, fuzz
from sqlalchemy.orm import Session
from app.models.ingredient import Ingredient

FUZZY_THRESHOLD = 80


class IngredientMatcher:
    async def match(self, ingredient_name: str, db: Session) -> dict | None:
        name = ingredient_name.strip()
        if not name:
            return None

        all_ingredients = db.query(Ingredient).all()
        if not all_ingredients:
            return None

        # 1. Exact match (case-insensitive)
        name_lower = name.lower()
        for ing in all_ingredients:
            if ing.name.lower() == name_lower:
                return {
                    "ingredient_id": ing.id,
                    "name": ing.name,
                    "confidence": "exact",
                    "score": 100,
                }

        # 2. Fuzzy match
        choices = {ing.name: ing for ing in all_ingredients}
        result = process.extractOne(
            name,
            choices.keys(),
            scorer=fuzz.WRatio,
            score_cutoff=FUZZY_THRESHOLD,
        )
        if result:
            matched_name, score, _ = result
            ing = choices[matched_name]
            return {
                "ingredient_id": ing.id,
                "name": ing.name,
                "confidence": "fuzzy",
                "score": round(score),
            }

        return None
