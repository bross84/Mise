import re

from rapidfuzz import fuzz
from sqlalchemy.orm import Session
from app.models.ingredient import Ingredient

FUZZY_THRESHOLD = 80


def _normalize(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^a-z0-9 ]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


# Words that describe how an ingredient is prepared or how much to use, not what it is.
# "Onion, diced" and "black pepper (or to taste)" should find "Onions, Raw" and
# "Spices, Pepper, Black".
_NOISE_WORDS = frozenset({
    "diced", "chopped", "minced", "sliced", "grated", "shredded", "crushed", "cubed", "halved",
    "quartered", "peeled", "trimmed", "drained", "rinsed", "melted", "softened", "beaten",
    "packed", "divided", "optional", "fresh", "freshly", "finely", "roughly", "coarsely",
    "thinly", "large", "medium", "small", "extra", "plus", "more", "for", "serving", "garnish",
    "taste", "to", "or", "and", "of", "the", "a", "about", "approximately", "cut", "into",
    "pieces", "chunks", "room", "temperature",
})


def stem(word: str) -> str:
    """Crude singular form, applied to both sides so tomatoes/tomato and onions/onion agree."""
    if len(word) > 4 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 4 and word.endswith("oes"):
        return word[:-2]
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        return word[:-1]
    return word


def core_words(text: str) -> list[str]:
    """Stemmed words of an ingredient name with parentheticals, prep notes and filler removed.
    Falls back to every word when nothing would be left."""
    without_parens = re.sub(r"\([^)]*\)", " ", text.lower())
    words = _normalize(without_parens).split()
    kept = [stem(w) for w in words if w not in _NOISE_WORDS]
    return kept or [stem(w) for w in _normalize(text).split()]


def _match_score(query_norm: str, candidate_norm: str) -> float:
    q_words = set(core_words(query_norm))
    c_words = {stem(w) for w in candidate_norm.split()}
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
        # Ties go to the candidate with the fewest extra words ("Onions, Raw" over "Onion Powder Blend").
        best_score = 0.0
        best_ing = None
        best_extra = 0
        for ing in all_ingredients:
            cand_norm = _normalize(ing.name)
            score = _match_score(name_norm, cand_norm)
            extra = len(cand_norm.split())
            if score > best_score or (score == best_score and score > 0 and extra < best_extra):
                best_score = score
                best_ing = ing
                best_extra = extra

        if best_score >= FUZZY_THRESHOLD and best_ing is not None:
            return {"ingredient_id": best_ing.id, "name": best_ing.name, "confidence": "fuzzy", "score": round(best_score)}

        return None
