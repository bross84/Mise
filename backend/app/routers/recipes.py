import io
import json
import logging
import re
import uuid
import zipfile
from datetime import date, datetime
from typing import Optional

logger = logging.getLogger(__name__)

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.ingredient import Ingredient
from app.models.recipe import Recipe
from app.schemas.recipe import (
    AiEditRequest,
    AiEditResponse,
    Change,
    RecipeCreate,
    RecipeResponse,
    RecipeUpdate,
    Suggestion,
)
from app.services.ai import AIService
from app.services.matching import IngredientMatcher

router = APIRouter(prefix="/api/recipes", tags=["recipes"])

PARSE_SYSTEM_PROMPT = """You are a recipe formatter. Convert the provided recipe text into clean markdown format.
Use exactly this structure:

# Recipe Title

**Servings:** N
**Tags:** tag1, tag2, tag3

## Ingredients
- Xg ingredient name
- Xg ingredient name

## Steps
1. Step content here
2. Step content here

## Notes
Optional notes here

Rules:
- Convert ALL ingredient amounts to grams where possible
- For items that cannot be weighed (e.g. "to taste"), use a reasonable gram estimate
- Generate 2-4 relevant tags
- Keep steps concise but complete
- Return ONLY the markdown, no explanation, no code fences
- Multiple recipes separated by --- in input should each get their own markdown block separated by ---"""


class ParseRequest(BaseModel):
    text: str = ""
    url: Optional[str] = None


class ParseResponse(BaseModel):
    markdown: str


def _extract_jsonld_recipe(html: str) -> Optional[str]:
    """Pull Schema.org Recipe JSON-LD out of a page if present."""
    pattern = re.compile(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        re.DOTALL | re.IGNORECASE,
    )
    for match in pattern.finditer(html):
        try:
            data = json.loads(match.group(1))
            if isinstance(data, dict) and data.get("@graph"):
                data = data["@graph"]
            if isinstance(data, list):
                for item in data:
                    if isinstance(item, dict) and "Recipe" in str(item.get("@type", "")):
                        return json.dumps(item)
            elif isinstance(data, dict) and "Recipe" in str(data.get("@type", "")):
                return json.dumps(data)
        except (json.JSONDecodeError, KeyError):
            continue
    return None


def _slugify(title: str) -> str:
    """Lowercase, spaces → hyphens, strip non-word characters, collapse repeated hyphens."""
    s = (title or "recipe").lower().strip()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[\s_]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s or "recipe"


def _recipe_to_markdown(recipe: Recipe) -> str:
    lines: list[str] = []

    lines.append(f"# {recipe.title or 'Untitled Recipe'}")
    lines.append("")
    lines.append(f"**Servings:** {recipe.servings or 1}")
    lines.append("")

    ingredients = recipe.ingredients or []
    if ingredients:
        lines.append("## Ingredients")
        lines.append("")
        current_group: str | None = None
        for ing in ingredients:
            group = (ing.get("group_name") or "").strip() or None
            if group and group != current_group:
                current_group = group
                lines.append(f"### {group}")
                lines.append("")
            amount_raw = ing.get("amount")
            unit = (ing.get("unit") or "").strip()
            name = (ing.get("name") or "").strip()
            parts: list[str] = []
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
            lines.append(f"- {' '.join(parts)}" if parts else f"- {name}")
        lines.append("")

    if recipe.instructions:
        lines.append("## Instructions")
        lines.append("")
        lines.append(recipe.instructions.strip())
        lines.append("")

    if recipe.notes:
        lines.append("## Notes")
        lines.append("")
        lines.append(recipe.notes.strip())
        lines.append("")

    tags = recipe.tags or []
    if tags:
        lines.append(f"**Tags:** {', '.join(tags)}")
    if recipe.source_url:
        lines.append(f"**Source:** {recipe.source_url}")

    return "\n".join(lines).strip() + "\n"


@router.post("/parse", response_model=ParseResponse)
async def parse_recipe(payload: ParseRequest):
    content = payload.text.strip()

    if payload.url and payload.url.strip():
        try:
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                resp = await client.get(
                    payload.url.strip(),
                    headers={"User-Agent": "Mozilla/5.0 (compatible; MiseRecipeParser/1.0)"},
                )
                resp.raise_for_status()
                html = resp.text
            jsonld = _extract_jsonld_recipe(html)
            content = jsonld if jsonld else html[:12000]
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=422, detail=f"Could not fetch URL: {exc}") from exc

    if not content:
        raise HTTPException(status_code=422, detail="Provide recipe text or a URL.")

    prompt = f"Format the following into recipe markdown:\n\n{content}"
    try:
        markdown = await AIService().complete_with_system(PARSE_SYSTEM_PROMPT, prompt)
    except (ValueError, RuntimeError) as exc:
        logger.error("AI parse failed: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    # Strip any accidental code fences
    markdown = re.sub(r"^```(?:markdown)?\s*|\s*```$", "", markdown.strip(), flags=re.MULTILINE).strip()
    # Fix AI artifact where \n- gets collapsed to n- at line start
    markdown = re.sub(r"^n-\s", "- ", markdown, flags=re.MULTILINE)

    return ParseResponse(markdown=markdown)


INGREDIENT_PARSE_SYSTEM_PROMPT = """You are an ingredient parser. Convert ingredient text into a JSON array.

Rules:
- Return ONLY a JSON array, no explanation, no code fences
- One object per ingredient: {"raw": "original text", "name": "ingredient name", "amount": "quantity as a string or null", "unit": "unit or null", "group_name": "section name or null"}
- Detect section headers (e.g. "***Beef Mix***", "For the Sauce:", "## Marinade") — assign their name as group_name to all following ingredients until the next header
- Skip blank lines and section header lines themselves (they become group_name, not ingredients)
- amount and unit should reflect exactly what is written; use null if not present
- Do not invent amounts or units that are not in the text
- A single line may list several ingredients that share one amount, written as
  "10g salt, black pepper, chili powder" or "oregano, basil, thyme - 1 tsp each".
  Emit one object per ingredient, each carrying the shared amount and unit.
  Only split this way when EVERY comma-separated part is a plain ingredient name.
  Do NOT split when any part is a preparation note or descriptor (diced, minced,
  drained, softened, to taste, room temperature, plus more for serving, low sodium,
  canned, packed) — keep the whole line as one ingredient in that case.

Examples:
  "10g salt, black pepper, garlic powder" ->
    [{"raw":"10g salt, black pepper, garlic powder","name":"salt","amount":"10","unit":"g","group_name":null},
     {"raw":"10g salt, black pepper, garlic powder","name":"black pepper","amount":"10","unit":"g","group_name":null},
     {"raw":"10g salt, black pepper, garlic powder","name":"garlic powder","amount":"10","unit":"g","group_name":null}]
  "1 tsp each: oregano, basil, thyme" -> three objects, each amount "1" unit "tsp"
  "2 tomatoes, diced" -> one object: name "tomatoes", amount "2", unit null
  "chicken broth, low sodium" -> one object: name "chicken broth, low sodium", amount null, unit null
"""


TAG_GENERATION_SYSTEM_PROMPT = """Based on the recipe name and ingredient list provided, suggest 3-5 short tags describing the recipe.
Draw from: cuisine type, main protein or dish type, and obvious dietary characteristics (e.g. high protein, vegetarian, quick meal).
Rules:
- Return ONLY a JSON array of strings, no explanation, no code fences
- Tags must be lowercase, 1-2 words each
- Example: ["mexican", "ground beef", "high protein", "quick meal"]"""


class ParseIngredientsRequest(BaseModel):
    text: str
    recipe_name: Optional[str] = None


class ParsedIngredientItem(BaseModel):
    raw: str
    name: str
    amount: Optional[str] = None
    unit: Optional[str] = None
    group_name: Optional[str] = None


class ParseIngredientsResponse(BaseModel):
    ingredients: list[ParsedIngredientItem]
    suggested_tags: list[str] = []


@router.post("/parse-ingredients", response_model=ParseIngredientsResponse)
async def parse_ingredients_endpoint(payload: ParseIngredientsRequest):
    import asyncio
    if not payload.text.strip():
        return ParseIngredientsResponse(ingredients=[], suggested_tags=[])

    ingredient_prompt = f"Parse these ingredients:\n\n{payload.text}"
    tag_prompt = (
        f"Recipe name: {payload.recipe_name or 'Unknown'}\n"
        f"Ingredients:\n{payload.text}"
    )

    try:
        ai = AIService()
        ingredient_result, tag_result = await asyncio.gather(
            ai.complete_with_system(INGREDIENT_PARSE_SYSTEM_PROMPT, ingredient_prompt),
            ai.complete_with_system(TAG_GENERATION_SYSTEM_PROMPT, tag_prompt),
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    ingredient_result = re.sub(r"^```(?:json)?\s*|\s*```$", "", ingredient_result.strip(), flags=re.MULTILINE).strip()
    tag_result = re.sub(r"^```(?:json)?\s*|\s*```$", "", tag_result.strip(), flags=re.MULTILINE).strip()

    try:
        data = json.loads(ingredient_result)
        ingredients = [ParsedIngredientItem(**item) for item in data]
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to parse AI ingredient response: {exc}") from exc

    try:
        raw_tags = json.loads(tag_result)
        suggested_tags = [str(t).lower().strip() for t in raw_tags if str(t).strip()] if isinstance(raw_tags, list) else []
    except Exception:
        suggested_tags = []

    return ParseIngredientsResponse(ingredients=ingredients, suggested_tags=suggested_tags)


class MatchIngredientItem(BaseModel):
    name: str
    amount: float = 0
    unit: str = "g"


class MatchIngredientsRequest(BaseModel):
    ingredients: list[MatchIngredientItem]


class MatchResult(BaseModel):
    name: str
    amount: float
    unit: str
    match: Optional[dict] = None


class MatchIngredientsResponse(BaseModel):
    results: list[MatchResult]


@router.post("/match-ingredients", response_model=MatchIngredientsResponse)
async def match_ingredients(payload: MatchIngredientsRequest, db: Session = Depends(get_db)):
    matcher = IngredientMatcher()
    results = []
    for item in payload.ingredients:
        match = await matcher.match(item.name, db)
        results.append(MatchResult(name=item.name, amount=item.amount, unit=item.unit, match=match))
    return MatchIngredientsResponse(results=results)


_UNIT_TO_GRAMS: dict[str, float] = {
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
# Used as a last-resort fallback when unit is absent and serving_grams is unset.
_PRODUCE_WEIGHTS: dict[str, float] = {
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


def _count_weight_lookup(ingredient_name: str) -> float | None:
    """Return a fallback gram weight for count-based produce by matching name keywords."""
    name = re.sub(r'[^a-z ]', ' ', ingredient_name.lower())
    name = re.sub(r'\s+', ' ', name).strip()
    # Longest-match first so "bell pepper" beats "pepper"
    for key in sorted(_PRODUCE_WEIGHTS, key=len, reverse=True):
        if key in name:
            return _PRODUCE_WEIGHTS[key]
    return None


_COUNT_UNITS: frozenset[str] = frozenset({'count', 'whole', 'piece', 'pieces', 'item', 'items', 'each'})

def _to_grams(amount: float, unit: str, serving_grams: float | None = None,
              ingredient_name: str = '') -> float | None:
    stripped = unit.lower().strip()
    if stripped and stripped not in _COUNT_UNITS:
        factor = _UNIT_TO_GRAMS.get(stripped)
        return None if factor is None else amount * factor
    # No unit or count-based unit: prefer DB serving_grams, then produce table, else skip
    if serving_grams and serving_grams > 0:
        return amount * serving_grams
    fallback = _count_weight_lookup(ingredient_name)
    if fallback:
        return amount * fallback
    return None


def _reference_grams(db_ing: Ingredient) -> float:
    """Return the gram quantity that db_ing's stored macro values are based on."""
    if db_ing.serving_grams and db_ing.serving_grams > 0:
        return float(db_ing.serving_grams)
    unit = (db_ing.unit or '').lower().strip()
    m = re.match(r'^per\s+([\d.]+)\s*g', unit)
    if m:
        try:
            v = float(m.group(1))
            if v > 0:
                return v
        except ValueError:
            pass
    return 100.0


class MacroValues(BaseModel):
    calories: float
    protein: float
    carbs: float
    fat: float


class IngredientBreakdown(BaseModel):
    recipe_ingredient_id: Optional[str] = None
    name: str
    amount_display: str
    calories: float | None
    protein: float | None
    carbs: float | None
    fat: float | None
    matched: bool


class MacrosResponse(BaseModel):
    per_serving: MacroValues
    total: MacroValues
    servings: int
    matched_count: int
    total_count: int
    breakdown: list[IngredientBreakdown] = []


IMPORT_MARKDOWN_SYSTEM_PROMPT = """You are a recipe data extractor. Given a markdown recipe document, extract the following and return ONLY a JSON object with these exact keys:

{
  "title": "string — the recipe name (required)",
  "servings": integer — number of servings (default 1 if not specified),
  "ingredients_text": "string — all ingredient lines, one per line, preserving any section/group headers exactly as written (e.g. '## Sauce', '**For the marinade:**')",
  "instructions": "string — the full instructions section as markdown, do not summarize, rewrite, or shorten",
  "notes": "string or null — any notes, tips, or storage section; null if absent",
  "tags": ["array of lowercase tag strings if present in the document, otherwise empty array"],
  "source_url": "string or null — source URL if present, otherwise null"
}

If you cannot identify BOTH a clear recipe title AND at least one ingredient line in the document, return instead:
{"error": "brief explanation of what is missing or why this does not appear to be a recipe"}

Return ONLY valid JSON. No explanation, no markdown, no code fences."""


class ImportMarkdownRequest(BaseModel):
    markdown: str


class ImportMarkdownResponse(BaseModel):
    title: str
    servings: int
    ingredients_text: str
    instructions: str
    notes: str
    tags: list[str]
    source_url: Optional[str]


@router.post("/import-markdown", response_model=ImportMarkdownResponse)
async def import_markdown(payload: ImportMarkdownRequest):
    if not payload.markdown.strip():
        raise HTTPException(status_code=422, detail="Markdown content is required.")

    try:
        raw = await AIService().complete_with_system(
            IMPORT_MARKDOWN_SYSTEM_PROMPT,
            f"Extract recipe data from the following markdown:\n\n{payload.markdown}",
        )
    except (ValueError, RuntimeError) as exc:
        logger.error("AI import-markdown failed: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.MULTILINE).strip()

    try:
        data = json.loads(raw)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI returned invalid JSON: {exc}") from exc

    if "error" in data:
        raise HTTPException(status_code=422, detail=str(data["error"]))

    missing = [k for k in ("title", "ingredients_text") if not str(data.get(k, "")).strip()]
    if missing:
        raise HTTPException(status_code=422, detail=f"Could not extract required fields: {', '.join(missing)}")

    return ImportMarkdownResponse(
        title=str(data.get("title", "")).strip(),
        servings=int(data.get("servings") or 1),
        ingredients_text=str(data.get("ingredients_text", "")).strip(),
        instructions=str(data.get("instructions", "")).strip(),
        notes=str(data.get("notes") or "").strip(),
        tags=[str(t).lower().strip() for t in (data.get("tags") or []) if str(t).strip()],
        source_url=str(data["source_url"]).strip() if data.get("source_url") else None,
    )


AI_EDIT_SYSTEM_PROMPT = """You are a sous chef for Mise, embedded in one recipe's detail page — a collaborator \
the cook talks through the dish with, not a line cook who silently executes and reports back. You are given the \
current recipe as JSON (it may include a "macros" block: computed nutrition per serving, in total, and per \
ingredient — use those numbers when reasoning about calories/protein/carbs/fat, and treat any ingredient with \
"matched": false as unknown rather than guessing its nutrition) and one message from the cook.

You do not owe the cook a change or a suggestion in every response. Prior turns in this conversation are \
proposals only — the cook accepts or declines each one individually in the app UI, which you cannot see, so \
never treat your own earlier reasoning as a settled fact or a premise already agreed to. Re-justify anything \
you carry forward, and if the cook pushes back or says they don't trust a change, that is your cue to explain \
your reasoning or ask what's bothering them — not to paper over it with another proposal.

Decide which of three modes applies, and respond in ONLY that mode:

MODE 1 — Direct instruction. The cook named a concrete, unambiguous edit: a specific field, ingredient, or \
value to change (e.g. "halve the salt", "convert the butter to grams", "add a pinch of cumin", "rename this to \
X"). Propose the SMALLEST set of changes that satisfies it, in "changes" — only what directly implements this \
message, nothing bundled in that you merely noticed along the way, however reasonable it seems. Never invent a \
constraint (measurement precision, equipment limits, ingredient behavior) to justify a change unless it's \
stated in the recipe data or the cook's own words. Leave "suggestions" as [].

MODE 2 — Everything else: a problem description, a complaint, a quality judgment, or a request for ideas — \
even a flat statement with no question mark (e.g. "this doesn't taste good", "the crust isn't working", \
"lacking anything resembling X", "the calories are too high", "how do I make this healthier?", "why might this \
be bland?", "look this over and suggest improvements"). The cook naming a problem is not authorization to pick \
a fix yourself — that's exactly when a sous chef proposes options and lets the cook choose. Default to this \
mode whenever the message raises a problem or an idea about the dish itself without naming a specific edit. \
Think like an experienced cook and, separately, a \
nutritionist — the way a sous chef would talk through a dish with the cook: name what's actually working \
against the dish (structure, seasoning, technique, balance), not just one surface complaint.

For a broad ask ("review this", "make it better", "how's this look?") with no narrow complaint, lead with ONE \
comprehensive suggestion that bundles every complementary fix you'd recommend together — a full "here's the \
version I'd make" — with each individual tweak captured as its own entry in that suggestion's "changes" (the \
cook can still accept or decline each one separately; bundling only affects how it's presented, not the \
cook's control over it). After that, add up to 3 smaller or alternative suggestions for anyone who wants a \
lighter touch or a different direction. For a narrow complaint about one specific thing, skip the bundling and \
just offer 2-4 distinct, independently-choosable options as before. Never populate both "changes" and \
"suggestions" in the same response.

If one physical detail you don't have (pan size/shape, spice tolerance, equipment) would meaningfully change \
the recommendation, say so as an aside in "reply" or in the relevant suggestion's "rationale" — but still give \
your best suggestions under a stated reasonable assumption rather than stalling on a question.

Respect the recipe's stated intent. If the recipe (title, tags, notes, or the cook's own words) signals a \
constraint — "high protein", "keto", "gluten-free", "vegan", etc. — a fix must not silently abandon it. When a \
complaint is hard to solve without dropping that constraint, say so plainly in "rationale" and, where a \
reasonable option exists, include at least one suggestion that solves the complaint while keeping the \
constraint intact (e.g. a bland "high-protein crust" gets suggestions that season or texture it differently, \
not a swap to a conventional flour crust — offer the flour-crust idea, if at all, as an explicitly-labeled \
"drops the high-protein angle" option alongside ones that don't).

MODE 3 — Not a request about the dish at all: feedback about you, a question about what you did or why, \
pushback, distrust, or the cook just thinking out loud with nothing concrete to act on yet. Respond in plain \
conversation — answer the question, explain your reasoning, ask what they'd rather you do, or push back \
yourself if you think they're wrong — and leave "proposed" as {}, "changes" as [], and "suggestions" as []. \
This is the mode for "you're not being conversational," "I don't trust that," "why did you do that," or "what \
do you mean?" — don't respond to any of those by manufacturing a new change or suggestion.

Return ONLY a JSON object with these keys: "reply", "proposed", "changes", "suggestions".

"reply": one or two plain sentences — what you changed (Mode 1), a short framing of the options (Mode 2), or a \
direct answer, question, or pushback with nothing to apply (Mode 3).

"proposed": an object containing ONLY the fields you changed, at their final value. Allowed fields:
title, servings, tags, ingredients, notes, instructions, cookbook. When you change any ingredient,
"proposed.ingredients" must be the COMPLETE updated array. Leave {} in Modes 2 and 3.

"changes": (Mode 1) an array with one entry per discrete, independently-acceptable edit:
{
  "op": "update" | "add" | "remove",
  "field": "ingredients" | "title" | "servings" | "tags" | "notes" | "instructions" | "cookbook",
  "target_id": "<ingredient id>" for ingredient update/remove, otherwise null,
  "label": "short human summary, e.g. 'Salt — 10 g → 5 g'",
  "before": <prior value>,
  "after": <new value>,
  "why": "brief reason, referencing the instruction"
}

"suggestions": (Mode 2) an array of up to 4 options:
{
  "title": "short label — 'The version I'd make' for a bundled full rewrite, or e.g. 'Swap heavy cream for \
half-and-half' for a single-idea option",
  "rationale": "1-2 sentences on why this addresses the cook's concern — cite real numbers from \"macros\" \
when the concern is nutritional (e.g. 'cuts ~90 kcal/serving'), or the flavor/technique principle when it's \
about taste or texture",
  "changes": [ same Change objects as Mode 1 — one bundled suggestion may contain several complementary \
changes; a single-idea suggestion has just its one ]
}
A suggestion's "changes" may be [] when the idea is technique or timing advice with nothing to edit in the \
recipe data (e.g. "sear the meat before braising for more depth", "let it rest 10 minutes before slicing").
Only include a "changes" entry inside a suggestion when it is a complete, ready-to-apply edit on its own —
do not split one option's edit across multiple suggestions.

Rules that apply to any "changes" you emit, in any mode:
- ingredients: keep the "id" of every ingredient you retain. New ingredients get "id": null.
  Keep "ingredient_id" unchanged unless the ingredient's identity changed; if a rename breaks that
  link, set "ingredient_id": null and say so in "why".
- For an ingredient "update", "after" is an object with only the changed keys (e.g. {"amount": 5}).
- For an ingredient "add", "after" is a full ingredient object {name, amount, unit, ingredient_id, group_name}.
- amounts are numbers, in each ingredient's existing unit. Convert units only if asked.
- instructions is a markdown string. Edit it in place; preserve numbering and the author's voice.
- NEVER change: id, created_at, updated_at, image_url, rating, source_url, steps.
- If a Mode 1 instruction is unclear, unsafe, or a no-op, return "changes": [] and explain in "reply".
  Do not guess.
- Return only the JSON. No prose, no code fences."""


_AI_EDIT_ALLOWED_FIELDS = {"title", "servings", "tags", "ingredients", "notes", "instructions", "cookbook"}


def _parse_json_block(raw: str) -> dict:
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.MULTILINE).strip()
    data = json.loads(cleaned)
    if not isinstance(data, dict):
        raise ValueError("expected a JSON object")
    return data


def _steps_to_instructions(steps: list) -> str:
    """Server-side mirror of the frontend's stepsToInstructions."""
    out: list[str] = []
    for i, step in enumerate(steps or [], start=1):
        title = (step.get("title") or "").strip()
        content = (step.get("content") or "").strip()
        if title and content:
            out.append(f"{i}. {title}\n{content}")
        else:
            out.append(f"{i}. {title or content}")
    return "\n\n".join(out).strip()


def _macros_for_ai(macros: "MacrosResponse") -> dict:
    """Compact nutrition summary so the model reasons from real numbers, not guesses."""
    return {
        "servings": macros.servings,
        "per_serving": macros.per_serving.model_dump(),
        "total": macros.total.model_dump(),
        "ingredients": [
            {
                "name": b.name,
                "amount": b.amount_display,
                "calories": b.calories,
                "protein": b.protein,
                "carbs": b.carbs,
                "fat": b.fat,
                "matched": b.matched,
            }
            for b in macros.breakdown
        ],
    }


def _recipe_for_ai(recipe: Recipe, macros: "MacrosResponse | None" = None) -> dict:
    instructions = (recipe.instructions or "").strip() or _steps_to_instructions(recipe.steps or [])
    data = {
        "title": recipe.title,
        "servings": recipe.servings,
        "tags": recipe.tags or [],
        "notes": recipe.notes or "",
        "instructions": instructions,
        "ingredients": [
            {
                "id": ing.get("id"),
                "name": ing.get("name"),
                "amount": ing.get("amount"),
                "unit": ing.get("unit"),
                "ingredient_id": ing.get("ingredient_id"),
                "group_name": ing.get("group_name"),
            }
            for ing in (recipe.ingredients or [])
        ],
    }
    if macros is not None:
        data["macros"] = _macros_for_ai(macros)
    return data


def _build_edit_messages(recipe_json: dict, conversation: list, instruction: str) -> list[dict]:
    messages: list[dict] = [
        {"role": "system", "content": AI_EDIT_SYSTEM_PROMPT},
        {"role": "user", "content": f"Current recipe (JSON):\n{json.dumps(recipe_json, ensure_ascii=False)}"},
    ]
    for turn in (conversation or [])[-8:]:
        messages.append({"role": turn.role, "content": turn.content})
    messages.append({"role": "user", "content": f"Instruction: {instruction}"})
    return messages


def _normalize_change_list(
    recipe: Recipe, existing: dict, raw_changes, counter: int
) -> tuple[list[Change], int]:
    """Validate a raw model-proposed change list against the recipe. Returns (changes, next_counter)."""
    changes: list[Change] = []

    for rc in raw_changes if isinstance(raw_changes, list) else []:
        if not isinstance(rc, dict):
            continue
        op = rc.get("op")
        if op not in ("update", "add", "remove"):
            continue

        field = rc.get("field") or ""
        target_id = rc.get("target_id")
        is_ingredient = field == "ingredients" or target_id is not None
        after = rc.get("after")

        if is_ingredient:
            field = "ingredients"
            if op in ("update", "remove"):
                target_id = str(target_id) if target_id is not None else None
                if target_id not in existing:
                    continue
                if op == "update" and isinstance(after, dict):
                    current = existing[target_id]
                    if after and all(current.get(k) == v for k, v in after.items()):
                        continue  # no-op
                    # A renamed ingredient that leaves ingredient_id untouched keeps the
                    # old DB link, so the UI displays the linked ingredient's canonical
                    # name instead of the new one and the change looks like it never
                    # applied. The model is told to null ingredient_id on a real
                    # substitution, but a minimal "only changed keys" diff easily omits
                    # it — so treat an unaddressed name change as breaking the link.
                    if "name" in after and "ingredient_id" not in after:
                        old_name = str(current.get("name") or "").strip().lower()
                        new_name = str(after.get("name") or "").strip().lower()
                        if old_name != new_name:
                            after = {**after, "ingredient_id": None}
            else:  # add
                if not isinstance(after, dict) or not str(after.get("name") or "").strip():
                    continue
                after = {
                    "id": f"ing-{uuid.uuid4().hex[:12]}",
                    "name": str(after.get("name")).strip(),
                    "amount": after.get("amount") or 0,
                    "unit": str(after.get("unit") or "").strip(),
                    "ingredient_id": after.get("ingredient_id"),
                    "group_name": after.get("group_name"),
                }
                target_id = after["id"]
        else:
            if field not in _AI_EDIT_ALLOWED_FIELDS or op != "update":
                continue
            target_id = None
            if after == getattr(recipe, field, None):
                continue  # no-op

        counter += 1
        changes.append(Change(
            id=f"chg-{counter}",
            op=op,
            field=field or "ingredients",
            target_id=target_id,
            label=str(rc.get("label") or "").strip() or f"{op} {field or 'ingredients'}",
            before=rc.get("before"),
            after=after,
            why=str(rc.get("why") or "").strip(),
        ))

    return changes, counter


def _normalize_suggestions(
    recipe: Recipe, existing: dict, raw_suggestions, counter: int
) -> tuple[list[Suggestion], int]:
    """Validate model-proposed diagnostic suggestions (e.g. 'cut the calories')."""
    suggestions: list[Suggestion] = []

    for i, rs in enumerate(raw_suggestions if isinstance(raw_suggestions, list) else [], start=1):
        if not isinstance(rs, dict):
            continue
        title = str(rs.get("title") or "").strip()
        rationale = str(rs.get("rationale") or "").strip()
        s_changes, counter = _normalize_change_list(recipe, existing, rs.get("changes"), counter)

        if not title and not rationale and not s_changes:
            continue  # nothing usable in this suggestion

        suggestions.append(Suggestion(
            id=f"sug-{i}",
            title=title or f"Option {i}",
            rationale=rationale,
            changes=s_changes,
        ))

    return suggestions[:4], counter


def _normalize_edit(recipe: Recipe, data: dict) -> AiEditResponse:
    """Sanitize raw model output: strip forbidden fields, re-key toggles, validate ingredient targets."""
    reply = str(data.get("reply") or "").strip()

    existing = {str(i.get("id")): i for i in (recipe.ingredients or []) if i.get("id") is not None}

    changes, counter = _normalize_change_list(recipe, existing, data.get("changes"), 0)
    suggestions, _ = _normalize_suggestions(recipe, existing, data.get("suggestions"), counter)

    proposed_raw = data.get("proposed")
    proposed_clean = (
        {k: v for k, v in proposed_raw.items() if k in _AI_EDIT_ALLOWED_FIELDS}
        if isinstance(proposed_raw, dict)
        else {}
    )
    try:
        proposed = RecipeUpdate(**proposed_clean)
    except Exception:
        proposed = RecipeUpdate()

    return AiEditResponse(reply=reply, proposed=proposed, changes=changes, suggestions=suggestions)


@router.post("/{recipe_id}/ai-edit", response_model=AiEditResponse)
async def ai_edit_recipe(recipe_id: int, payload: AiEditRequest, db: Session = Depends(get_db)):
    recipe = db.query(Recipe).filter(Recipe.id == recipe_id).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    instruction = payload.instruction.strip()
    if not instruction:
        raise HTTPException(status_code=422, detail="Describe the change you want.")
    if len(instruction) > 2000:
        raise HTTPException(status_code=422, detail="Instruction is too long (2000 character maximum).")

    macros = _compute_macros(recipe, db)
    messages = _build_edit_messages(_recipe_for_ai(recipe, macros), payload.conversation, instruction)

    try:
        raw = await AIService()._call(messages, response_format={"type": "json_object"})
    except ValueError as exc:  # missing API key
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        logger.error("AI edit failed: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    try:
        data = _parse_json_block(raw)
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=f"AI returned invalid JSON: {exc}") from exc

    return _normalize_edit(recipe, data)


def _compute_macros(recipe: Recipe, db: Session) -> MacrosResponse:
    ingredients = recipe.ingredients or []
    servings = recipe.servings or 1
    total_count = len(ingredients)
    matched_count = 0
    totals = {"calories": 0.0, "protein": 0.0, "carbs": 0.0, "fat": 0.0}
    breakdown: list[IngredientBreakdown] = []

    for ing in ingredients:
        rid = ing.get("id") or None
        ing_name = (ing.get("name") or "").strip()
        amount_raw = ing.get("amount") or 0
        unit_raw = str(ing.get("unit") or "")
        amount_display = f"{amount_raw} {unit_raw}".strip()

        db_ing = None
        ing_id = ing.get("ingredient_id")
        if ing_id:
            db_ing = db.query(Ingredient).filter(Ingredient.id == int(ing_id)).first()
        if db_ing is None and ing_name:
            db_ing = db.query(Ingredient).filter(Ingredient.name.ilike(ing_name)).first()

        if db_ing is None or any(v is None for v in [db_ing.calories, db_ing.protein, db_ing.carbs, db_ing.fat]):
            breakdown.append(IngredientBreakdown(
                recipe_ingredient_id=rid, name=ing_name, amount_display=amount_display,
                calories=None, protein=None, carbs=None, fat=None, matched=False,
            ))
            continue

        amount = float(amount_raw)
        stripped_unit = unit_raw.lower().strip()
        if stripped_unit in _COUNT_UNITS or not stripped_unit:
            # Count-based: divide count by serving_quantity so e.g. "6 count" of a
            # 3-per-serving item gives factor=2 (2 servings' worth of macros)
            serving_qty = float(getattr(db_ing, "serving_quantity", None) or 1)
            factor = amount / serving_qty
        else:
            grams = _to_grams(amount, unit_raw, getattr(db_ing, "serving_grams", None), ing_name)
            if grams is None or grams <= 0:
                breakdown.append(IngredientBreakdown(
                    recipe_ingredient_id=rid, name=ing_name, amount_display=amount_display,
                    calories=None, protein=None, carbs=None, fat=None, matched=False,
                ))
                continue
            ref_g = _reference_grams(db_ing)
            factor = grams / ref_g
        cal = db_ing.calories * factor
        prot = db_ing.protein * factor
        carbs_v = db_ing.carbs * factor
        fat_v = db_ing.fat * factor

        totals["calories"] += cal
        totals["protein"] += prot
        totals["carbs"] += carbs_v
        totals["fat"] += fat_v
        matched_count += 1

        breakdown.append(IngredientBreakdown(
            recipe_ingredient_id=rid, name=db_ing.name, amount_display=amount_display,
            calories=round(cal, 1), protein=round(prot, 1),
            carbs=round(carbs_v, 1), fat=round(fat_v, 1), matched=True,
        ))

    per_serving = {k: v / servings for k, v in totals.items()}

    return MacrosResponse(
        per_serving=MacroValues(**{k: round(v, 1) for k, v in per_serving.items()}),
        total=MacroValues(**{k: round(v, 1) for k, v in totals.items()}),
        servings=servings,
        matched_count=matched_count,
        total_count=total_count,
        breakdown=breakdown,
    )


@router.get("/{recipe_id}/macros", response_model=MacrosResponse)
def get_recipe_macros(recipe_id: int, db: Session = Depends(get_db)):
    recipe = db.query(Recipe).filter(Recipe.id == recipe_id).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    return _compute_macros(recipe, db)


class ShoppingListRequest(BaseModel):
    recipe_ids: list[int]


def _fmt_amount(value: float) -> str:
    rounded = round(value, 2)
    return str(int(rounded)) if rounded == int(rounded) else str(rounded)


class SuggestTagsRequest(BaseModel):
    recipe_name: Optional[str] = None
    ingredients: Optional[str] = None
    instructions: Optional[str] = None


class SuggestTagsResponse(BaseModel):
    tags: list[str]


@router.post("/suggest-tags", response_model=SuggestTagsResponse)
async def suggest_tags(payload: SuggestTagsRequest):
    parts = []
    if payload.recipe_name:
        parts.append(f"Recipe name: {payload.recipe_name}")
    if payload.ingredients:
        parts.append(f"Ingredients:\n{payload.ingredients}")
    if payload.instructions:
        parts.append(f"Instructions:\n{payload.instructions[:1000]}")
    if not parts:
        return SuggestTagsResponse(tags=[])
    try:
        result = await AIService().complete_with_system(TAG_GENERATION_SYSTEM_PROMPT, "\n\n".join(parts))
        import json as _json
        tags = _json.loads(result)
        if isinstance(tags, list):
            return SuggestTagsResponse(tags=[str(t).lower().strip() for t in tags if str(t).strip()][:6])
    except Exception:
        pass
    return SuggestTagsResponse(tags=[])


@router.post("/shopping-list", response_class=PlainTextResponse)
def generate_shopping_list(payload: ShoppingListRequest, db: Session = Depends(get_db)):
    if not payload.recipe_ids:
        return PlainTextResponse("")

    db_recipes = db.query(Recipe).filter(Recipe.id.in_(payload.recipe_ids)).all()

    # ingredient_id → {name, total_grams, dominant_unit, dominant_grams, is_count, count_total}
    merged: dict[int, dict] = {}
    unmatched: list[tuple[str, float, str]] = []

    for recipe in db_recipes:
        for ing in (recipe.ingredients or []):
            ing_id = ing.get("ingredient_id")
            name = (ing.get("name") or "").strip()
            unit_raw = str(ing.get("unit") or "").strip()
            try:
                amount = float(ing.get("amount") or 0)
            except (ValueError, TypeError):
                amount = 0.0

            if not ing_id:
                unmatched.append((name, amount, unit_raw))
                continue

            db_ing = db.query(Ingredient).filter(Ingredient.id == int(ing_id)).first()
            serving_g = getattr(db_ing, "serving_grams", None) if db_ing else None
            grams = _to_grams(amount, unit_raw, serving_g, name)
            display_name = db_ing.name if db_ing else name

            if ing_id not in merged:
                merged[ing_id] = {
                    "name": display_name,
                    "total_grams": grams,
                    "dominant_unit": unit_raw,
                    "dominant_grams": grams if grams is not None else 0.0,
                    "is_count": grams is None,
                    "count_total": amount if grams is None else 0.0,
                }
            else:
                entry = merged[ing_id]
                if grams is not None:
                    entry["total_grams"] = (entry["total_grams"] or 0.0) + grams
                    if grams > entry["dominant_grams"]:
                        entry["dominant_unit"] = unit_raw
                        entry["dominant_grams"] = grams
                    entry["is_count"] = False
                else:
                    entry["count_total"] += amount

    lines: list[str] = []

    for entry in merged.values():
        name = entry["name"]
        if entry["is_count"]:
            total = entry["count_total"]
            unit = entry["dominant_unit"]
            lines.append(f"{name} - {_fmt_amount(total)}{' ' + unit if unit else ''}")
        else:
            total_g = entry["total_grams"] or 0.0
            dom_unit = entry["dominant_unit"] or "g"
            factor = _UNIT_TO_GRAMS.get(dom_unit.lower(), 1.0)
            converted = total_g / factor
            lines.append(f"{name} - {_fmt_amount(converted)} {dom_unit}")

    for name, amount, unit in unmatched:
        if not name:
            continue
        amt_str = _fmt_amount(amount) if amount else ""
        suffix = f"{' ' + unit if unit else ''}" if amt_str else ""
        lines.append(f"{name}{' - ' + amt_str + suffix if amt_str else ''}")

    lines.sort(key=lambda s: s.lower())
    return PlainTextResponse("\n".join(lines))


@router.get("/export-all")
def export_all_recipes(db: Session = Depends(get_db)):
    recipes = db.query(Recipe).order_by(Recipe.created_at.asc()).all()
    buf = io.BytesIO()
    used: set[str] = set()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for recipe in recipes:
            base = _slugify(recipe.title or "recipe")
            slug = base
            counter = 2
            while slug in used:
                slug = f"{base}-{counter}"
                counter += 1
            used.add(slug)
            zf.writestr(f"{slug}.md", _recipe_to_markdown(recipe))
    filename = f"mise-recipes-{date.today().isoformat()}.zip"
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/cookbooks", response_model=list[str])
def list_cookbooks(db: Session = Depends(get_db)):
    rows = (
        db.query(Recipe.cookbook)
        .filter(Recipe.cookbook.isnot(None), Recipe.cookbook != "")
        .distinct()
        .order_by(Recipe.cookbook.asc())
        .all()
    )
    return [r.cookbook for r in rows]


@router.get("", response_model=list[RecipeResponse])
def list_recipes(db: Session = Depends(get_db)):
    return db.query(Recipe).order_by(Recipe.created_at.desc()).all()


@router.get("/{recipe_id}/export")
def export_recipe(recipe_id: int, db: Session = Depends(get_db)):
    recipe = db.query(Recipe).filter(Recipe.id == recipe_id).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    slug = _slugify(recipe.title or "recipe")
    return Response(
        content=_recipe_to_markdown(recipe).encode("utf-8"),
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{slug}.md"'},
    )


@router.get("/{recipe_id}", response_model=RecipeResponse)
def get_recipe(recipe_id: int, db: Session = Depends(get_db)):
    recipe = db.query(Recipe).filter(Recipe.id == recipe_id).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return recipe


@router.post("", response_model=RecipeResponse, status_code=201)
def create_recipe(data: RecipeCreate, db: Session = Depends(get_db)):
    recipe = Recipe(**data.model_dump())
    db.add(recipe)
    db.commit()
    db.refresh(recipe)
    return recipe


@router.patch("/{recipe_id}", response_model=RecipeResponse)
def update_recipe(recipe_id: int, data: RecipeUpdate, db: Session = Depends(get_db)):
    recipe = db.query(Recipe).filter(Recipe.id == recipe_id).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(recipe, field, value)
    recipe.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(recipe)
    return recipe


@router.delete("/{recipe_id}")
def delete_recipe(recipe_id: int, db: Session = Depends(get_db)):
    recipe = db.query(Recipe).filter(Recipe.id == recipe_id).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    db.delete(recipe)
    db.commit()
    return {"deleted": True}
