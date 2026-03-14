# GridScope NY

A NYISO market intelligence dashboard with a React + Vite frontend and Python FastAPI backend.

## Architecture

- **Frontend**: React + Vite (TypeScript), port 5000 — sidebar navigation, Recharts charts, all 8 pages
- **Backend**: FastAPI (Python), port 8000 — serves processed NYISO data as JSON REST API
- **Data Layer**: Pandas-based ETL that fetches and processes CSV data from NYISO MIS
- **Entry point**: `start.sh` — starts FastAPI backend then React frontend

## Project Structure

```
start.sh                  # Combined startup script (backend + frontend)
api.py                    # FastAPI backend entry point
frontend/                 # React + Vite TypeScript app
  src/
    App.tsx               # Root with React Router
    components/
      Layout.tsx          # Sidebar + navigation shell
      LineChart.tsx       # Recharts line chart wrapper
      MetricsRow.tsx      # Summary metrics cards
      DataTable.tsx       # Paginated data table
      EmptyState.tsx      # Empty state with ETL trigger button
    hooks/
      useDataset.ts       # useFetch hooks for API calls
    pages/
      Home.tsx            # Dashboard overview + data inventory
      Prices.tsx          # DA/RT LBMP, Ancillary Prices
      Demand.tsx          # ISO Load, Weather, Solar
      Generation.tsx      # Fuel Mix, IMER, Commitments
      InterfaceFlows.tsx  # External Flows, ATC/TTC, PAR, Erie
      Congestion.tsx      # Limiting Constraints, Outages
      OpportunityExplorer.tsx  # Ranked market opportunities
      AIExplainer.tsx     # OpenAI-powered Q&A
src/
  api_data_loader.py      # QA-enhanced data loader (NaN-safe, JSON serializable)
  config.py               # App constants (dirs, API keys)
  data_loader.py          # Streamlit-compatible loader (kept for reference)
  utils.py / metrics.py / filters.py / charts.py / nav.py  # Shared utilities
ETL/
  fetch_nyiso_data.py     # Fetches CSVs from NYISO MIS (7-day rolling window)
  process_nyiso_data.py   # Cleans, renames, and saves processed CSVs
data/
  raw/                    # Raw NYISO CSV files
  processed/              # Cleaned CSVs consumed by the API
pages/                    # Legacy Streamlit pages (kept for reference)
app.py                    # Legacy Streamlit app (kept for reference)
```

## API Endpoints

- `GET /api/health` — health check
- `GET /api/inventory` — data availability across all datasets
- `GET /api/{category}` — list datasets in a category
- `GET /api/{category}/{dataset}?limit=5000` — fetch dataset as JSON
- `POST /api/explain` — AI market explanation (requires OPENAI_API_KEY)
- `POST /api/etl/fetch` — trigger NYISO data fetch
- `POST /api/etl/process` — trigger data processing

Categories: `prices`, `demand`, `generation`, `interfaces`, `congestion`

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
