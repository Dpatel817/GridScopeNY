"""
QA-enhanced data loader for the FastAPI backend.
No Streamlit dependency — safe for use in API context.
Handles NaN → None conversion, empty DataFrames, and type coercion.
"""
from __future__ import annotations

import logging
import math
from functools import lru_cache
from pathlib import Path

import pandas as pd

from src.config import PROCESSED_DIR

logger = logging.getLogger(__name__)


def _nan_safe_value(val):
    """Convert NaN/Inf float values to None for JSON serialization."""
    if val is None:
        return None
    if isinstance(val, float) and (math.isnan(val) or math.isinf(val)):
        return None
    return val


def _clean_df_for_json(df: pd.DataFrame) -> list[dict]:
    """
    Convert a DataFrame to a list of dicts safe for JSON:
    - NaN → None
    - Timestamps → ISO strings
    - Inf → None
    """
    if df is None or df.empty:
        return []

    result = []
    for _, row in df.iterrows():
        record = {}
        for col, val in row.items():
            if pd.isna(val) if not isinstance(val, (list, dict)) else False:
                record[col] = None
            elif hasattr(val, "isoformat"):
                record[col] = val.isoformat()
            elif isinstance(val, float) and (math.isnan(val) or math.isinf(val)):
                record[col] = None
            else:
                record[col] = val
        result.append(record)
    return result


def _load_csv_safe(filename: str) -> pd.DataFrame:
    """
    Load a processed CSV with full QA:
    - File missing → empty DataFrame (not an exception)
    - Parse errors → log and return empty DataFrame
    - Datetime columns auto-detected and parsed
    - Whitespace stripped from string columns
    """
    path: Path = PROCESSED_DIR / filename
    if not path.exists():
        logger.warning("Processed file not found: %s", path)
        return pd.DataFrame()

    try:
        df = pd.read_csv(path, low_memory=False)
    except Exception as exc:
        logger.error("Failed to read %s: %s", path, exc)
        return pd.DataFrame()

    if df.empty:
        return df

    df.columns = df.columns.str.strip()

    for col in df.select_dtypes(include="object").columns:
        df[col] = df[col].astype(str).str.strip()
        df.loc[df[col].isin(["nan", "None", "NaN", ""]), col] = None

    DATETIME_HINTS = [
        "Time Stamp", "Timestamp", "RTC Execution Time", "RTC End Time Stamp",
        "Event Start Time", "Event End Time", "Forecast Date", "Vintage Date",
        "Date", "source_date", "Out Start", "Out End", "Insert Time",
        "Scheduled Out", "Scheduled In", "Status Time",
    ]
    for col in DATETIME_HINTS:
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors="coerce")

    NUMERIC_HINTS = [
        "LMP", "MLC", "MCC", "Load", "Integrated Load", "Flow",
        "Positive Limit", "Negative Limit", "Constraint Cost",
        "Outage Duration Hours", "HE", "PTID", "Month", "Year",
        "Generation MW", "BTM Solar Forecast MW", "BTM Solar Actual MW",
        "10 Min Spin", "10 Min Non-Sync", "30 Min OR", "Reg Cap",
        "DAM TTC", "DAM ATC", "Revised Import TTC", "Revised Export TTC",
        "Import TTC Impact", "Export TTC Impact",
        "Max Temp", "Min Temp", "Avg Temp", "Max Wet Bulb", "Min Wet Bulb",
        "Avg Wet Bulb", "Lake Erie Circulation", "PAR Flow",
        "Gen LMP", "External CTS Price", "CTS Spread",
    ]
    for col in NUMERIC_HINTS:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    logger.info("Loaded %s: %d rows, %d cols", filename, len(df), len(df.columns))
    return df


PRICES_FILES = {
    "da_lbmp_zone": "da_lbmp_zone_processed.csv",
    "da_lbmp_gen": "da_lbmp_gen_processed.csv",
    "rt_lbmp_zone": "rt_lbmp_zone_processed.csv",
    "rt_lbmp_gen": "rt_lbmp_gen_processed.csv",
    "integrated_rt_lbmp_zone": "integrated_rt_lbmp_zone_processed.csv",
    "integrated_rt_lbmp_gen": "integrated_rt_lbmp_gen_processed.csv",
    "damasp": "damasp_processed.csv",
    "rtasp": "rtasp_processed.csv",
    "ext_rto_cts_price": "ext_rto_cts_price_processed.csv",
    "reference_bus_lbmp": "reference_bus_lbmp_processed.csv",
}

DEMAND_FILES = {
    "isolf": "isolf_processed.csv",
    "lfweather": "lfweather_processed.csv",
    "pal": "pal_processed.csv",
    "pal_integrated": "pal_integrated_processed.csv",
    "btm_da_forecast": "btm_da_forecast_processed.csv",
    "btm_estimated_actual": "btm_estimated_actual_processed.csv",
}

GENERATION_FILES = {
    "rtfuelmix": "rtfuelmix_processed.csv",
    "gen_maint_report": "gen_maint_report_processed.csv",
    "op_in_commit": "op_in_commit_processed.csv",
    "dam_imer": "dam_imer_processed.csv",
    "rt_imer": "rt_imer_processed.csv",
    "generator_names": "generator_names_processed.csv",
    "rt_events": "rt_events_processed.csv",
    "oper_messages": "oper_messages_processed.csv",
    "resource_uplift": "resource_uplift_processed.csv",
}

INTERFACE_FILES = {
    "external_limits_flows": "external_limits_flows_processed.csv",
    "atc_ttc": "atc_ttc_processed.csv",
    "ttcf": "ttcf_processed.csv",
    "par_flows": "par_flows_processed.csv",
    "erie_circulation_da": "erie_circulation_da_processed.csv",
    "erie_circulation_rt": "erie_circulation_rt_processed.csv",
}

CONGESTION_FILES = {
    "dam_limiting_constraints": "dam_limiting_constraints_processed.csv",
    "rt_limiting_constraints": "rt_limiting_constraints_processed.csv",
    "out_sched": "out_sched_processed.csv",
    "outage_schedule": "outage_schedule_processed.csv",
    "sc_line_outages": "sc_line_outages_processed.csv",
    "rt_line_outages": "rt_line_outages_processed.csv",
    "zonal_uplift": "zonal_uplift_processed.csv",
    "active_transmission_nodes": "active_transmission_nodes_processed.csv",
    "load_names": "load_names_processed.csv",
}

ALL_FILE_MAPS = {
    "prices": PRICES_FILES,
    "demand": DEMAND_FILES,
    "generation": GENERATION_FILES,
    "interfaces": INTERFACE_FILES,
    "congestion": CONGESTION_FILES,
}


def load_category(category: str) -> dict[str, pd.DataFrame]:
    """Load all datasets for a category."""
    file_map = ALL_FILE_MAPS.get(category, {})
    result = {}
    for key, filename in file_map.items():
        result[key] = _load_csv_safe(filename)
    return result


def get_dataset(category: str, dataset: str) -> pd.DataFrame:
    """Load a single dataset, returning empty DataFrame if not found."""
    file_map = ALL_FILE_MAPS.get(category, {})
    filename = file_map.get(dataset)
    if not filename:
        return pd.DataFrame()
    return _load_csv_safe(filename)


def get_dataset_json(
    category: str,
    dataset: str,
    limit: int = 5000,
) -> dict:
    """
    Load a dataset and return JSON-safe dict with metadata.
    Handles NaN, Inf, datetime serialization.
    """
    df = get_dataset(category, dataset)

    if df.empty:
        return {
            "dataset": dataset,
            "category": category,
            "rows": 0,
            "columns": [],
            "data": [],
            "status": "empty",
            "message": "No processed data found. Run the ETL to fetch NYISO data.",
        }

    total_rows = len(df)
    nan_counts = df.isna().sum()
    nan_summary = {col: int(cnt) for col, cnt in nan_counts.items() if cnt > 0}

    if limit and len(df) > limit:
        df = df.tail(limit)

    records = _clean_df_for_json(df)

    return {
        "dataset": dataset,
        "category": category,
        "rows": total_rows,
        "returned_rows": len(records),
        "columns": list(df.columns),
        "data": records,
        "status": "ok",
        "nan_summary": nan_summary,
    }


def get_data_inventory() -> dict:
    """Return inventory of all datasets showing which have data and how many rows."""
    inventory = {}
    for category, file_map in ALL_FILE_MAPS.items():
        inventory[category] = {}
        for key, filename in file_map.items():
            path = PROCESSED_DIR / filename
            if not path.exists():
                inventory[category][key] = {"status": "missing", "rows": 0}
            else:
                try:
                    df = pd.read_csv(path, nrows=1)
                    full_df = pd.read_csv(path)
                    inventory[category][key] = {
                        "status": "available",
                        "rows": len(full_df),
                        "columns": list(full_df.columns),
                    }
                except Exception as exc:
                    inventory[category][key] = {"status": "error", "rows": 0, "error": str(exc)}
    return inventory
