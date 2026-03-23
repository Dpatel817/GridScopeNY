# GridScope NY

A NYISO electricity market intelligence dashboard.

**Stack:** React + TypeScript (Vite) · Python FastAPI · Parquet/CSV data layer

---

## Project Structure

```
├── backend/
│   ├── api/
│   │   ├── main.py            # FastAPI app — all REST endpoints (port 8000)
│   │   └── routes/            # Route modules
│   ├── app/
│   │   ├── config.py          # Paths and environment config
│   │   ├── context.py         # App-level context / lifespan
│   │   ├── datasets.py        # Dataset metadata and page mappings
│   │   └── loader.py          # Data loading, aggregation, caching
│   ├── etl/
│   │   ├── config.py          # ETL paths and constants
│   │   ├── datasets.py        # Registry of 39 NYISO datasets
│   │   ├── fetchers.py        # HTTP download helpers (archives, daily, snapshots)
│   │   ├── processors.py      # DataFrame cleaning, timestamp parsing, coercion
│   │   ├── storage.py         # Parquet upsert with dedup, legacy CSV sync
│   │   ├── manifests.py       # Idempotency tracking (processed months/dates)
│   │   ├── interconnection_queue.py  # Queue Excel parser + change detection
│   │   ├── utils.py           # Logging setup
│   │   ├── extract/
│   │   │   ├── http_client.py # HTTP session with retry logic
│   │   │   └── live.py        # Live/real-time data fetchers
│   │   ├── transform/
│   │   │   ├── aggregator.py  # Resolution aggregation (hourly/on-peak/daily)
│   │   │   ├── normalizer.py  # Column normalization
│   │   │   └── validator.py   # Data validation
│   │   └── load/
│   │       └── cache.py       # DataFrame cache with mtime invalidation
│   ├── pipeline/
│   │   ├── runner.py          # Shared orchestration logic
│   │   ├── backfill.py        # Historical backfill CLI
│   │   ├── scraper.py         # Incremental scraper CLI
│   │   ├── mis_backfill.py    # MIS archive backfill
│   │   └── mis_incremental.py # MIS incremental update
│   └── tests/
│       ├── test_api.py
│       ├── test_pipeline.py
│       └── test_transform.py
├── frontend/
│   └── src/
│       ├── pages/             # Home, Prices, Demand, Generation, Flows, Congestion, etc.
│       ├── components/        # Charts, tables, controls, layout, widgets
│       ├── data/              # Transforms, metrics, AI summary builders
│       └── hooks/             # useDataset — data fetching with caching
├── data/
│   ├── processed/             # Processed CSV + Parquet files consumed by the API
│   └── snapshots/             # Interconnection queue snapshots
├── parquet_data/              # Master deduplicated Parquet files by dataset
├── raw_data/                  # Raw downloads organized by dataset
├── manifests/                 # JSON manifests tracking processed months/dates
├── logs/                      # ETL run logs
├── requirements.txt
└── start.sh                   # Combined startup script
```

---

## Running Locally

### Prerequisites

- Python 3.11+
- Node.js 20+ with pnpm
- `pip install -r requirements.txt`

### Combined startup

```bash
bash start.sh
```

Starts the FastAPI backend on port 8000, waits for it to be healthy, then starts the Vite dev server on port 5000.

### Run separately

**Backend:**
```bash
cd backend
python3 -m uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload
```

**Frontend:**
```bash
cd frontend
pnpm install
pnpm dev
```

The frontend proxies all `/api/*` requests to `http://localhost:8000` via Vite's dev proxy.

Open `http://localhost:5000` in your browser.

---

## Data Setup

**One-time historical backfill** (2024-01 to present):
```bash
cd backend
python -m pipeline.backfill --all
```

**Incremental update** (last 2 days):
```bash
cd backend
python -m pipeline.scraper
```

**Single dataset:**
```bash
cd backend
python -m pipeline.backfill --dataset da_lbmp_zone --start 2024-01
python -m pipeline.scraper --dataset da_lbmp_zone
```

---

## Environment Variables

Create a `.env` file at the repo root:

```env
OPENAI_API_KEY=sk-...   # Required for AI market commentary
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
| GET | `/api/constraint-impact` | Constraint impact drilldown |
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
