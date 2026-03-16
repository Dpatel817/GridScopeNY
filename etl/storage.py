import logging
from pathlib import Path

import pandas as pd

from etl.config import PARQUET_DATA_DIR, LEGACY_RAW_DIR, LEGACY_PROCESSED_DIR

logger = logging.getLogger("etl.storage")


def dedupe_dataframe(df, primary_keys):
    if df.empty:
        return df

    if primary_keys:
        valid_keys = [k for k in primary_keys if k in df.columns]
        if valid_keys:
            df = df.drop_duplicates(subset=valid_keys, keep="last")
        else:
            df = df.drop_duplicates(keep="last")
    else:
        df = df.drop_duplicates(keep="last")

    return df.reset_index(drop=True)


def sort_dataframe(df, sort_cols):
    if sort_cols:
        valid = [c for c in sort_cols if c in df.columns]
        if valid:
            df = df.sort_values(valid).reset_index(drop=True)
    return df


def upsert_parquet(new_df, dataset_name, meta):
    if new_df.empty:
        return

    out_dir = PARQUET_DATA_DIR / dataset_name
    out_dir.mkdir(parents=True, exist_ok=True)
    parquet_path = out_dir / f"{dataset_name}.parquet"

    if "_source_file" in new_df.columns:
        new_df = new_df.drop(columns=["_source_file"])

    if parquet_path.exists():
        try:
            existing = pd.read_parquet(parquet_path)
            combined = pd.concat([existing, new_df], ignore_index=True)
        except Exception as e:
            logger.warning(f"Could not read existing parquet {parquet_path}: {e}")
            combined = new_df
    else:
        combined = new_df

    primary_keys = meta.get("primary_keys")
    combined = dedupe_dataframe(combined, primary_keys)
    combined = sort_dataframe(combined, meta.get("sort_cols", []))

    combined.to_parquet(parquet_path, index=False, engine="pyarrow")
    logger.info(f"Parquet updated: {parquet_path} ({len(combined)} rows)")
    return parquet_path


def sync_to_legacy(dataset_name, meta):
    parquet_path = PARQUET_DATA_DIR / dataset_name / f"{dataset_name}.parquet"
    if not parquet_path.exists():
        return

    try:
        df = pd.read_parquet(parquet_path)
    except Exception as e:
        logger.error(f"Cannot read parquet for legacy sync: {e}")
        return

    LEGACY_RAW_DIR.mkdir(parents=True, exist_ok=True)
    LEGACY_PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    raw_csv = LEGACY_RAW_DIR / f"{dataset_name}_raw.csv"
    df.to_csv(raw_csv, index=False)

    processed_csv = LEGACY_PROCESSED_DIR / f"{dataset_name}_processed.csv"
    df.to_csv(processed_csv, index=False)

    processed_parquet = LEGACY_PROCESSED_DIR / f"{dataset_name}_processed.parquet"
    df.to_parquet(processed_parquet, index=False, engine="pyarrow")

    logger.info(f"Synced {dataset_name} to legacy data/ ({len(df)} rows)")
