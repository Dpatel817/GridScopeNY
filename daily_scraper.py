"""
GridScope NY — Nightly Incremental Updater
============================================
Lightweight daily scraper for rolling 7-day NYISO data updates.
Designed to run nightly via GitHub Actions or cron.
Does NOT trigger a full historical backfill.

Usage:
    python daily_scraper.py --all
    python daily_scraper.py --dataset da_lbmp_zone
    python daily_scraper.py --category prices
    python daily_scraper.py --lookback-days 14 --all
    python daily_scraper.py --list
"""
import argparse
import logging
import sys
from datetime import date, timedelta

import pandas as pd

from etl.config import DAILY_LOOKBACK_DAYS
from etl.datasets import DATASET_REGISTRY, get_dated_datasets, get_snapshot_datasets
from etl.fetchers import (
    create_session, fetch_daily_file, fetch_snapshot,
    get_date_range, read_raw_file
)
from etl.processors import process_raw_files, process_raw_file
from etl.storage import upsert_parquet, sync_to_legacy
from etl.manifests import mark_dates_processed, mark_snapshot_fetched
from etl.utils import setup_logging
from ETL.fetch_interconnection_queue import SHEET_MAP, COLUMN_MAP

logger = logging.getLogger("daily_scraper")


def update_dated_dataset(session, dataset_name, meta, lookback_days):
    end = date.today()
    start = end - timedelta(days=lookback_days)
    dates = get_date_range(start, end)

    logger.info(f"  [{dataset_name}] Fetching {len(dates)} days ({start} to {end})")

    raw_paths = []
    for d in dates:
        path = fetch_daily_file(session, meta, d, dataset_name)
        if path:
            raw_paths.append(path)

    if not raw_paths:
        logger.info(f"  [{dataset_name}] No data found")
        return

    df = process_raw_files(raw_paths, meta, dataset_name)
    if df.empty:
        logger.info(f"  [{dataset_name}] No data after processing")
        return

    upsert_parquet(df, dataset_name, meta)
    sync_to_legacy(dataset_name, meta)
    mark_dates_processed(dataset_name, dates)
    logger.info(f"  [{dataset_name}] Updated: {len(df)} rows from {len(raw_paths)} files")


def update_snapshot_dataset(session, dataset_name, meta):
    logger.info(f"  [{dataset_name}] Fetching snapshot...")
    path = fetch_snapshot(session, meta, dataset_name)
    if path is None:
        logger.warning(f"  [{dataset_name}] Could not fetch snapshot")
        return

    if meta["dataset_type"] == "snapshot_xlsx" and dataset_name == "interconnection_queue":
        _process_interconnection_queue(path, dataset_name, meta)
    else:
        df = process_raw_file(path, meta)
        if not df.empty:
            upsert_parquet(df, dataset_name, meta)
            sync_to_legacy(dataset_name, meta)
            logger.info(f"  [{dataset_name}] Snapshot: {len(df)} rows")

    mark_snapshot_fetched(dataset_name)


def _process_interconnection_queue(path, dataset_name, meta):
    try:
        xls = pd.ExcelFile(path, engine="openpyxl")
    except Exception as e:
        logger.error(f"Cannot read queue xlsx: {e}")
        return

    frames = []
    for sheet_name in xls.sheet_names:
        key = sheet_name.strip().lower()
        source_sheet = SHEET_MAP.get(key)
        if not source_sheet:
            continue
        try:
            df = pd.read_excel(xls, sheet_name=sheet_name, engine="openpyxl")
            df.columns = df.columns.str.strip().str.lower()
            rename = {k: v for k, v in COLUMN_MAP.items() if k in df.columns}
            df = df.rename(columns=rename)
            df["source_sheet"] = source_sheet
            frames.append(df)
        except Exception as e:
            logger.warning(f"Sheet {sheet_name}: {e}")

    if frames:
        combined = pd.concat(frames, ignore_index=True)
        upsert_parquet(combined, dataset_name, meta)
        sync_to_legacy(dataset_name, meta)
        logger.info(f"  [interconnection_queue] {len(combined)} rows across {len(frames)} sheets")


def main():
    parser = argparse.ArgumentParser(description="GridScope NY — Nightly Incremental Update")
    parser.add_argument("--all", action="store_true", help="Update all datasets")
    parser.add_argument("--dataset", type=str, help="Update a single dataset")
    parser.add_argument("--category", type=str, help="Update all datasets in a category")
    parser.add_argument("--lookback-days", type=int, default=DAILY_LOOKBACK_DAYS,
                        help=f"Days to look back (default: {DAILY_LOOKBACK_DAYS})")
    parser.add_argument("--list", action="store_true", help="List all datasets")
    args = parser.parse_args()

    if args.list:
        for name, meta in sorted(DATASET_REGISTRY.items()):
            print(f"  {name:35s} {meta['dataset_type']:15s} {meta['category']}")
        return

    log_file = setup_logging("daily_scraper")
    logger.info(f"Log file: {log_file}")
    logger.info(f"Lookback: {args.lookback_days} days")

    if args.dataset:
        targets = {args.dataset: DATASET_REGISTRY[args.dataset]}
    elif args.category:
        targets = {k: v for k, v in DATASET_REGISTRY.items() if v["category"] == args.category}
    elif args.all:
        targets = DATASET_REGISTRY
    else:
        parser.print_help()
        return

    session = create_session()
    dated = {k: v for k, v in targets.items() if v["dataset_type"] in ("dated_csv", "dated_txt")}
    snapshots = {k: v for k, v in targets.items() if v["dataset_type"] in ("snapshot_csv", "snapshot_xlsx")}

    logger.info(f"Updating {len(dated)} dated + {len(snapshots)} snapshot datasets")

    for name, meta in sorted(dated.items()):
        try:
            update_dated_dataset(session, name, meta, args.lookback_days)
        except Exception as e:
            logger.error(f"FAILED {name}: {e}", exc_info=True)

    for name, meta in sorted(snapshots.items()):
        try:
            update_snapshot_dataset(session, name, meta)
        except Exception as e:
            logger.error(f"FAILED {name}: {e}", exc_info=True)

    logger.info("Daily update complete!")
    session.close()


if __name__ == "__main__":
    main()
