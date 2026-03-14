# GridScope NY

A premium NYISO market intelligence dashboard with a React + Vite frontend and Python FastAPI backend.

## Architecture

- **Frontend**: React + Vite (TypeScript), port 5000 — premium dark sidebar, Inter font, insight-driven pages
- **Backend**: FastAPI (Python), port 8000 — serves processed NYISO data as JSON REST API with resolution aggregation
- **Data Layer**: Pandas-based ETL that fetches and processes CSV data from NYISO MIS
- **Entry point**: `start.sh` — starts FastAPI backend then React frontend

## Design System

The app uses a custom CSS design system (no Tailwind) with CSS variables for theming:
- **Colors**: Primary blue (#2563eb), Accent green (#10b981), dark sidebar (#0f172a)
- **Typography**: Inter font, strong weight hierarchy (400-800)
- **Components**: KPI cards, chart cards, insight cards, rank tables, pill selectors, collapsible sections
- **Layout**: Dark sidebar with branding, sectioned nav (Market Data / Tools), light content area

### Reusable CSS Classes
- `.kpi-grid` / `.kpi-card` — metric display cards with accent/primary variants
- `.chart-card` — chart containers with header and badge
- `.insight-card` — blue gradient insight/summary panels
- `.rank-table` — styled ranking tables with numbered badges
- `.pill-group` / `.pill` — pill-style toggle buttons
- `.filter-bar` / `.filter-group` — filter containers
- `.collapsible-header` / `.collapsible-body` — expandable sections
- `.section-container` / `.section-title` — page sections
- `.workflow-steps` / `.workflow-step` — numbered step cards

## Project Structure

```
start.sh                  # Combined startup script (backend + frontend)
api.py                    # FastAPI backend entry point (v2.0)
frontend/
  src/
    App.tsx               # Root with React Router
    index.css             # Full design system (CSS variables, all component styles)
    components/
      Layout.tsx          # Dark sidebar with branding, sectioned nav
      LineChart.tsx       # Recharts line chart wrapper (multi-line, wide-format, robust fmtX for dates)
      SeriesSelector.tsx  # Multi-select dropdown for filtering chart series (zones, fuels, etc.)
      MetricsRow.tsx      # Summary metrics cards (legacy, used by DatasetSection)
      DataTable.tsx       # Paginated data table
      DatasetSection.tsx  # Collapsible dataset card (chart + metrics + table)
      ResolutionSelector.tsx  # Resolution pill toggle buttons
      EmptyState.tsx      # Empty state with ETL trigger button
    hooks/
      useDataset.ts       # Data fetching hook with resolution support
    pages/
      Home.tsx            # Market Overview — KPIs, workflow steps, nav tiles
      Prices.tsx          # Price Intelligence — DA/RT comparison, spread analysis
      Demand.tsx          # Demand Intelligence — forecast vs actual, error analysis
      Generation.tsx      # Generation Mix — fuel breakdown, share analysis
      InterfaceFlows.tsx  # Interface Flows — utilization, pressure analysis
      Congestion.tsx      # Congestion Analysis — constraint rankings, outages
      OpportunityExplorer.tsx  # Hero: Flex Opportunity Explorer with bar charts, zone detail, drivers
      GeneratorMap.tsx     # Generator Price Map — Leaflet geographic LMP/MLC/MCC visualization
      AIExplainer.tsx     # AI Market Analyst — structured Q&A with drivers/caveats, context-aware
src/
  api_data_loader.py      # Dataset metadata (40 datasets), aggregation, caching (Parquet-first, CSV fallback)
  config.py               # App constants (dirs, API keys)
ETL/
  fetch_nyiso_data.py     # Fetches CSVs from NYISO MIS (7-day rolling window)
  process_nyiso_data.py   # Cleans, renames, and saves processed CSVs
data/
  raw/                    # Raw NYISO CSV files
  processed/              # Cleaned CSVs + Parquet files consumed by the API (Parquet preferred)
```

## Page Architecture

Each page follows the intelligence layout pattern:
1. **Page Header** — title + subtitle
2. **Resolution/Filter Bar** — pill toggles + SeriesSelector multi-select dropdowns
3. **KPI Cards** — 3-5 key metrics
4. **Primary Charts** — chart cards with headers and badges (all categories accessible)
5. **Insight Card** — deterministic text summary of current data
6. **Rankings/Tables** — styled rank tables (not raw data)
7. **Collapsible Raw Data** — expandable section with DatasetSection components

### SeriesSelector
Reusable dropdown with checkboxes for filtering chart series. Used on all data pages:
- Prices: Zone selector (15 zones)
- Demand: Zone selector (12 zones)
- Generation: Fuel type selector (7 types)
- Interface Flows: Interface selector (19 interfaces, default top 8)
- Congestion: Constraint selector (28 constraints, default top 8)
CSS classes: `.series-selector-*` in `index.css`

## API Endpoints (v2.0)

- `GET /api/health` — health check
- `GET /api/inventory` — data availability across all pages/datasets
- `GET /api/dataset/{key}?resolution=raw|hourly|on_peak|off_peak|daily&limit=10000`
- `GET /api/page/{page}` — list datasets for a page
- `GET /api/filters/{key}/{col}` — filter options for a column
- `GET /api/generator-map?market=DA|RT&date=YYYY-MM-DD&he=0-23` — generator geographic price data (561 mapped generators)
- `POST /api/ai-explainer` — structured AI market analysis with drivers/caveats (requires OPENAI_API_KEY)
- `POST /api/explain` — backward-compatible AI explanation wrapper
- `POST /api/etl/fetch` / `POST /api/etl/process` — trigger ETL

## Resolution Aggregation

- **Raw**: Original data as-is
- **Hourly**: Group by hour + group_cols, mean of value_cols
- **On-Peak Avg**: HE 7-22 average per day
- **Off-Peak Avg**: HE 0-6, 23 average per day
- **Daily**: Full day average
- DataFrame cache with mtime-based invalidation for performance
- Parquet format preferred over CSV for faster loading (pyarrow)

## Running

```bash
bash start.sh
```

## Dependencies

Python: fastapi, uvicorn, pandas, numpy, pyarrow, plotly, python-dotenv, openpyxl, requests
Node: react, react-router-dom, recharts, leaflet, react-leaflet, vite
