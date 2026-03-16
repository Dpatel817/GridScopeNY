"""
GridScope NY — One-Time Historical Backfill
============================================
Run this ONCE to load historical NYISO data from 2024-01-01 to present.
Uses monthly ZIP archives where available, falling back to daily files.
After running successfully, this script should not need to run again
unless you want to extend the historical range.

Usage:
    python backfill.py --all
    python backfill.py --dataset da_lbmp_zone
    python backfill.py --dataset da_lbmp_zone --start 2024-01 --end 2025-06
    python backfill.py --category prices
    python backfill.py --list
"""
import argparse
import logging
import sys
from datetime import date, timedelta

import pandas as pd

from etl.config import BACKFILL_START
from etl.datasets import DATASET_REGISTRY, get_dated_datasets, get_snapshot_datasets
from etl.fetchers import (
    create_session, fetch_monthly_archive, fetch_daily_file,
    fetch_snapshot, get_month_range, get_date_range, read_raw_file
)
from etl.processors import process_raw_files, process_raw_file, save_processed_csv
from etl.storage import upsert_parquet, sync_to_legacy
from etl.manifests import (
    is_month_processed, mark_month_processed, mark_snapshot_fetched
)
from etl.utils import setup_logging

logger = logging.getLogger("backfill")


def backfill_dated_dataset(session, dataset_name, meta, start_month, end_month):
    months = get_month_range(
        date(int(start_month[:4]), int(start_month[5:7]), 1),
        date(int(end_month[:4]), int(end_month[5:7]), 1)
    )

    total_rows = 0
    for ym in months:
        if is_month_processed(dataset_name, ym):
            logger.info(f"  [{dataset_name}] {ym} already processed, skipping")
            continue

        logger.info(f"  [{dataset_name}] Processing {ym}...")

        _, extracted = fetch_monthly_archive(session, meta, ym, dataset_name)

        if extracted:
            df = process_raw_files(extracted, meta, dataset_name)
            if not df.empty:
                upsert_parquet(df, dataset_name, meta)
                total_rows += len(df)
                mark_month_processed(dataset_name, ym)
                logger.info(f"  [{dataset_name}] {ym} archive: {len(df)} rows")
                continue

        logger.info(f"  [{dataset_name}] No archive for {ym}, trying daily files...")
        year = int(ym[:4])
        month = int(ym[5:7])
        month_start = date(year, month, 1)
        if month == 12:
            month_end = date(year + 1, 1, 1) - timedelta(days=1)
        else:
            month_end = date(year, month + 1, 1) - timedelta(days=1)
        if month_end > date.today():
            month_end = date.today()

        dates = get_date_range(month_start, month_end)
        raw_paths = []
        for d in dates:
            path = fetch_daily_file(session, meta, d, dataset_name)
            if path:
                raw_paths.append(path)

        if raw_paths:
            df = process_raw_files(raw_paths, meta, dataset_name)
            if not df.empty:
                upsert_parquet(df, dataset_name, meta)
                total_rows += len(df)

        mark_month_processed(dataset_name, ym)

    if total_rows > 0:
        sync_to_legacy(dataset_name, meta)
        logger.info(f"  [{dataset_name}] Backfill complete: {total_rows} total new rows")
    else:
        logger.info(f"  [{dataset_name}] No new data found")


def backfill_snapshot_dataset(session, dataset_name, meta):
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
    from ETL.fetch_interconnection_queue import SHEET_MAP, COLUMN_MAP

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
    parser = argparse.ArgumentParser(description="GridScope NY — Historical Backfill")
    parser.add_argument("--all", action="store_true", help="Backfill all datasets")
    parser.add_argument("--dataset", type=str, help="Backfill a single dataset")
    parser.add_argument("--category", type=str, help="Backfill all datasets in a category")
    parser.add_argument("--start", type=str, default=None, help="Start month YYYY-MM (default: 2024-01)")
    parser.add_argument("--end", type=str, default=None, help="End month YYYY-MM (default: current)")
    parser.add_argument("--list", action="store_true", help="List all datasets")
    parser.add_argument("--force", action="store_true", help="Re-process already completed months")
    args = parser.parse_args()

    if args.list:
        for name, meta in sorted(DATASET_REGISTRY.items()):
            print(f"  {name:35s} {meta['dataset_type']:15s} {meta['category']}")
        return

    log_file = setup_logging("backfill")
    logger.info(f"Log file: {log_file}")

    start_month = args.start or BACKFILL_START.strftime("%Y-%m")
    end_month = args.end or date.today().strftime("%Y-%m")
    logger.info(f"Backfill range: {start_month} to {end_month}")

    if args.dataset:
        targets = {args.dataset: DATASET_REGISTRY[args.dataset]}
    elif args.category:
        targets = {k: v for k, v in DATASET_REGISTRY.items() if v["category"] == args.category}
    elif args.all:
        targets = DATASET_REGISTRY
    else:
        parser.print_help()
        return

    if args.force:
        from etl.manifests import load_manifest, save_manifest
        for name in targets:
            m = load_manifest(name)
            m.pop("processed_months", None)
            save_manifest(name, m)

    session = create_session()
    dated = {k: v for k, v in targets.items() if v["dataset_type"] in ("dated_csv", "dated_txt")}
    snapshots = {k: v for k, v in targets.items() if v["dataset_type"] in ("snapshot_csv", "snapshot_xlsx")}

    logger.info(f"Backfilling {len(dated)} dated + {len(snapshots)} snapshot datasets")

    for name, meta in sorted(dated.items()):
        logger.info(f"\n{'='*50}")
        logger.info(f"DATASET: {name} ({meta['category']})")
        logger.info(f"{'='*50}")
        try:
            backfill_dated_dataset(session, name, meta, start_month, end_month)
        except Exception as e:
            logger.error(f"FAILED {name}: {e}", exc_info=True)

    for name, meta in sorted(snapshots.items()):
        logger.info(f"\n{'='*50}")
        logger.info(f"SNAPSHOT: {name} ({meta['category']})")
        logger.info(f"{'='*50}")
        try:
            backfill_snapshot_dataset(session, name, meta)
        except Exception as e:
            logger.error(f"FAILED {name}: {e}", exc_info=True)

    logger.info("\nBackfill complete!")
    session.close()


if __name__ == "__main__":
    main()
