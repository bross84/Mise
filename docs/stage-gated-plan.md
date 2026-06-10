# Stage-Gated Plan

## 2026-06-09

### Stage: Implemented
- Prompt 18 — Serving scaler toggle polished (replaced checkboxes with a proper pill toggle) — completed by Claude Code.
- Prompt 19 — Surprise Me button (Shuffle icon, navigates to random recipe, amber accent styling) — completed by Claude Code.
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
