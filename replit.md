# GridScope NY

A premium NYISO market intelligence dashboard with a React + Vite frontend and Python FastAPI backend.

## Architecture

- **Frontend**: React + Vite (TypeScript), port 5000 — premium dark sidebar, Inter font, insight-driven pages
- **Backend**: FastAPI (Python), port 8000 — serves processed NYISO data as JSON REST API with resolution aggregation
- **Data Layer**: ETL pipeline with 39 NYISO datasets, 2+ years historical backfill (2024-01 to present), Parquet storage with monthly partitioning for large datasets
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
      Layout.tsx          # Dark sidebar with branding, sectioned nav, mounts MarketAnalystWidget
      MarketAnalystWidget.tsx  # Persistent bottom-right AI chat widget (global cross-market context, all datasets, server-side search_all_datasets for comprehensive analysis)
      LineChart.tsx       # Recharts line chart wrapper (multi-line, wide-format, robust fmtX for dates)
      StackedBarChart.tsx # Recharts stacked bar chart (multi-series, uses same color palette)
      BarChart.tsx        # Recharts bar chart (horizontal/vertical, cell coloring, labels)
      SeriesSelector.tsx  # Multi-select dropdown for filtering chart series (zones, fuels, etc.)
      MetricsRow.tsx      # Summary metrics cards (legacy, used by DatasetSection)
      DataTable.tsx       # Paginated data table
      DatasetSection.tsx  # Collapsible dataset card (chart + metrics + table)
      ResolutionSelector.tsx  # Resolution pill toggle buttons
      EmptyState.tsx      # Empty state with ETL trigger button
    hooks/
      useDataset.ts       # Data fetching hook with resolution support + auto-refetch on data refresh
      useDataRefresh.ts   # Data refresh hook: auto-refresh (5 min), manual refresh, cache clear
    pages/
      Home.tsx            # Market Overview — KPIs, Live System Context (RT events + oper announcements), workflow steps, nav tiles
      Prices.tsx          # Price Intelligence — AI summary, 7 KPI cards, side chart controls, 3 view tabs (DA/RT/DART), ScarcitySignalSection (Energy vs Ancillary Price Signals)
      ScarcitySignalSection.tsx  # Dual-panel scarcity/DR signal charts (LMP + ASP), zone/product/resolution/date controls, KPI cards, summary
      Demand.tsx          # Demand Intelligence — AI summary, 10 KPI cards (forecast/actual peaks+lows, error metrics), side chart controls, 3 view tabs (Zonal/FvA/Error)
      Generation.tsx      # Generation Mix — AI summary, 8 KPI cards (gen peaks, fuel shares, renewable%), side chart controls, 3 view tabs (Fuel/Stack/Total), fuel breakdown table, OIC analytics section (date range picker, KPI cards, 3 chart tabs: by zone/by type/by MW, single-date raw table), embedded Generator Map
      InterfaceFlows.tsx  # Interface Flows — AI summary, 8 KPI cards (on-peak totals, peak flows, most active, top internal/external, count), side chart controls with class/interface/resolution/date/chart-type, flow chart, interface summary table, TTCF Derates section
      Congestion.tsx      # Congestion Analysis — constraint rankings, stacked bar, outages, Constraint Impact Analysis drilldown
      OpportunityExplorer.tsx  # Opportunity Explorer — date range picker, zone rankings, trader + battery takeaways, embedded AI analyst (all context filters by selected date range)
      GeneratorMap.tsx     # Generator Price Map — Leaflet geographic LMP/MLC/MCC visualization (standalone or embedded mode)
      InterconnectionQueue.tsx  # Interconnection Queue — Intelligence summary, 9 MW-based KPIs, pipeline viz (Cluster→Active→In Service), fuel/zone bar charts, recent activity, largest projects, sortable/filterable table, collapsible sections
    components/
      PriceChart.tsx      # Flexible chart (line/line+markers/stacked area/stacked bar) with configurable tooltip prefix/suffix
      PriceChartControls.tsx  # Side control panel for Price page (zones, resolution, date range, chart type)
      ChartControls.tsx   # Generic reusable side control panel (series label, resolution, date range, chart type)
    data/
      zones.ts            # NYISO zone constants (A-K), isNyisoZone/filterNyisoZones helpers
      interfaceMetadata.ts # Interface name normalization + internal/external classification mapping
      priceTransforms.ts  # Date/zone filtering, OPA/OFFPA/daily aggregation, DART computation, pivoting
      priceMetrics.ts     # KPI stats (on-peak avg, peak/low with hour+zone, top DART zone)
      priceSummary.ts     # AI summary context builder, deterministic fallback summary, API fetch
      demandTransforms.ts # Demand date/zone filtering, forecast-actual alignment (deduped), pivoting, error computation
      demandMetrics.ts    # Demand KPI stats (on-peak avg forecast/actual, peak/low, error metrics)
      demandSummary.ts    # AI demand summary context builder, deterministic fallback, API fetch
      generationTransforms.ts # Generation fuel filtering, deduped pivoting, fuel breakdown computation
      generationMetrics.ts    # Generation KPI stats (on-peak total, peak/low gen, fuel shares, renewable%)
      generationSummary.ts    # AI generation summary context builder, deterministic fallback, API fetch
      interfaceTransforms.ts  # Interface flow date/class/interface filtering, resolution aggregation, pivoting
      interfaceMetrics.ts     # Interface flow KPI stats (on-peak totals, peak flows, most active, top internal/external)
      interfaceSummary.ts     # AI flow summary context builder, deterministic fallback, API fetch
      congestionTransforms.ts # Congestion date/constraint filtering, resolution aggregation, pivoting with dedup
      congestionMetrics.ts    # Congestion KPI stats (on-peak costs, peak pos/neg, top constraint, concentration)
      congestionSummary.ts    # AI congestion summary context builder, deterministic fallback, API fetch
      priceResponseTransforms.ts # Scarcity signal transforms: DA/RT LMP+ASP alignment, pivoting, scarcity metrics, summary builder
src/
  api_data_loader.py      # Dataset metadata (47 datasets), aggregation, caching (Parquet-first, CSV fallback)
  config.py               # App constants (dirs, API keys)
backfill.py               # ONE-TIME historical backfill (2024-01 to present, monthly ZIPs)
daily_scraper.py           # NIGHTLY incremental updater (rolling 7-day, idempotent)
etl/
  config.py               # Paths, constants, backfill start date
  datasets.py             # Registry of all 39 NYISO datasets with URLs, primary keys, types
  fetchers.py             # HTTP session, archive/daily/snapshot fetchers, ZIP extraction
  processors.py           # DataFrame cleaning, timestamp parsing, numeric coercion
  storage.py              # Parquet upsert with dedup, legacy data/ sync
  manifests.py            # JSON manifest tracking (processed months/dates, idempotency)
  utils.py                # Logging setup
ETL/
  fetch_nyiso_data.py     # Legacy 7-day rolling scraper (superseded by daily_scraper.py)
  process_nyiso_data.py   # Legacy processor (still used by api.py /api/refresh endpoint)
  fetch_interconnection_queue.py  # Queue Excel parser (used by both backfill + daily_scraper)
raw_data/                 # Raw downloads organized by dataset (zip/, csv/, txt/, xlsx/)
processed_csv/            # Intermediate processed CSVs by dataset
parquet_data/             # Master deduplicated Parquet files by dataset
manifests/                # JSON manifests tracking processed months/dates
logs/                     # ETL run logs
data/
  raw/                    # Legacy raw CSVs (synced from parquet_data by ETL)
  processed/              # Legacy processed CSVs + Parquet (synced, consumed by API)
  snapshots/              # Interconnection queue snapshot for change detection
.github/workflows/
  nightly_update.yml      # GitHub Actions cron: midnight ET daily_scraper.py --all
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
- Prices: Zone selector (11 NYISO internal zones A-K, excludes H Q/NPX/O H/PJM)
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
- `GET /api/constraint-impact?market=DA|RT&facility=&contingency=&date=&he=&clean_only=true&search=` — constraint impact analysis: drill-down flow (Market→Search Constraint→Contingency→Timestamp), returns status "pending" until facility+contingency+date selected, search param filters facility list, clean print detection, congestion pivot, zonal/generator MCC impact
- `GET /api/congestion-stacked?market=DA|RT&date=YYYY-MM-DD` — stacked bar data: constraint costs by hour, pivoted by constraint name
- `GET /api/ttcf-derates?date=YYYY-MM-DD` — TTCF derate data from NYISO MIS (with fallback to previous day), path names normalized via path_map
- `GET /api/oic?date=YYYY-MM-DD` — Operating In Commitment data from NYISO MIS (single day, raw records)
- `GET /api/oic-range?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD` — OIC analytics across date range (max 30 days): aggregated commitment counts by zone, by zone+type, MW by zone, and raw records
- `POST /api/ai-price-summary` — AI-generated price market commentary (gpt-4o-mini, max 300 tokens)
- `POST /api/ai-demand-summary` — AI-generated demand/load commentary (gpt-4o-mini, max 300 tokens)
- `POST /api/ai-generation-summary` — AI-generated generation mix commentary (gpt-4o-mini, max 300 tokens)
- `POST /api/ai-flow-summary` — AI-generated interface flow commentary (gpt-4o-mini, max 300 tokens)
- `POST /api/ai-congestion-summary` — AI-generated congestion analysis commentary (gpt-4o-mini, max 300 tokens)
- `POST /api/ai-explainer` — structured AI market analysis: Summary, Trader Takeaways, Battery Strategist Takeaways, Key Signals, Caveats (requires OPENAI_API_KEY)
- `POST /api/explain` — backward-compatible AI explanation wrapper
- `POST /api/refresh` — full data refresh: ETL fetch + process + cache clear (concurrency-guarded)
- `POST /api/cache/clear` — clear in-memory DataFrame cache only
- `POST /api/etl/fetch` / `POST /api/etl/process` — trigger ETL

## Resolution Aggregation

- **Raw**: Original data as-is
- **Hourly**: Group by hour + group_cols, mean of value_cols
- **On-Peak Avg**: HE 7-22 average per day
- **Off-Peak Avg**: HE 0-6, 23 average per day
- **Daily**: Full day average
- DataFrame cache with mtime-based invalidation for performance
- Parquet format preferred over CSV for faster loading (pyarrow)
- Large datasets (>500K rows) auto-filtered to last 90 days on load to prevent OOM
- Column normalization on load: NYISO raw names → standardized names (LBMP→LMP, Name→Zone/Generator, ASP columns→short names, etc.)
- Date/HE/Month/Year columns derived from Time Stamp when missing
- **Daily cache system**: Pre-aggregated daily parquet files in `data/processed/_daily_cache/` for large datasets (`da_lbmp_zone`, `rt_lbmp_zone`, `damasp`, `rtasp`, `rtfuelmix`, `pal`, `external_limits_flows`); built at startup, served from in-memory cache for sub-200ms response times; mtime-based invalidation
- **ThreadPoolExecutor**: 8 workers for concurrent API requests
- Frontend `useDataset` calls use `days=730` for 2-year historical views, `limit=20000` for page data, `limit=10000` for MarketAnalystWidget

## Running

```bash
bash start.sh
```

## Dependencies

Python: fastapi, uvicorn, pandas, numpy, pyarrow, python-dotenv, openpyxl, requests, openai
Node: react, react-router-dom, recharts, leaflet, react-leaflet, vite
