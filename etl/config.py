from pathlib import Path
from datetime import date

PROJECT_ROOT = Path(__file__).resolve().parent.parent

RAW_DATA_DIR = PROJECT_ROOT / "raw_data"
PROCESSED_CSV_DIR = PROJECT_ROOT / "processed_csv"
PARQUET_DATA_DIR = PROJECT_ROOT / "parquet_data"
MANIFESTS_DIR = PROJECT_ROOT / "manifests"
LOGS_DIR = PROJECT_ROOT / "logs"

LEGACY_DATA_DIR = PROJECT_ROOT / "data"
LEGACY_RAW_DIR = LEGACY_DATA_DIR / "raw"
LEGACY_PROCESSED_DIR = LEGACY_DATA_DIR / "processed"

BACKFILL_START = date(2024, 1, 1)
DAILY_LOOKBACK_DAYS = 7

REQUEST_TIMEOUT = 30
MAX_RETRIES = 3
RETRY_DELAY = 2

for d in [RAW_DATA_DIR, PROCESSED_CSV_DIR, PARQUET_DATA_DIR, MANIFESTS_DIR, LOGS_DIR]:
    d.mkdir(parents=True, exist_ok=True)
