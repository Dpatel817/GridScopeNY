"""
GridScope NY — 15-Minute Incremental Scraper
=============================================
Fetches recent NYISO data (last 2 days by default), processes it,
upserts into parquet files, and syncs to data/processed/.

Designed to run every 15 minutes via GitHub Actions.

Usage:
    python scraper.py
    python scraper.py --lookback-days 3
    python scraper.py --dataset da_lbmp_zone
    python scraper.py --category prices
"""
import argparse
import logging
import sys
from datetime import date, timedelta

import pandas as pd

from etl.datasets import DATASET_REGISTRY, get_dated_datasets, get_snapshot_datasets
from etl.fetchers import (
    create_session, fetch_daily_file, fetch_snapshot,
    get_date_range
)
from etl.processors import process_raw_files, process_raw_file
from etl.storage import upsert_parquet, sync_to_legacy
from etl.manifests import mark_dates_processed, mark_snapshot_fetched
from etl.utils import setup_logging

logger = logging.getLogger("scraper")

DEFAULT_LOOKBACK_DAYS = 2


def update_dated_dataset(session, dataset_name, meta, lookback_days):
    end = date.today()
    start = end - timedelta(days=lookback_days)
    dates = get_date_range(start, end)

    logger.info(f"[{dataset_name}] Fetching {len(dates)} days ({start} to {end})")

    raw_paths = []
    for d in dates:
        path = fetch_daily_file(session, meta, d, dataset_name)
        if path:
            raw_paths.append(path)

    if not raw_paths:
        logger.info(f"[{dataset_name}] No data found")
        return

    df = process_raw_files(raw_paths, meta, dataset_name)
    if df.empty:
        logger.info(f"[{dataset_name}] No data after processing")
        return

    upsert_parquet(df, dataset_name, meta)
    sync_to_legacy(dataset_name, meta)
    mark_dates_processed(dataset_name, dates)
    logger.info(f"[{dataset_name}] Updated: {len(df)} rows from {len(raw_paths)} files")


def update_snapshot_dataset(session, dataset_name, meta):
    logger.info(f"[{dataset_name}] Fetching snapshot...")
    path = fetch_snapshot(session, meta, dataset_name)
    if path is None:
        logger.warning(f"[{dataset_name}] Could not fetch snapshot")
        return

    if meta["dataset_type"] == "snapshot_xlsx" and dataset_name == "interconnection_queue":
        from etl.interconnection_queue import parse_workbook
        try:
            xls = pd.ExcelFile(path, engine="openpyxl")
        except Exception as e:
            logger.error(f"Cannot read queue xlsx: {e}")
            mark_snapshot_fetched(dataset_name)
            return
        combined = parse_workbook(xls)
        if not combined.empty:
            upsert_parquet(combined, dataset_name, meta)
            sync_to_legacy(dataset_name, meta)
            logger.info(f"[interconnection_queue] {len(combined)} rows")
    else:
        df = process_raw_file(path, meta)
        if not df.empty:
            upsert_parquet(df, dataset_name, meta)
            sync_to_legacy(dataset_name, meta)
            logger.info(f"[{dataset_name}] Snapshot: {len(df)} rows")

    mark_snapshot_fetched(dataset_name)


def main():
    parser = argparse.ArgumentParser(description="GridScope NY — 15-Minute Scraper")
    parser.add_argument("--lookback-days", type=int, default=DEFAULT_LOOKBACK_DAYS,
                        help=f"Days to look back (default: {DEFAULT_LOOKBACK_DAYS})")
    parser.add_argument("--dataset", type=str, help="Update a single dataset by name")
    parser.add_argument("--category", type=str, help="Update all datasets in a category")
    args = parser.parse_args()

    log_file = setup_logging("scraper")
    logger.info(f"Log file: {log_file}")
    logger.info(f"Lookback: {args.lookback_days} days")

    if args.dataset:
        if args.dataset not in DATASET_REGISTRY:
            logger.error(f"Unknown dataset: {args.dataset}")
            sys.exit(1)
        targets = {args.dataset: DATASET_REGISTRY[args.dataset]}
    elif args.category:
        targets = {k: v for k, v in DATASET_REGISTRY.items() if v["category"] == args.category}
        if not targets:
            logger.error(f"No datasets found for category: {args.category}")
            sys.exit(1)
    else:
        targets = DATASET_REGISTRY

    session = create_session()
    dated = {k: v for k, v in targets.items() if v["dataset_type"] in ("dated_csv", "dated_txt")}
    snapshots = {k: v for k, v in targets.items() if v["dataset_type"] in ("snapshot_csv", "snapshot_xlsx")}

    logger.info(f"Updating {len(dated)} dated + {len(snapshots)} snapshot datasets")

    errors = []
    for name, meta in sorted(dated.items()):
        try:
            update_dated_dataset(session, name, meta, args.lookback_days)
        except Exception as e:
            logger.error(f"FAILED {name}: {e}", exc_info=True)
            errors.append(name)

    for name, meta in sorted(snapshots.items()):
        try:
            update_snapshot_dataset(session, name, meta)
        except Exception as e:
            logger.error(f"FAILED {name}: {e}", exc_info=True)
            errors.append(name)

    session.close()

    if errors:
        logger.warning(f"Completed with {len(errors)} errors: {errors}")
        sys.exit(1)
    else:
        logger.info("Scraper update complete!")


if __name__ == "__main__":
    main()
