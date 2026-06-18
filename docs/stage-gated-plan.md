# Stage-Gated Plan

## 2026-06-17

### Stage: Implemented
- "Mise en Place" title in both the mobile fixed header and the sidebar in App.jsx is now a `<Link to="/">` that navigates to the Recipe Browser from any page. Hover transitions to a slightly lighter text color to signal interactivity; no underline style used.
- Action button row in RecipeDetail.jsx is now `sticky top-16 md:top-0 z-20` so Edit/Delete/Save/Cancel/Back buttons remain visible without scrolling back to the top of a long recipe. A semi-transparent blurred background (`bg-mise-950/95 backdrop-blur border-b border-mise-800`) prevents content from bleeding through.

## 2026-06-16

### Stage: Implemented
- `/api/ingredients/search` now skips local DB lookup entirely when `external_source` is explicitly `usda` or `openfoodfacts`, and proceeds straight to the corresponding external provider fetch flow.
- Add Recipe and Recipe Detail `Search USDA` / `Search Open Food Facts` actions now route through frontend `searchIngredients` to backend `/api/ingredients/search` with source-specific `external_source`, eliminating direct USDA/OFF domain fetches from these frontend pages.
- `/api/ingredients/search` now performs a direct OFF barcode lookup (`/api/v0/product/{barcode}.json`) for 8-14 digit barcode queries when external lookup is active (or source is OFF), returning one parsed OFF result when found and empty results when not found, with no fallback to regular search.
- OFF search result rows in Add Recipe, Recipe Detail, and Ingredient Database now include an OFF-only secondary metadata line showing serving text (`Per serving: {g}` or `Per 100g`) plus barcode when present; USDA result row presentation is unchanged.
- Ingredient Database table redesigned to collapse macro details: main table rows show ingredient name (clickable to expand/collapse), source badge, calories, Edit, Delete; protein/carbs/fat/unit columns hidden by default; clicking name toggles expandable detail row below showing full macro data in muted style; only one row expanded at a time via `expandedId` state; edit mode spans full width with all fields visible in grid layout.
- Add Recipe and Recipe Detail ingredient search panels now keep `Search USDA` and `Search Open Food Facts` available for repeat fresh searches even when results are present, and `Search by barcode` now triggers immediate OFF lookup from the current input value on click instead of waiting for input change.
- Add Recipe and Recipe Detail ingredient search panel actions (`Search USDA`, `Search Open Food Facts`, `Search by barcode`) now render above the result list instead of below, with no change to search logic or result handling behavior.
- Foodish-backed recipe images now load from server-side endpoints: startup migration adds `recipes.image_url` if absent, `/api/recipes/{id}/image` returns cached URLs or fetches and persists a category-matched Foodish image, `/api/recipes/{id}/image/clear` resets the stored URL, Recipe Browser cards show 160px thumbnails with skeleton/emoji fallback, and Recipe Detail shows a 240px hero banner with refresh cycling.
- Auto-generated recipe tags added: `parse-ingredients` endpoint accepts optional `recipe_name` and fires two parallel DeepSeek calls (ingredient parsing + tag generation), returning `suggested_tags` (3-5 lowercase descriptors for cuisine, protein, dietary). AddRecipe.jsx auto-fills the Tags field from suggestions when the field is blank, leaving manually entered tags untouched. Image fetch logic updated to use up to 3 saved recipe tags as the loremflickr search query, falling back to single-keyword title mapping for older tagless recipes.
- Because the Foodish host is suspended here, the backend image route now falls back to a generic free food image source when Foodish fetches fail, but still persists and serves the resulting `image_url` through the same API contract.

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
