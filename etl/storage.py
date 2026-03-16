import gc
import logging
from pathlib import Path

import pandas as pd

from etl.config import PARQUET_DATA_DIR, LEGACY_RAW_DIR, LEGACY_PROCESSED_DIR

logger = logging.getLogger("etl.storage")

LARGE_DATASET_THRESHOLD = 100_000


def _sanitize_for_parquet(df):
    for col in df.columns:
        if df[col].dtype == "object":
            df[col] = df[col].apply(
                lambda x: str(x) if x is not None and x is not pd.NA and not (isinstance(x, float) and pd.isna(x)) else None
            )
    return df


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


def _get_year_month_from_df(df, ts_col):
    if ts_col and ts_col in df.columns:
        ts = pd.to_datetime(df[ts_col], errors="coerce")
        valid = ts.dropna()
        if not valid.empty:
            return valid.iloc[0].strftime("%Y-%m")
    return None


def upsert_parquet(new_df, dataset_name, meta, year_month=None):
    if new_df.empty:
        return

    out_dir = PARQUET_DATA_DIR / dataset_name
    out_dir.mkdir(parents=True, exist_ok=True)

    if "_source_file" in new_df.columns:
        new_df = new_df.drop(columns=["_source_file"])

    primary_keys = meta.get("primary_keys")

    if year_month:
        partition_path = out_dir / f"{dataset_name}_{year_month}.parquet"
        if partition_path.exists():
            try:
                existing = pd.read_parquet(partition_path)
                combined = pd.concat([existing, new_df], ignore_index=True)
                del existing
                gc.collect()
            except Exception:
                combined = new_df
        else:
            combined = new_df

        combined = dedupe_dataframe(combined, primary_keys)
        combined = sort_dataframe(combined, meta.get("sort_cols", []))
        combined = _sanitize_for_parquet(combined)
        combined.to_parquet(partition_path, index=False, engine="pyarrow")
        logger.info(f"Partition updated: {partition_path.name} ({len(combined)} rows)")
        del combined
        gc.collect()
        return partition_path

    parquet_path = out_dir / f"{dataset_name}.parquet"

    if parquet_path.exists():
        try:
            existing = pd.read_parquet(parquet_path)
            combined = pd.concat([existing, new_df], ignore_index=True)
            del existing
            gc.collect()
        except Exception as e:
            logger.warning(f"Could not read existing parquet {parquet_path}: {e}")
            combined = new_df
    else:
        combined = new_df

    combined = dedupe_dataframe(combined, primary_keys)
    combined = sort_dataframe(combined, meta.get("sort_cols", []))
    combined = _sanitize_for_parquet(combined)
    combined.to_parquet(parquet_path, index=False, engine="pyarrow")
    logger.info(f"Parquet updated: {parquet_path} ({len(combined)} rows)")
    del combined
    gc.collect()
    return parquet_path


def merge_partitions(dataset_name):
    out_dir = PARQUET_DATA_DIR / dataset_name
    partitions = sorted(out_dir.glob(f"{dataset_name}_*.parquet"))
    if not partitions:
        return
    master = out_dir / f"{dataset_name}.parquet"
    if master.exists() and not partitions:
        return

    frames = []
    for p in partitions:
        try:
            frames.append(pd.read_parquet(p))
        except Exception as e:
            logger.warning(f"Cannot read partition {p}: {e}")
    if frames:
        combined = pd.concat(frames, ignore_index=True)
        del frames
        gc.collect()
        combined.to_parquet(master, index=False, engine="pyarrow")
        logger.info(f"Merged {len(partitions)} partitions into {master.name} ({len(combined)} rows)")
        del combined
        gc.collect()


def sync_to_legacy(dataset_name, meta):
    out_dir = PARQUET_DATA_DIR / dataset_name
    master_path = out_dir / f"{dataset_name}.parquet"
    partitions = sorted(out_dir.glob(f"{dataset_name}_*.parquet"))

    LEGACY_RAW_DIR.mkdir(parents=True, exist_ok=True)
    LEGACY_PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    if partitions:
        total_size = sum(p.stat().st_size for p in partitions)
        if total_size > 500_000_000:
            logger.info(f"Skipping legacy CSV sync for {dataset_name} (partitions too large: {total_size // 1_000_000}MB)")
            processed_parquet = LEGACY_PROCESSED_DIR / f"{dataset_name}_processed.parquet"
            frames = []
            for p in partitions:
                try:
                    frames.append(pd.read_parquet(p))
                except Exception:
                    pass
            if frames:
                df = pd.concat(frames, ignore_index=True)
                del frames
                gc.collect()
                df.to_parquet(processed_parquet, index=False, engine="pyarrow")
                logger.info(f"Synced {dataset_name} parquet only ({len(df)} rows)")
                del df
                gc.collect()
            return
        frames = []
        for p in partitions:
            try:
                frames.append(pd.read_parquet(p))
            except Exception:
                pass
        if not frames:
            return
        df = pd.concat(frames, ignore_index=True)
        del frames
        gc.collect()
    elif master_path.exists():
        try:
            df = pd.read_parquet(master_path)
        except Exception as e:
            logger.error(f"Cannot read parquet for legacy sync: {e}")
            return
    else:
        return

    raw_csv = LEGACY_RAW_DIR / f"{dataset_name}_raw.csv"
    df.to_csv(raw_csv, index=False)

    processed_csv = LEGACY_PROCESSED_DIR / f"{dataset_name}_processed.csv"
    df.to_csv(processed_csv, index=False)

    processed_parquet = LEGACY_PROCESSED_DIR / f"{dataset_name}_processed.parquet"
    df.to_parquet(processed_parquet, index=False, engine="pyarrow")

    logger.info(f"Synced {dataset_name} to legacy data/ ({len(df)} rows)")
    del df
    gc.collect()
