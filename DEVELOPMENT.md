# Development Notes

## Current Focus: New UI Frontend (vNext)

We are building a **new frontend UI** to eventually replace the existing Leaflet.js-based
dashboard. The old UI remains fully functional and untouched at `/` while the new one is
developed at `/vnext`.

### Architecture

- **Old UI (stable, do not modify):**
  - `web/templates/index.html` + `web/static/js/dashboard.js` + `web/static/css/style.css`
  - Leaflet.js map, feature-complete, serves at `/`

- **New UI (active development):**
  - `web/templates/bitindex.html` + `web/static/js/bitapp.js` + `web/static/css/bitstyle.css`
  - Custom HTML5 Canvas map, no external map dependencies, serves at `/vnext`

- **Shared backend:** `web/MBCoreServer.py` (FastAPI) - both UIs use the same API endpoints

### Rules

1. **Do not change** the old UI files (`index.html`, `dashboard.js`, `style.css`)
2. All new frontend work goes into the `bit*` files (`bitindex.html`, `bitapp.js`, `bitstyle.css`)
3. Backend changes in `MBCoreServer.py` are okay as long as existing API contracts are preserved
4. The old UI must continue to work exactly as it does today

### Development Branch

`claude/new-ui-frontend-C6yVJ`
