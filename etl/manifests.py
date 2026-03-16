import json
import logging
from datetime import datetime

from etl.config import MANIFESTS_DIR

logger = logging.getLogger("etl.manifests")


def _manifest_path(dataset_name):
    return MANIFESTS_DIR / f"{dataset_name}.json"


def load_manifest(dataset_name):
    path = _manifest_path(dataset_name)
    if path.exists():
        try:
            return json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            return {}
    return {}


def save_manifest(dataset_name, manifest):
    path = _manifest_path(dataset_name)
    path.write_text(json.dumps(manifest, indent=2, default=str))


def is_month_processed(dataset_name, year_month):
    m = load_manifest(dataset_name)
    return year_month in m.get("processed_months", [])


def mark_month_processed(dataset_name, year_month):
    m = load_manifest(dataset_name)
    months = set(m.get("processed_months", []))
    months.add(year_month)
    m["processed_months"] = sorted(months)
    m["last_backfill"] = datetime.now().isoformat()
    save_manifest(dataset_name, m)


def is_date_processed(dataset_name, date_str):
    m = load_manifest(dataset_name)
    return date_str in m.get("processed_dates", [])


def mark_dates_processed(dataset_name, date_strs):
    m = load_manifest(dataset_name)
    dates = set(m.get("processed_dates", []))
    dates.update(date_strs)
    if len(dates) > 30:
        dates = set(sorted(dates)[-30:])
    m["processed_dates"] = sorted(dates)
    m["last_daily_run"] = datetime.now().isoformat()
    save_manifest(dataset_name, m)


def mark_snapshot_fetched(dataset_name):
    m = load_manifest(dataset_name)
    m["last_snapshot"] = datetime.now().isoformat()
    save_manifest(dataset_name, m)
