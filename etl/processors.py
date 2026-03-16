import logging
from pathlib import Path

import pandas as pd

from etl.config import PROCESSED_CSV_DIR

logger = logging.getLogger("etl.processors")


def clean_dataframe(df):
    df.columns = df.columns.str.strip()
    for col in df.select_dtypes(include="object").columns:
        df[col] = df[col].astype("string").str.strip()
    return df


def parse_timestamps(df, ts_col):
    if ts_col and ts_col in df.columns:
        df[ts_col] = pd.to_datetime(df[ts_col], errors="coerce")
    return df


def coerce_numerics(df, exclude_cols=None):
    exclude = set(exclude_cols or [])
    for col in df.columns:
        if col in exclude:
            continue
        if df[col].dtype == "object" or str(df[col].dtype) == "string":
            try:
                numeric = pd.to_numeric(df[col], errors="coerce")
                non_null_orig = df[col].notna().sum()
                non_null_numeric = numeric.notna().sum()
                if non_null_orig > 0 and non_null_numeric / max(non_null_orig, 1) > 0.8:
                    df[col] = numeric
            except (ValueError, TypeError):
                pass
    return df


def process_raw_file(path, meta):
    from etl.fetchers import read_raw_file
    df = read_raw_file(path)
    if df.empty:
        return df

    df = clean_dataframe(df)

    ts_col = meta.get("timestamp_col")
    df = parse_timestamps(df, ts_col)

    string_cols = [ts_col] if ts_col else []
    pk = meta.get("primary_keys") or []
    string_cols.extend([c for c in pk if c != ts_col])
    df = coerce_numerics(df, exclude_cols=string_cols)

    return df


def process_raw_files(paths, meta, dataset_name):
    frames = []
    for p in paths:
        df = process_raw_file(p, meta)
        if not df.empty:
            df["_source_file"] = p.name
            frames.append(df)

    if not frames:
        return pd.DataFrame()

    combined = pd.concat(frames, ignore_index=True)
    return combined


def save_processed_csv(df, dataset_name):
    out_dir = PROCESSED_CSV_DIR / dataset_name
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{dataset_name}.csv"
    df.to_csv(path, index=False)
    logger.info(f"Saved processed CSV: {path}")
    return path
