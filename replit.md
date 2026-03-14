# GridScope NY

A NYISO market intelligence dashboard with a React + Vite frontend and Python FastAPI backend.

## Architecture

- **Frontend**: React + Vite (TypeScript), port 5000 — sidebar navigation, Recharts charts, all 8 pages
- **Backend**: FastAPI (Python), port 8000 — serves processed NYISO data as JSON REST API with resolution aggregation
- **Data Layer**: Pandas-based ETL that fetches and processes CSV data from NYISO MIS
- **Entry point**: `start.sh` — starts FastAPI backend then React frontend

## Project Structure

```
start.sh                  # Combined startup script (backend + frontend)
api.py                    # FastAPI backend entry point (v2.0)
frontend/                 # React + Vite TypeScript app
  src/
    App.tsx               # Root with React Router
    components/
      Layout.tsx          # Sidebar + navigation shell
      LineChart.tsx       # Recharts line chart wrapper (multi-line, wide-format)
      MetricsRow.tsx      # Summary metrics cards
      DataTable.tsx       # Paginated data table
      DatasetSection.tsx  # Collapsible dataset card (chart + metrics + table)
      ResolutionSelector.tsx  # Resolution toggle buttons
      EmptyState.tsx      # Empty state with ETL trigger button
    hooks/
      useDataset.ts       # Data fetching hook with resolution support
    pages/
      Home.tsx            # Dashboard overview + data inventory + reference data
      Prices.tsx          # DA/RT LBMP (10 datasets), Ancillary Prices, CTS
      Demand.tsx          # ISO Load Forecast, Actual Load, Weather
      Generation.tsx      # Fuel Mix, IMER, BTM Solar, Commitments, Maintenance
      InterfaceFlows.tsx  # External Flows, ATC/TTC, Derates, PAR, Lake Erie
      Congestion.tsx      # Limiting Constraints, Outages (DA/RT/SC/Actual)
      OpportunityExplorer.tsx  # Battery DA-RT arbitrage rankings
      AIExplainer.tsx     # OpenAI-powered Q&A
src/
  api_data_loader.py      # Dataset metadata (40 datasets), aggregation engine, caching
  config.py               # App constants (dirs, API keys)
  data_loader.py          # Streamlit-compatible loader (kept for reference)
  utils.py / metrics.py / filters.py / charts.py / nav.py  # Shared utilities
ETL/
  fetch_nyiso_data.py     # Fetches CSVs from NYISO MIS (7-day rolling window)
  process_nyiso_data.py   # Cleans, renames, and saves processed CSVs
data/
  raw/                    # Raw NYISO CSV files
  processed/              # Cleaned CSVs consumed by the API
```

## API Endpoints (v2.0)

- `GET /api/health` — health check
- `GET /api/inventory` — data availability across all pages/datasets
- `GET /api/dataset/{key}?resolution=raw|hourly|on_peak|off_peak|daily&limit=10000` — fetch any dataset with aggregation
- `GET /api/page/{page}` — list datasets for a page
- `GET /api/filters/{key}/{col}` — get filter options for a dataset column
- `POST /api/explain` — AI market explanation (requires OPENAI_API_KEY)
- `POST /api/etl/fetch` — trigger NYISO data fetch
- `POST /api/etl/process` — trigger data processing

## Dataset Organization (40 datasets)

- **Home (7)**: rt_events, oper_messages, generator_names, load_names, active_transmission_nodes, zonal_uplift, resource_uplift
- **Prices (10)**: da_lbmp_zone, rt_lbmp_zone, integrated_rt_lbmp_zone, da_lbmp_gen, rt_lbmp_gen, integrated_rt_lbmp_gen, reference_bus_lbmp, ext_rto_cts_price, da_asp, rt_asp
- **Demand (4)**: isolf, pal, lfweather, btm_da_forecast (wide-format)
- **Generation (7)**: rt_fuel_mix, imer_da_committed, imer_rt_committed, op_in_commit, gen_maint_report, btm_da_forecast, btm_estimated_actual
- **Interface Flows (6)**: ext_int_flows, int_int_flows, atc_ttc, derates, par_data, lake_erie
- **Congestion (6)**: da_limiting, rt_limiting, sc_line_outages, rt_line_outages, outages, actual_line_outages

## Resolution Aggregation

- **Raw**: Original data as-is
- **Hourly**: Group by hour + group_cols, mean of value_cols
- **On-Peak Avg**: HE 7-22 average per day
- **Off-Peak Avg**: HE 0-6, 23 average per day
- **Daily**: Full day average
- Daily-native and event/table datasets return raw data regardless of selection
- DataFrame cache with mtime-based invalidation for performance

## Running

```bash
bash start.sh
# or separately:
uvicorn api:app --host 0.0.0.0 --port 8000
cd frontend && npm run dev
```

## First-Time Setup (No Data)

1. Navigate to any page in the dashboard
2. Click "Fetch & Process Data" to run the ETL pipeline
3. Wait ~3-5 minutes for data to download from NYISO
4. Refresh — charts and tables will populate

## Dependencies

Python: fastapi, uvicorn, pandas, numpy, plotly, python-dotenv, openpyxl, requests
Node: react, react-router-dom, recharts, axios, vite

## QA / Error Handling

- NaN → null conversion for all JSON responses
- Empty DataFrame guards at every layer
- Network error handling with retry-safe structure in ETL
- All processed files validated for column existence before API exposure
- Missing processed files return `{status: "empty"}` with helpful message
- CORS configured with allow_credentials=False for security
- Large dataset limit (10,000 rows) applied after aggregation
