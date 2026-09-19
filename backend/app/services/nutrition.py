"""Nutrition math shared by ingredient import, ingredient CRUD, and recipe macros.

Storage contract
----------------
Ingredient macros (calories / protein / carbs / fat) are stored **per 100 g** with the
unit label ``"per 100g"``. ``serving_grams`` is the weight of one label serving and
``serving_quantity`` is the number of pieces (or scoops) in that serving. Per-serving,
per-piece and per-scoop values are derived from those three facts and never stored.

Rows saved before this contract may carry a ``unit`` like ``"per 45g"``, meaning the macros
are for 45 g. ``basis_grams`` and ``serving_weight`` keep those rows computing correctly
until they are reviewed and re-saved.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass

CALORIE_TOLERANCE = 0.15
MACRO_KEYS = ("calories", "protein", "carbs", "fat")
STANDARD_UNIT = "per 100g"

UNIT_TO_GRAMS: dict[str, float] = {
    'g': 1.0, 'gram': 1.0, 'grams': 1.0,
    'kg': 1000.0, 'kilogram': 1000.0, 'kilograms': 1000.0,
    'oz': 28.35, 'ounce': 28.35, 'ounces': 28.35,
    'lb': 453.6, 'lbs': 453.6, 'pound': 453.6, 'pounds': 453.6,
    'tsp': 4.0, 'teaspoon': 4.0, 'teaspoons': 4.0,
    'tbsp': 12.0, 'tablespoon': 12.0, 'tablespoons': 12.0,
    'cup': 240.0, 'cups': 240.0,
    'ml': 1.0, 'milliliter': 1.0, 'milliliters': 1.0, 'millilitre': 1.0, 'millilitres': 1.0,
}

# Average whole-piece weights (grams) for common count-based produce.
# Last-resort fallback when an ingredient has no serving weight of its own.
PRODUCE_WEIGHTS: dict[str, float] = {
    'apple': 182, 'apricot': 35, 'avocado': 150,
    'banana': 118, 'beet': 82, 'bell pepper': 119,
    'broccoli': 91,  # per floret/small head
    'carrot': 61, 'celery': 40,  # per stalk
    'cucumber': 201, 'egg': 50,
    'garlic': 3,  # per clove
    'grapefruit': 246, 'jalapeño': 14, 'jalapeno': 14,
    'kiwi': 69, 'leek': 89, 'lemon': 58, 'lime': 44,
    'mango': 207, 'mushroom': 18,  # per medium mushroom
    'onion': 110, 'orange': 131, 'parsnip': 85,
    'peach': 150, 'pear': 178, 'pepper': 119,
    'plum': 66, 'potato': 150, 'radish': 10,
    'scallion': 15, 'shallot': 30,
    'sweet potato': 130, 'tomato': 123,
    'turnip': 122, 'zucchini': 196,
}

# Units that count discrete things; weighed via the ingredient's per-piece weight.
COUNT_UNITS: frozenset[str] = frozenset(
    {'count', 'whole', 'piece', 'pieces', 'item', 'items', 'each', 'scoop', 'scoops'}
)
# Units that mean "one label serving"; weighed via the ingredient's serving weight.
SERVING_UNITS: frozenset[str] = frozenset({'serving', 'servings'})

NEEDS_SERVING_WEIGHT = "Needs serving weight (g)"

_PER_GRAMS_RE = re.compile(r'^per\s+([\d.]+)\s*g')
_STANDARD_UNIT_RE = re.compile(r'per\s*100\s*g(rams?)?')


# ── Calorie sanity check ─────────────────────────────────────────────────────

@dataclass(frozen=True)
class CalorieCheck:
    ok: bool
    expected: float
    delta_pct: float | None  # signed; None when the macros imply 0 kcal


def expected_calories(protein: float, carbs: float, fat: float) -> float:
    return 4.0 * protein + 4.0 * carbs + 9.0 * fat


def check_calories(
    calories: float, protein: float, carbs: float, fat: float,
    tolerance: float = CALORIE_TOLERANCE,
) -> CalorieCheck:
    """Compare stated calories to 4×protein + 4×carbs + 9×fat, within ``tolerance``."""
    expected = expected_calories(protein, carbs, fat)
    if expected <= 0:
        return CalorieCheck(ok=calories <= 0, expected=0.0, delta_pct=None)
    delta = (calories - expected) / expected
    return CalorieCheck(
        ok=abs(delta) <= tolerance + 1e-9,
        expected=round(expected, 1),
        delta_pct=round(delta * 100, 1),
    )


# ── Choosing one consistent macro set (importers) ────────────────────────────

def parse_number(value) -> float | None:
    """A finite, non-negative float, or None. Blank, junk and negative values count as missing."""
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number >= 0 else None


@dataclass(frozen=True)
class MacroSelection:
    macros: dict[str, float] | None  # per 100 g, all four keys; None when nothing usable
    converted_from_serving: bool = False
    reason: str | None = None


def _is_complete(values: dict) -> bool:
    return all(values.get(key) is not None for key in MACRO_KEYS)


def per_serving_to_per_100g(values: dict, serving_grams: float) -> dict[str, float]:
    factor = 100.0 / serving_grams
    return {key: round(values[key] * factor, 1) for key in MACRO_KEYS}


def pick_macro_set(per_100g: dict, per_serving: dict, serving_grams: float | None) -> MacroSelection:
    """Take all four macros from ONE complete set, never a mix of the two.

    A complete per-100 g set wins. Otherwise a complete per-serving set is converted to per
    100 g, which needs the serving weight. If neither works we return no macros and a reason,
    so the caller can ask for manual entry instead of guessing.
    """
    if _is_complete(per_100g):
        return MacroSelection({key: round(per_100g[key], 1) for key in MACRO_KEYS})
    if _is_complete(per_serving):
        if serving_grams and serving_grams > 0:
            return MacroSelection(per_serving_to_per_100g(per_serving, serving_grams), True)
        return MacroSelection(None, reason="Only per-serving values are listed and the serving weight is unknown")
    return MacroSelection(None, reason="No complete set of calories, protein, carbs and fat")


# ── Basis, serving and per-piece values ──────────────────────────────────────

def basis_grams(unit: str | None) -> float:
    """Grams the stored macros are for. 100 for every row saved under the current contract."""
    match = _PER_GRAMS_RE.match((unit or '').lower().strip())
    if match:
        try:
            value = float(match.group(1))
        except ValueError:
            return 100.0
        if value > 0:
            return value
    return 100.0


def is_standard_unit(unit: str | None) -> bool:
    text = (unit or '').strip().lower()
    return not text or bool(_STANDARD_UNIT_RE.fullmatch(text))


def serving_weight(unit: str | None, serving_grams: float | None) -> float | None:
    """Grams in one label serving, or None when unknown."""
    if serving_grams and serving_grams > 0:
        return float(serving_grams)
    basis = basis_grams(unit)
    # A legacy "per 45g" row stored one serving's macros, so its basis is its serving.
    return basis if basis != 100.0 else None


def piece_weight(unit: str | None, serving_grams: float | None, serving_quantity: int | None) -> float | None:
    weight = serving_weight(unit, serving_grams)
    if weight is None:
        return None
    return weight / max(int(serving_quantity or 1), 1)


def _scale(macros: dict, grams: float, basis: float) -> dict[str, float]:
    factor = grams / basis
    return {key: round(macros[key] * factor, 1) for key in MACRO_KEYS}


def derive_values(
    unit: str | None, macros: dict, serving_grams: float | None, serving_quantity: int | None,
) -> tuple[dict | None, dict | None, float | None]:
    """(per_serving, per_piece, grams_per_piece). All None when the serving weight is unknown."""
    serving = serving_weight(unit, serving_grams)
    if serving is None:
        return None, None, None
    basis = basis_grams(unit)
    each = serving / max(int(serving_quantity or 1), 1)
    return _scale(macros, serving, basis), _scale(macros, each, basis), round(each, 1)


# ── Recipe amounts → grams → macro factor ────────────────────────────────────

def count_weight_lookup(ingredient_name: str) -> float | None:
    """Fallback gram weight for count-based produce by matching name keywords."""
    name = re.sub(r'[^a-z ]', ' ', ingredient_name.lower())
    name = re.sub(r'\s+', ' ', name).strip()
    # Longest-match first so "bell pepper" beats "pepper"
    for key in sorted(PRODUCE_WEIGHTS, key=len, reverse=True):
        if key in name:
            return PRODUCE_WEIGHTS[key]
    return None


def grams_for_amount(
    amount: float, unit: str, piece_g: float | None = None, serving_g: float | None = None,
    ingredient_name: str = '',
) -> tuple[float | None, str | None]:
    """(grams, None) when the amount can be weighed, else (None, reason)."""
    stripped = (unit or '').lower().strip()
    if stripped in SERVING_UNITS:
        return (amount * serving_g, None) if serving_g else (None, NEEDS_SERVING_WEIGHT)
    if stripped and stripped not in COUNT_UNITS:
        factor = UNIT_TO_GRAMS.get(stripped)
        if factor is None:
            return None, f'Unknown unit "{unit.strip()}"'
        return amount * factor, None
    # No unit or a count unit: the ingredient's own piece weight, then the produce table.
    if piece_g:
        return amount * piece_g, None
    fallback = count_weight_lookup(ingredient_name)
    if fallback:
        return amount * fallback, None
    return None, NEEDS_SERVING_WEIGHT


def ingredient_grams(db_ing, amount: float, unit: str, ingredient_name: str = '') -> tuple[float | None, str | None]:
    """grams_for_amount using a stored ingredient's serving data (db_ing may be None)."""
    piece_g = serving_g = None
    if db_ing is not None:
        piece_g = piece_weight(db_ing.unit, db_ing.serving_grams, db_ing.serving_quantity)
        serving_g = serving_weight(db_ing.unit, db_ing.serving_grams)
    return grams_for_amount(amount, unit, piece_g, serving_g, ingredient_name)


def macro_factor(db_ing, amount: float, unit: str, ingredient_name: str = '') -> tuple[float | None, str | None]:
    """Multiplier to apply to db_ing's stored macros for this recipe amount, or (None, reason)."""
    grams, note = ingredient_grams(db_ing, amount, unit, ingredient_name)
    if grams is None:
        return None, note
    if grams <= 0:
        return None, "Amount is zero"
    return grams / basis_grams(db_ing.unit), None
