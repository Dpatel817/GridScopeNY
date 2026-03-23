"""
Dataset loader — clean interface for the API layer.
Wraps etl/load/cache.py with dataset-aware logic.
"""
from __future__ import annotations

import logging
import os

import pandas as pd

from app.config import PROCESSED_DIR
from app.datasets import DATASET_META, PAGE_DATASETS, LARGE_DATASETS
from etl.load.cache import (
    load_file, clean_df_for_json, get_daily_cached, build_daily_cache,
    _df_cache,
)
from etl.transform.aggregator import aggregate_df

logger = logging.getLogger("app.loader")


def _safe_meta(meta: dict) -> dict:
    return {
        "label": meta.get("label", ""),
        "native": meta.get("native", ""),
        "chart_y": meta.get("chart_y", ""),
        "chart_group": meta.get("chart_group", ""),
        "wide_format": meta.get("wide_format", False),
        "value_cols": meta.get("value_cols", []),
        "group_cols": meta.get("group_cols", []),
        "filterable": meta.get("filterable", False),
    }


def get_dataset_json(
    dataset_key: str,
    resolution: str = "raw",
    limit: int = 10000,
    filter_col: str | None = None,
    filter_val: str | None = None,
    days: int | None = None,
    offset: int = 0,
) -> dict:
    meta = DATASET_META.get(dataset_key)
    if not meta:
        return {
            "dataset": dataset_key, "status": "unknown",
            "rows": 0, "returned_rows": 0, "total_rows": 0,
            "offset": 0, "has_more": False, "data": [],
        }

    use_daily_cache = resolution == "daily" and dataset_key in LARGE_DATASETS and not filter_col

    if use_daily_cache:
        cached = get_daily_cached(dataset_key, meta, PROCESSED_DIR)
        if cached is not None:
            df = cached
            if days and days > 0:
                date_col = meta.get("date_col", "Date")
                if date_col in df.columns:
                    cutoff = (pd.Timestamp.now() - pd.Timedelta(days=days)).strftime("%Y-%m-%d")
                    df = df[df[date_col] >= cutoff]
            total = len(df)
            end = offset + limit
            page = df.iloc[offset:end]
            return {
                "dataset": dataset_key, "label": meta.get("label", dataset_key),
                "status": "ok", "rows": total, "aggregated_rows": total,
                "returned_rows": len(page), "total_rows": total,
                "offset": offset, "has_more": end < total,
                "resolution": resolution, "columns": list(page.columns),
                "data": clean_df_for_json(page), "meta": _safe_meta(meta),
            }

    df = load_file(meta["file"], PROCESSED_DIR, days=days)
    if df.empty:
        return {
            "dataset": dataset_key, "label": meta.get("label", dataset_key),
            "status": "empty", "rows": 0, "returned_rows": 0, "total_rows": 0,
            "offset": 0, "has_more": False, "columns": [], "data": [],
            "meta": _safe_meta(meta),
        }

    if days and days > 0:
        date_col = meta.get("date_col", "Date")
        if date_col in df.columns:
            cutoff = (pd.Timestamp.now() - pd.Timedelta(days=days)).strftime("%Y-%m-%d")
            df = df[df[date_col] >= cutoff]

    total_raw = len(df)

    if filter_col and filter_val and filter_col in df.columns:
        df = df[df[filter_col].astype(str) == filter_val].copy()

    if use_daily_cache and not filter_col:
        build_daily_cache(dataset_key, meta, df, PROCESSED_DIR)

    df = aggregate_df(df, meta, resolution)
    total_after_agg = len(df)
    end = offset + limit
    page = df.iloc[offset:end]

    return {
        "dataset": dataset_key, "label": meta.get("label", dataset_key),
        "status": "ok", "rows": total_raw, "aggregated_rows": total_after_agg,
        "returned_rows": len(page), "total_rows": total_after_agg,
        "offset": offset, "has_more": end < total_after_agg,
        "resolution": resolution, "columns": list(page.columns),
        "data": clean_df_for_json(page), "meta": _safe_meta(meta),
    }


def get_filter_options(dataset_key: str, column: str, max_options: int = 200) -> list:
    meta = DATASET_META.get(dataset_key)
    if not meta:
        return []
    df = load_file(meta["file"], PROCESSED_DIR)
    if df.empty or column not in df.columns:
        return []
    options = df[column].dropna().astype(str).unique().tolist()
    options.sort()
    return options[:max_options]


def get_page_config(page: str) -> dict:
    dataset_keys = PAGE_DATASETS.get(page, [])
    datasets = {}
    for key in dataset_keys:
        meta = DATASET_META.get(key)
        if meta:
            datasets[key] = _safe_meta(meta)
    return {"page": page, "datasets": datasets}


def get_data_inventory() -> dict:
    inventory: dict = {}
    for page, keys in PAGE_DATASETS.items():
        inventory[page] = {}
        for key in keys:
            meta = DATASET_META.get(key)
            if not meta:
                continue
            csv_path = PROCESSED_DIR / meta["file"]
            parquet_path = csv_path.with_suffix(".parquet")
            path = parquet_path if parquet_path.exists() else csv_path
            if not path.exists():
                inventory[page][key] = {"label": meta.get("label", key), "status": "missing", "rows": 0}
            else:
                try:
                    cache_key = str(path)
                    cached = _df_cache.get(cache_key)
                    if cached:
                        row_count = len(cached[1])
                    elif path.suffix == ".parquet":
                        try:
                            import pyarrow.parquet as pq
                            row_count = pq.ParquetFile(path).metadata.num_rows
                        except Exception:
                            row_count = 0
                    else:
                        size = os.path.getsize(path)
                        with open(path, "r") as f:
                            first_line = f.readline()
                            sample = f.read(4096)
                        avg_line = len(first_line) + (len(sample) / max(sample.count("\n"), 1) if sample else len(first_line))
                        row_count = max(int(size / avg_line) - 1, 0) if avg_line > 0 else 0
                    inventory[page][key] = {
                        "label": meta.get("label", key), "status": "available",
                        "rows": row_count, "native": meta.get("native", ""),
                    }
                except Exception:
                    inventory[page][key] = {"label": meta.get("label", key), "status": "error", "rows": 0}
    return inventory
