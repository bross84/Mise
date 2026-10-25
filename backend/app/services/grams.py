"""Convert parsed ingredient amounts to grams.

Each conversion carries a source so the review screen can show how far to trust it:
  exact     weight units (oz, lb, kg ...) and plain grams: pure arithmetic
  table     volumes/counts resolved from the fixed density and piece-weight tables below
  estimate  everything else, filled in by the AI fallback or a rule of thumb (drained cans)
Anything that cannot be weighed stays in its original unit.
"""
import re
from dataclasses import dataclass

from app.services.nutrition import count_weight_lookup

GRAM_UNITS = {"g", "gram", "grams", "gm", "gms"}

# grams per unit
WEIGHT_UNITS: dict[str, float] = {
    "kg": 1000.0, "kilogram": 1000.0, "kilograms": 1000.0,
    "mg": 0.001,
    "oz": 28.3495, "ounce": 28.3495, "ounces": 28.3495,
    "lb": 453.592, "lbs": 453.592, "pound": 453.592, "pounds": 453.592,
}

# millilitres per unit
VOLUME_UNITS: dict[str, float] = {
    "ml": 1.0, "milliliter": 1.0, "milliliters": 1.0, "millilitre": 1.0, "millilitres": 1.0,
    "l": 1000.0, "liter": 1000.0, "liters": 1000.0, "litre": 1000.0, "litres": 1000.0,
    "tsp": 4.92892, "teaspoon": 4.92892, "teaspoons": 4.92892,
    "tbsp": 14.7868, "tablespoon": 14.7868, "tablespoons": 14.7868, "tbs": 14.7868,
    "floz": 29.5735, "fl oz": 29.5735, "fluid ounce": 29.5735, "fluid ounces": 29.5735,
    "cup": 236.588, "cups": 236.588,
    "pint": 473.176, "pints": 473.176, "pt": 473.176,
    "quart": 946.353, "quarts": 946.353, "qt": 946.353,
    "gallon": 3785.41, "gallons": 3785.41, "gal": 3785.41,
}

# Typical grams per millilitre, matched on whole words in the ingredient name, longest key first.
DENSITY_G_PER_ML: dict[str, float] = {
    "water": 1.0, "broth": 1.0, "stock": 1.0, "vinegar": 1.01, "lemon juice": 1.03,
    "lime juice": 1.03, "orange juice": 1.04, "milk": 1.03, "buttermilk": 1.03,
    "cream": 1.0, "heavy cream": 0.99, "half and half": 1.01, "yogurt": 1.04,
    "greek yogurt": 1.07, "sour cream": 1.0, "cream cheese": 1.0, "mayonnaise": 0.95,
    "olive oil": 0.91, "vegetable oil": 0.92, "canola oil": 0.92, "grapeseed oil": 0.92,
    "avocado oil": 0.92, "coconut oil": 0.92, "sesame oil": 0.92, "oil": 0.92,
    "butter": 0.96, "honey": 1.42, "maple syrup": 1.33, "molasses": 1.4, "corn syrup": 1.38,
    "soy sauce": 1.15, "fish sauce": 1.2, "worcestershire sauce": 1.15, "hot sauce": 1.0,
    "ketchup": 1.15, "mustard": 1.05, "tomato paste": 1.1, "tomato sauce": 1.04,
    "crushed tomatoes": 1.03, "peanut butter": 1.08, "powdered peanut butter": 0.41,
    "almond butter": 1.05, "tahini": 1.0,
    "flour": 0.51, "all purpose flour": 0.51, "whole wheat flour": 0.51, "almond flour": 0.4,
    "coconut flour": 0.45, "sugar": 0.85, "granulated sugar": 0.85, "brown sugar": 0.93,
    "powdered sugar": 0.5, "confectioners sugar": 0.5, "cornstarch": 0.54,
    "cocoa powder": 0.42, "cocoa": 0.42, "baking powder": 0.95, "baking soda": 1.1,
    "table salt": 1.22, "salt": 1.22, "chili powder": 0.53, "cumin": 0.45, "ground cumin": 0.45,
    "paprika": 0.45, "smoked paprika": 0.45, "cinnamon": 0.5, "garlic powder": 0.6,
    "onion powder": 0.5, "black pepper": 0.46, "cayenne": 0.5,
    "dried oregano": 0.2, "dried basil": 0.2, "dried thyme": 0.3,
    "minced garlic": 1.0,
    "rice": 0.78, "white rice": 0.78, "brown rice": 0.8, "quinoa": 0.72,
    "rolled oats": 0.34, "oats": 0.34, "breadcrumbs": 0.45, "panko": 0.25,
    "shredded cheese": 0.47, "cheddar cheese": 0.47, "mozzarella cheese": 0.47,
    "parmesan cheese": 0.42, "grated parmesan": 0.42, "peanuts": 0.62, "almonds": 0.6,
    "walnuts": 0.5, "pecans": 0.45, "raisins": 0.65, "chocolate chips": 0.7,
    "lentils": 0.8, "black beans": 0.75, "chickpeas": 0.7,
}

_FRACTIONS = {"½": 0.5, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 0.25, "¾": 0.75, "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875}

# "3 x 15.5 oz can": count x size unit
_MULTI_RE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*([a-zA-Z.]+)", re.IGNORECASE)

# Grams the recipe itself states, e.g. "1.3 lb (590 g) ground beef" or "1 cup / 120 g flour".
_STATED_GRAMS_RE = re.compile(r"(?<![\w.])(\d+(?:\.\d+)?)(?:\s*[-–]\s*\d+(?:\.\d+)?)?\s*(?:g|gm|grams?)(?![a-z])", re.IGNORECASE)

DRAINED_FRACTION = 0.6  # drained beans/vegetables weigh about 60% of the labelled can weight


@dataclass
class GramsResult:
    amount: float
    source: str  # exact | table | estimate
    note: str | None = None


def parse_amount(text: str | None) -> float | None:
    """'1 1/2', '1/2', '½', '2-3' (first value), '1.5' -> float; None when not numeric."""
    if text is None:
        return None
    s = str(text).strip().lower()
    if not s:
        return None
    total = 0.0
    found = False
    for ch, val in _FRACTIONS.items():
        if ch in s:
            total += val
            found = True
            s = s.replace(ch, " ")
    s = s.strip()
    if s:
        m = re.match(r"^(\d+)\s+(\d+)\s*/\s*(\d+)", s)
        if m and int(m.group(3)):
            return total + int(m.group(1)) + int(m.group(2)) / int(m.group(3))
        m = re.match(r"^(\d+)\s*/\s*(\d+)", s)
        if m and int(m.group(2)):
            return total + int(m.group(1)) / int(m.group(2))
        m = re.match(r"^(\d+(?:\.\d+)?)", s)
        if m:
            return total + float(m.group(1))
    return total if found else None


def _unit_key(unit: str | None) -> str:
    return re.sub(r"[.\s]+$", "", (unit or "").lower().strip().replace(".", ""))


def _first_unit_word(unit: str | None) -> str:
    """'oz can' -> 'oz', 'cups, packed' -> 'cups'."""
    words = re.findall(r"[a-z]+", (unit or "").lower())
    if len(words) >= 2 and f"{words[0]} {words[1]}" in VOLUME_UNITS:
        return f"{words[0]} {words[1]}"
    return words[0] if words else ""


def round_grams(grams: float) -> float:
    return round(grams, 1) if grams < 10 else float(round(grams))


def density_for(name: str) -> float | None:
    words = " ".join(re.findall(r"[a-z]+", name.lower()))
    for key in sorted(DENSITY_G_PER_ML, key=len, reverse=True):
        if re.search(rf"\b{re.escape(key)}s?\b", words):
            return DENSITY_G_PER_ML[key]
    return None


def convert_to_grams(name: str, amount_text: str | None, unit: str | None, raw: str = "") -> GramsResult | None:
    """Grams for one ingredient when the tables can answer it; None when it must stay as-is
    or go to the AI fallback (see needs_estimate)."""
    # Grams written in the recipe win over any conversion.
    stated = _STATED_GRAMS_RE.search(raw or "")
    if stated and float(stated.group(1)) > 0:
        return GramsResult(round_grams(float(stated.group(1))), "exact", "Grams as written in the recipe")

    amount = parse_amount(amount_text)
    if amount is None or amount <= 0:
        return None
    unit_word = _first_unit_word(unit)
    is_can = "can" in (unit or "").lower() or bool(re.search(r"\bcans?\b", raw.lower()))
    drained = bool(re.search(r"\bdrained\b", f"{raw} {name}".lower()))

    # "3 x 15.5 oz can": the unit field or raw line carries a count x size.
    multi = _MULTI_RE.match(f"{amount_text or ''} {unit or ''}") or _MULTI_RE.match(raw)
    if multi:
        count, size, size_unit = float(multi.group(1)), float(multi.group(2)), _unit_key(multi.group(3))
        if size_unit in WEIGHT_UNITS or size_unit in GRAM_UNITS:
            grams = count * size * (WEIGHT_UNITS.get(size_unit) or 1.0)
            if drained and is_can:
                return GramsResult(round_grams(grams * DRAINED_FRACTION), "estimate",
                                   f"Drained weight, about {int(DRAINED_FRACTION * 100)}% of the {round_grams(grams)} g can")
            return GramsResult(round_grams(grams), "exact")
        return None

    if unit_word in GRAM_UNITS:
        return GramsResult(round_grams(amount), "exact")
    if unit_word in WEIGHT_UNITS:
        grams = amount * WEIGHT_UNITS[unit_word]
        if drained and is_can:
            return GramsResult(round_grams(grams * DRAINED_FRACTION), "estimate",
                               f"Drained weight, about {int(DRAINED_FRACTION * 100)}% of the {round_grams(grams)} g can")
        return GramsResult(round_grams(grams), "exact")
    if unit_word in VOLUME_UNITS:
        density = density_for(name)
        if density is None:
            return None
        return GramsResult(round_grams(amount * VOLUME_UNITS[unit_word] * density), "table")

    # Count / noun units ("2 medium onions", "3 cloves garlic"): piece-weight table.
    if unit_word == "" or unit_word in {
        "clove", "cloves", "whole", "each", "ea", "piece", "pieces", "large", "medium", "small", "stalk", "stalks",
        "head", "heads", "bunch",
    }:
        piece = count_weight_lookup(name)
        if piece:
            return GramsResult(round_grams(amount * piece), "table")
    return None


def needs_estimate(amount_text: str | None, unit: str | None, converted: GramsResult | None) -> bool:
    """True for entries with a real amount that the tables could not weigh and that aren't
    just unitless or already grams."""
    if converted is not None:
        return False
    amount = parse_amount(amount_text)
    if amount is None or amount <= 0:
        return False
    return _first_unit_word(unit) not in GRAM_UNITS
