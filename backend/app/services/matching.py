import re

from rapidfuzz import fuzz
from sqlalchemy.orm import Session
from app.models.ingredient import Ingredient

FUZZY_THRESHOLD = 80


def _normalize(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^a-z0-9 ]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _match_score(query_norm: str, candidate_norm: str) -> float:
    q_words = set(query_norm.split())
    c_words = set(candidate_norm.split())
    if not q_words or not c_words:
        return 0.0
    shorter_words = q_words if len(q_words) <= len(c_words) else c_words
    coverage = len(q_words & c_words) / len(shorter_words)
    # Require at least half of the shorter string's words to appear in the other
    if coverage < 0.5:
        return 0.0
    # All shorter words present — boost score so genuine partial names pass threshold
    if coverage >= 1.0:
        return max(90.0, float(fuzz.token_sort_ratio(query_norm, candidate_norm)))
    return float(fuzz.token_sort_ratio(query_norm, candidate_norm))


class IngredientMatcher:
    async def match(self, ingredient_name: str, db: Session) -> dict | None:
        name = ingredient_name.strip()
        if not name:
            return None

        all_ingredients = db.query(Ingredient).all()
        if not all_ingredients:
            return None

        name_norm = _normalize(name)

        # 1. Exact match (case-insensitive, normalization-aware)
        for ing in all_ingredients:
            if _normalize(ing.name) == name_norm:
                return {"ingredient_id": ing.id, "name": ing.name, "confidence": "exact", "score": 100}

        # 2. Fuzzy match with word-overlap gate
        best_score = 0.0
        best_ing = None
        for ing in all_ingredients:
            score = _match_score(name_norm, _normalize(ing.name))
            if score > best_score:
                best_score = score
                best_ing = ing

        if best_score >= FUZZY_THRESHOLD and best_ing is not None:
            return {"ingredient_id": best_ing.id, "name": best_ing.name, "confidence": "fuzzy", "score": round(best_score)}

        return None
