"""
Pipeline orchestration — deduplicates shared logic from scraper.py and backfill.py.
Both scraper and backfill delegate to these functions.
"""
from __future__ import annotations

import gc
import logging
from datetime import date, timedelta

import pandas as pd

from etl.datasets import DATASET_REGISTRY
from etl.extract.http_client import create_session
from etl.fetchers import (
    fetch_daily_file, fetch_monthly_archive,
    fetch_snapshot, get_date_range, get_month_range,
)
from etl.processors import process_raw_files, process_raw_file
from etl.storage import upsert_parquet, sync_to_legacy
from etl.manifests import (
    mark_dates_processed, mark_snapshot_fetched,
    is_month_processed, mark_month_processed,
)

logger = logging.getLogger("pipeline.runner")


def run_dated_dataset(session, dataset_name: str, meta: dict, lookback_days: int) -> None:
    """Fetch and upsert the last N days of a dated dataset."""
    end = date.today()
    start = end - timedelta(days=lookback_days)
    dates = get_date_range(start, end)

    logger.info("[%s] Fetching %d days (%s to %s)", dataset_name, len(dates), start, end)

    raw_paths = []
    for d in dates:
        path = fetch_daily_file(session, meta, d, dataset_name)
        if path:
            raw_paths.append(path)

    if not raw_paths:
        logger.info("[%s] No data found", dataset_name)
        return

    df = process_raw_files(raw_paths, meta, dataset_name)
    if df.empty:
        logger.info("[%s] No data after processing", dataset_name)
        return

    upsert_parquet(df, dataset_name, meta)
    sync_to_legacy(dataset_name, meta)
    mark_dates_processed(dataset_name, dates)
    logger.info("[%s] Updated: %d rows from %d files", dataset_name, len(df), len(raw_paths))


def run_snapshot_dataset(session, dataset_name: str, meta: dict) -> None:
    """Fetch and upsert a snapshot dataset (CSV or XLSX)."""
    logger.info("[%s] Fetching snapshot...", dataset_name)
    path = fetch_snapshot(session, meta, dataset_name)
    if path is None:
        logger.warning("[%s] Could not fetch snapshot", dataset_name)
        return

    if meta["dataset_type"] == "snapshot_xlsx" and dataset_name == "interconnection_queue":
        from etl.interconnection_queue import parse_workbook
        try:
            xls = pd.ExcelFile(path, engine="openpyxl")
        except Exception as exc:
            logger.error("Cannot read queue xlsx: %s", exc)
            mark_snapshot_fetched(dataset_name)
            return
        combined = parse_workbook(xls)
        if not combined.empty:
            upsert_parquet(combined, dataset_name, meta)
            sync_to_legacy(dataset_name, meta)
            logger.info("[interconnection_queue] %d rows", len(combined))
    else:
        df = process_raw_file(path, meta)
        if not df.empty:
            upsert_parquet(df, dataset_name, meta)
            sync_to_legacy(dataset_name, meta)
            logger.info("[%s] Snapshot: %d rows", dataset_name, len(df))

    mark_snapshot_fetched(dataset_name)


def backfill_dated_dataset(
    session, dataset_name: str, meta: dict, start_month: str, end_month: str
) -> None:
    """Backfill a dated dataset month-by-month using archives, falling back to daily files."""
    months = get_month_range(
        date(int(start_month[:4]), int(start_month[5:7]), 1),
        date(int(end_month[:4]), int(end_month[5:7]), 1),
    )

    total_rows = 0
    for ym in months:
        if is_month_processed(dataset_name, ym):
            logger.info("  [%s] %s already processed, skipping", dataset_name, ym)
            continue

        logger.info("  [%s] Processing %s...", dataset_name, ym)

        _, extracted = fetch_monthly_archive(session, meta, ym, dataset_name)
        if extracted:
            df = process_raw_files(extracted, meta, dataset_name)
            if not df.empty:
                upsert_parquet(df, dataset_name, meta, year_month=ym)
                total_rows += len(df)
                del df
                gc.collect()
                mark_month_processed(dataset_name, ym)
                logger.info("  [%s] %s archive: done", dataset_name, ym)
                continue

        logger.info("  [%s] No archive for %s, trying daily files...", dataset_name, ym)
        year, month = int(ym[:4]), int(ym[5:7])
        month_start = date(year, month, 1)
        month_end = date(year + 1, 1, 1) - timedelta(days=1) if month == 12 else date(year, month + 1, 1) - timedelta(days=1)
        if month_end > date.today():
            month_end = date.today()

        raw_paths = [p for d in get_date_range(month_start, month_end) if (p := fetch_daily_file(session, meta, d, dataset_name))]
        if raw_paths:
            df = process_raw_files(raw_paths, meta, dataset_name)
            if not df.empty:
                upsert_parquet(df, dataset_name, meta, year_month=ym)
                total_rows += len(df)
                del df
                gc.collect()

        mark_month_processed(dataset_name, ym)

    if total_rows > 0:
        sync_to_legacy(dataset_name, meta)
        logger.info("  [%s] Backfill complete: %d total new rows", dataset_name, total_rows)
    else:
        logger.info("  [%s] No new data found", dataset_name)
