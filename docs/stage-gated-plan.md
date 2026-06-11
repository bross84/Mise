# Stage-Gated Plan

## 2026-06-10

### Stage: Implemented
- Add Recipe unmatched Ingredient Matches list now removes an ingredient row immediately after accepting/saving a selected match.
- Ingredient search response macros are now normalized to 1 decimal across local, USDA, and OFF payloads.
- OFF results now preserve serving-level macros as provided (or derive per-serving values from 100g with serving grams), use serving-specific unit text (for example `per 63g`) for serving-based values, and carry barcode values through save flows.
- Ingredient Database now links OFF ingredient names to Open Food Facts product pages when barcode is present; names stay plain text when barcode is absent.
- Backend ingredient persistence now supports `barcode` (model/schema + SQLite migration) and backfills barcode onto existing idempotent matches when new OFF barcode data is supplied.
- Add Recipe and Recipe Detail ingredient search empty-state actions were split into independent external actions: `Search USDA` and `Search Open Food Facts`, backed by source-specific external routing via `external_source`.
- Added `Search by barcode` flow in both panels that switches the query input to numeric barcode mode and calls `https://us.openfoodfacts.org/api/v0/product/{barcode}.json` for direct product lookup.
- Preserved existing selection behavior so choosing any USDA/OFF/barcode hit continues to save to local ingredients through the current auto-save path.
- Ingredient search backend updated to support local-only queries (`include_external=false`) and to merge external results with USDA first, then OFF, deduplicated and capped.
- Open Food Facts search host updated from `world.openfoodfacts.org` to `us.openfoodfacts.org`.
- USDA search key handling updated to use environment keys (`USDA_API_KEY` or `FDC_API_KEY`) with `DEMO_KEY` fallback, fixing environments where demo rate limits suppressed USDA results.
- Add Recipe ingredient search now checks local-only first and requires an explicit `No local results - search USDA & Open Food Facts?` action before external calls.
- Recipe Detail edit mode now includes the same local-first ingredient search behavior with explicit external opt-in and preserved auto-save to local DB when using external results.

## 2026-06-09

### Stage: Implemented
- Prompt 18 — Serving scaler toggle polished (replaced checkboxes with a proper pill toggle) — completed by Claude Code.
- Prompt 19 — Surprise Me button (Shuffle icon, navigates to random recipe, amber accent styling) — completed by Claude Code.
- Recipe Detail now injects Schema.org Recipe JSON-LD for MacroFactor import, removes the script on cleanup, and shows a Share to MacroFactor clipboard action with confirmation.
- Add Recipe ingredient matching panel now lists only unmatched items, re-checks only the added ingredient after Search & Add, hides when resolved, and shows USDA/OFF source badges in search results.
- Ingredient search dropdowns now auto-run on prefilled query mount, support Enter-to-search, and show per-serving macro labels from API serving amounts (falling back to 100g) while storage remains per 100g.
- Add Recipe serving macro label logic now follows the requested serving field precedence (`serving_grams`, `serving_size_g`, `serving_size`, `amount_grams`, default `100`) with explicit per-100g scaling.
- Add Recipe IngredientSearchPanel serving macro labels now render with integer `Math.round` values for calories and macros.
- Frontend recipe and ingredient pages migrated to the FastAPI client, with API env files added and mock imports removed from active pages.
- Recipe description field removed from Add Recipe form/save payload and from mock recipe objects; backend recipe schema/model already had no description field.
- Recipe Detail now includes a top-right destructive Delete Recipe button (Trash2 icon) with confirm dialog, delete API call, redirect, and failure alert.
- OpenRouter integration added via backend AI service and `/api/ai/test`, with dotenv loading and Settings key persistence endpoint/UI wiring.
- AI service model target updated to `anthropic/claude-sonnet-4-6`.

## 2026-06-08

### Stage: Implemented
- Sidebar navigation updated to: Recipes, Add Recipe, Ingredients, Settings.
- Routes updated to include /, /add, /ingredients, /settings; removed /admin.
- Standalone Add Recipe page created from prior Admin Add Recipe form content.
- Settings page created with static dark-theme Tailwind sections:
  - API Keys (OpenRouter key input with show/hide toggle)
  - Units (Metric/Imperial toggle)
  - Theme (Coming soon)
- Admin page removed from active app surface.
- Add Recipe page rebuilt as a two-stage UI:
  - Stage 1 input panel with raw-text textarea, URL field, Fetch button UI, and Parse Recipe action.
  - Stage 2 review form populated by mock parsed result with full inline edit controls.
- Ingredient rows now show matched/unmatched status via case-insensitive lookup in mockIngredients.
- Added Start Over and Save Recipe actions for the review flow (save logs assembled object to console).
- Recipe Browser cards now include full-width gradient image headers themed by first tag and local thumbs up/down rating controls.
- Recipe Detail now includes a taller full-width gradient image header above recipe content.
- Recipe Browser thumb icons now use lucide-react again after package installation; temporary inline SVG fallback removed.
