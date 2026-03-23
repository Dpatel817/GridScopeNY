# GridScope NY

A premium NYISO electricity market intelligence dashboard.

**Stack:** React + TypeScript (Vite) frontend · Python FastAPI backend · Parquet/CSV data layer

---

## Project Structure

```
├── backend/               # Python FastAPI backend
│   ├── api.py             # FastAPI app — all REST endpoints (port 8000)
│   ├── scraper.py         # 15-minute incremental NYISO data fetcher
│   ├── backfill.py        # One-time historical backfill (2024-01 to present)
│   ├── src/
│   │   ├── api_data_loader.py   # Dataset metadata, aggregation, caching
│   │   └── config.py            # Paths and environment config
│   └── etl/               # ETL pipeline
│       ├── config.py      # ETL paths and constants
│       ├── datasets.py    # Registry of 39 NYISO datasets
│       ├── fetchers.py    # HTTP download (ZIP archives, daily files, snapshots)
│       ├── processors.py  # DataFrame cleaning, timestamp parsing, coercion
│       ├── storage.py     # Parquet upsert with dedup, legacy CSV sync
│       ├── manifests.py   # Idempotency tracking (processed months/dates)
│       ├── interconnection_queue.py  # Queue Excel parser + change detection
│       └── utils.py       # Logging setup
├── frontend/              # React + Vite frontend (port 5000)
│   └── src/
│       ├── pages/         # 9 pages: Home, Prices, Demand, Generation, etc.
│       ├── components/    # Charts, tables, controls, layout
│       ├── data/          # Transforms, metrics, AI summary builders
│       └── hooks/         # useDataset — data fetching with caching
├── data/
│   ├── processed/         # Processed CSV + Parquet files consumed by the API
│   └── snapshots/         # Interconnection queue snapshots
├── requirements.txt       # Python dependencies
└── start.sh               # Combined startup script
```

---

## Running Locally

### Prerequisites

- Python 3.11+
- Node.js 20+ (or use pnpm/npm)
- `pip install -r requirements.txt`

### Option 1 — Combined startup (recommended)

```bash
bash start.sh
```

This starts the FastAPI backend on port 8000, waits for it to be healthy, then starts the Vite dev server on port 5000.

### Option 2 — Run separately

**Backend:**
```bash
cd backend
uvicorn api:app --host 0.0.0.0 --port 8000 --reload
```

**Frontend** (in a separate terminal):
```bash
cd frontend
npm install
npm run dev
```

The frontend proxies all `/api/*` requests to `http://localhost:8000` via Vite's dev proxy.

Open `http://localhost:5000` in your browser.

---

## Data Setup

The app reads from `data/processed/`. To populate it:

**One-time historical backfill** (2024-01 to present):
```bash
cd backend
python backfill.py --all
```

**Incremental update** (last 2 days):
```bash
cd backend
python scraper.py
```

**Interconnection queue only:**
```bash
cd backend
python -c "from etl.interconnection_queue import run; run()"
```

---

## Environment Variables

Create a `.env` file at the repo root:

```env
OPENAI_API_KEY=sk-...        # Required for AI market commentary
SCRAPER_INTERVAL_SECONDS=900  # Optional, default 900 (15 min)
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/inventory` | Data availability across all pages |
| GET | `/api/dataset/{key}` | Dataset with resolution aggregation |
| GET | `/api/page/{page}` | Datasets for a page |
| GET | `/api/filters/{key}/{col}` | Filter options for a column |
| GET | `/api/generator-map` | Geographic LMP/MLC/MCC data |
| GET | `/api/constraint-impact` | Constraint impact analysis |
| GET | `/api/congestion-stacked` | Stacked constraint costs by hour |
| GET | `/api/ttcf-derates` | Transfer capability derates |
| GET | `/api/oic` | Operating In Commitment (single day) |
| GET | `/api/oic-range` | OIC analytics across date range |
| GET | `/api/daily-events` | RT events + operational announcements |
| POST | `/api/ai-explainer` | Structured AI market analysis |
| POST | `/api/ai-price-summary` | AI price commentary |
| POST | `/api/ai-demand-summary` | AI demand commentary |
| POST | `/api/ai-generation-summary` | AI generation commentary |
| POST | `/api/ai-congestion-summary` | AI congestion commentary |
| POST | `/api/ai-flow-summary` | AI interface flow commentary |
| POST | `/api/iq/scrape` | Trigger interconnection queue scrape |

Resolution options for `/api/dataset/{key}`: `raw`, `hourly`, `on_peak`, `off_peak`, `daily`
