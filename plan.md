# Plan

## 2026-06-10

- Updated Add Recipe unmatched flow so accepting a match from Ingredient Matches immediately removes that row from the unmatched list.
- Rounded search endpoint macro outputs (calories/protein/carbs/fat) to 1 decimal for local, USDA, and OFF result payloads.
- Updated OFF handling to keep serving-level macros as-is when provided (or derive per-serving values from 100g using serving grams when needed), set unit to the actual serving size (for example `per 63g`), and persist OFF barcodes for saved ingredients.
- Updated Ingredient Database to render OFF ingredient names as outbound Open Food Facts links when barcode is stored (`https://world.openfoodfacts.org/product/{barcode}`), while preserving plain text names when no barcode exists.
- Added backend support for `barcode` persistence (`Ingredient` model/schema + table migration) and idempotent barcode backfill on existing ingredient rows.
- Updated ingredient search no-local-results state in both Add Recipe and Recipe Detail panels: replaced single combined external action with separate `Search USDA` and `Search Open Food Facts` buttons, and added source-specific external search routing (`external_source`) for independent provider calls.
- Added `Search by barcode` option in both panels that switches to barcode input mode and queries Open Food Facts product endpoint (`/api/v0/product/{barcode}.json`) for a direct single-product lookup.
- Kept external result selection behavior unchanged so selecting a USDA/OFF/barcode result still auto-saves to the local ingredient DB flow.
- Fixed ingredient search flow across backend and recipe pages: switched Open Food Facts host to `us.openfoodfacts.org`, added optional local-only mode in `/api/ingredients/search`, and changed merge order to USDA-first then OFF with dedupe.
- Updated USDA search auth to use `USDA_API_KEY` (or `FDC_API_KEY`) from environment with `DEMO_KEY` fallback so production/dev keys can restore USDA results (including common queries like "chicken breast").
- Updated Add Recipe ingredient search panel to query local DB first and show an explicit `No local results - search USDA & Open Food Facts?` action before any external lookup.
- Added the same explicit local-first/external-opt-in ingredient search panel in Recipe Detail edit mode, with external selections continuing to auto-save into the local ingredient DB.

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
