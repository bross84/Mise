# Plan

## 2026-06-09

- Prompt 18 — Serving scaler toggle polished (replaced checkboxes with a proper pill toggle) — completed by Claude Code.
- Prompt 19 — Surprise Me button (Shuffle icon, navigates to random recipe, amber accent styling) — completed by Claude Code.
- Added Schema.org Recipe JSON-LD to Recipe Detail for MacroFactor import, with cleanup on unmount and a Share to MacroFactor clipboard button in the top-right action row.
- Refined Add Recipe unmatched ingredient flow to show only unmatched items, re-run matching for a single added ingredient, auto-hide panel when none remain, and added USDA/OFF source pills in search results.
- Updated ingredient search dropdowns in Add Recipe and Ingredient Database to auto-search prefilled queries, support Enter-triggered search, and display per-serving macros while keeping saved values normalized per 100g.
- Adjusted Add Recipe serving macro display precedence to use `serving_grams ?? serving_size_g ?? serving_size ?? amount_grams ?? 100` with explicit `(value / 100) * servingGrams` scaling.
- Updated Add Recipe IngredientSearchPanel macro labels to use integer-rounded per-serving output via `Math.round` for calories/protein/carbs/fat.
- Migrated frontend recipe and ingredient pages to the FastAPI client, added API env files, and removed mock data imports from the active pages.
- Removed recipe description field usage from Add Recipe flow and mock recipe data; confirmed backend schema/model already have no description field.
- Added a destructive Delete Recipe action in Recipe Detail with confirmation, API delete call, redirect to recipe list, and failure alert.
- Implemented OpenRouter integration with a new async AI service, `/api/ai/test` endpoint, dotenv loading in backend startup, and a Settings endpoint/UI flow to persist and save OpenRouter API keys.
- Updated AI service model target from `anthropic/claude-3.5-sonnet` to `anthropic/claude-sonnet-4-6`.

## 2026-06-08

- Implemented sidebar navigation and route restructure in frontend app shell.
- Added standalone Add Recipe page at /add by moving the former Admin Add Recipe tab content.
- Added new Settings page at /settings with API key input + show/hide, units toggle, and theme placeholder.
- Removed obsolete Admin page and /admin route.
- Rebuilt Add Recipe page into a two-stage Paste and Review flow with mock parsed data.
- Added inline editing for title, description, servings, tags, ingredients, steps, and notes in review stage.
- Implemented ingredient match status using case-insensitive name matching against mockIngredients and added unmatched CTA UI.
- Added tag-themed gradient image headers to recipe cards in Recipe Browser and a taller matching header in Recipe Detail.
- Added local thumbs up/down rating controls on recipe cards with exclusive toggle states (up, down, unrated).
- Restored lucide-react thumb icons in Recipe Browser after dependency installation succeeded; removed temporary inline SVG fallback.
