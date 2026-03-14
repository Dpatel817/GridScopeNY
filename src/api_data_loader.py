"""
GridScope NY — API data loader with aggregation support.
Handles NaN → None conversion, resolution-based aggregation,
and complete dataset metadata for all NYISO processed files.
"""
from __future__ import annotations

import logging
import os
import time
from pathlib import Path

import numpy as np
import pandas as pd

from src.config import PROCESSED_DIR

logger = logging.getLogger(__name__)

ON_PEAK_HOURS = list(range(7, 23))
OFF_PEAK_HOURS = [h for h in range(24) if h not in ON_PEAK_HOURS]

_df_cache: dict[str, tuple[float, pd.DataFrame]] = {}
_CACHE_TTL = 300


def _clean_df_for_json(df: pd.DataFrame) -> list[dict]:
    if df is None or df.empty:
        return []
    df = df.copy()
    for col in df.select_dtypes(include=["datetime64[ns]", "datetime64[ns, UTC]"]).columns:
        df[col] = df[col].dt.strftime("%Y-%m-%dT%H:%M:%S")
    for col in df.columns:
        if df[col].dtype == "object":
            df[col] = df[col].where(df[col].notna(), None)
            df.loc[df[col].isin(["nan", "NaN", "NaT", "None", ""]), col] = None
    df = df.replace({np.nan: None, np.inf: None, -np.inf: None})
    records = df.to_dict(orient="records")
    return records


def _load_csv_safe(filename: str) -> pd.DataFrame:
    csv_path: Path = PROCESSED_DIR / filename
    parquet_path = csv_path.with_suffix(".parquet")

    if parquet_path.exists():
        path = parquet_path
        use_parquet = True
    elif csv_path.exists():
        path = csv_path
        use_parquet = False
    else:
        logger.warning("File not found: %s (tried .parquet and .csv)", csv_path)
        return pd.DataFrame()

    mtime = os.path.getmtime(path)
    cache_key = str(path)
    cached = _df_cache.get(cache_key)
    if cached and cached[0] == mtime:
        return cached[1].copy()

    try:
        if use_parquet:
            df = pd.read_parquet(path)
            logger.info("Loaded parquet %s: %d rows", path.name, len(df))
        else:
            df = pd.read_csv(path, low_memory=False)
            logger.info("Loaded CSV %s: %d rows", path.name, len(df))
    except Exception as exc:
        logger.error("Failed to read %s: %s", path, exc)
        return pd.DataFrame()
    if df.empty:
        return df

    df.columns = df.columns.str.strip()

    if not use_parquet:
        DATETIME_HINTS = [
            "Time Stamp", "Timestamp", "RTC Execution Time", "RTC End Time Stamp",
            "Event Start Time", "Event End Time", "Forecast Date", "Vintage Date",
            "Date", "source_date", "Out Start", "Out End", "Insert Time",
            "Scheduled Out", "Scheduled In", "Status Time", "Date Out", "Date In",
        ]
        for col in DATETIME_HINTS:
            if col in df.columns:
                df[col] = pd.to_datetime(df[col], errors="coerce")

    _df_cache[cache_key] = (mtime, df)
    return df.copy()


DATASET_META = {
    "da_lbmp_zone": {
        "file": "da_lbmp_zone_processed.csv",
        "label": "DA Zonal LBMP (P-2A)",
        "native": "hourly",
        "time_col": "Time Stamp",
        "date_col": "Date",
        "he_col": "HE",
        "group_cols": ["Zone"],
        "value_cols": ["LMP", "MLC", "MCC"],
        "chart_y": "LMP",
        "chart_group": "Zone",
    },
    "rt_lbmp_zone": {
        "file": "rt_lbmp_zone_processed.csv",
        "label": "RT Zonal LBMP (P-24A)",
        "native": "5min",
        "time_col": "Time Stamp",
        "date_col": "Date",
        "he_col": "HE",
        "group_cols": ["Zone"],
        "value_cols": ["LMP", "MLC", "MCC"],
        "chart_y": "LMP",
        "chart_group": "Zone",
    },
    "integrated_rt_lbmp_zone": {
        "file": "integrated_rt_lbmp_zone_processed.csv",
        "label": "Integrated RT Zonal LBMP (P-4A)",
        "native": "hourly",
        "time_col": "Time Stamp",
        "date_col": "Date",
        "he_col": "HE",
        "group_cols": ["Zone"],
        "value_cols": ["LMP", "MLC", "MCC"],
        "chart_y": "LMP",
        "chart_group": "Zone",
    },
    "da_lbmp_gen": {
        "file": "da_lbmp_gen_processed.csv",
        "label": "DA Generator LBMP (P-2B)",
        "native": "hourly",
        "time_col": "Time Stamp",
        "date_col": "Date",
        "he_col": "HE",
        "group_cols": ["Generator"],
        "value_cols": ["LMP", "MLC", "MCC"],
        "chart_y": "LMP",
        "chart_group": "Generator",
        "filterable": True,
    },
    "rt_lbmp_gen": {
        "file": "rt_lbmp_gen_processed.csv",
        "label": "RT Generator LBMP (P-24B)",
        "native": "5min",
        "time_col": "Time Stamp",
        "date_col": "Date",
        "he_col": "HE",
        "group_cols": ["Generator"],
        "value_cols": ["LMP", "MLC", "MCC"],
        "chart_y": "LMP",
        "chart_group": "Generator",
        "filterable": True,
    },
    "integrated_rt_lbmp_gen": {
        "file": "integrated_rt_lbmp_gen_processed.csv",
        "label": "Integrated RT Generator LBMP (P-4B)",
        "native": "hourly",
        "time_col": "Time Stamp",
        "date_col": "Date",
        "he_col": "HE",
        "group_cols": ["Generator"],
        "value_cols": ["LMP", "MLC", "MCC"],
        "chart_y": "LMP",
        "chart_group": "Generator",
        "filterable": True,
    },
    "reference_bus_lbmp": {
        "file": "reference_bus_lbmp_processed.csv",
        "label": "Reference Bus LBMP (P-28)",
        "native": "hourly",
        "time_col": "Time Stamp",
        "date_col": "Date",
        "he_col": "HE",
        "group_cols": ["Generator"],
        "value_cols": ["LMP", "MLC", "MCC"],
        "chart_y": "LMP",
        "chart_group": "Generator",
        "filterable": True,
    },
    "ext_rto_cts_price": {
        "file": "ext_rto_cts_price_processed.csv",
        "label": "RTC vs External RTO CTS Prices (P-42)",
        "native": "5min",
        "time_col": "RTC Execution Time",
        "date_col": "Date",
        "he_col": "HE",
        "group_cols": ["Generator"],
        "value_cols": ["Gen LMP", "External CTS Price", "CTS Spread"],
        "chart_y": "CTS Spread",
        "chart_group": "Generator",
        "filterable": True,
    },
    "damasp": {
        "file": "damasp_processed.csv",
        "label": "DA Ancillary Service Prices (P-5)",
        "native": "hourly",
        "time_col": "Time Stamp",
        "date_col": "Date",
        "he_col": "HE",
        "group_cols": ["Zone"],
        "value_cols": ["10 Min Spin", "10 Min Non-Sync", "30 Min OR", "Reg Cap"],
        "chart_y": "10 Min Spin",
        "chart_group": "Zone",
    },
    "rtasp": {
        "file": "rtasp_processed.csv",
        "label": "RT Ancillary Service Prices (P-6B)",
        "native": "5min",
        "time_col": "Time Stamp",
        "date_col": "Date",
        "he_col": "HE",
        "group_cols": ["Zone"],
        "value_cols": ["10 Min Spin", "10 Min Non-Sync", "30 Min OR", "Reg Cap"],
        "chart_y": "10 Min Spin",
        "chart_group": "Zone",
    },
    "isolf": {
        "file": "isolf_processed.csv",
        "label": "ISO Load Forecast (P-7)",
        "native": "hourly",
        "time_col": "Time Stamp",
        "date_col": "Date",
        "he_col": "HE",
        "group_cols": [],
        "value_cols": ["CAPITL", "CENTRL", "DUNWOD", "GENESE", "HUD VL",
                       "LONGIL", "MHK VL", "MILLWD", "N.Y.C.", "NORTH", "WEST", "NYISO"],
        "chart_y": "NYISO",
        "wide_format": True,
    },
    "pal": {
        "file": "pal_processed.csv",
        "label": "RT Actual Load (P-58B)",
        "native": "5min",
        "time_col": "Time Stamp",
        "date_col": "Date",
        "he_col": "HE",
        "group_cols": ["Zone"],
        "value_cols": ["Load"],
        "chart_y": "Load",
        "chart_group": "Zone",
    },
    "pal_integrated": {
        "file": "pal_integrated_processed.csv",
        "label": "Integrated RT Actual Load (P-58C)",
        "native": "hourly",
        "time_col": "Time Stamp",
        "date_col": "Date",
        "he_col": "HE",
        "group_cols": ["Zone"],
        "value_cols": ["Integrated Load"],
        "chart_y": "Integrated Load",
        "chart_group": "Zone",
    },
    "lfweather": {
        "file": "lfweather_processed.csv",
        "label": "Weather Forecast (P-7A)",
        "native": "daily",
        "time_col": "Forecast Date",
        "date_col": "Forecast Date",
        "group_cols": ["Station"],
        "value_cols": ["Max Temp", "Min Temp", "Avg Temp",
                       "Max Wet Bulb", "Min Wet Bulb", "Avg Wet Bulb"],
        "chart_y": "Avg Temp",
        "chart_group": "Station",
    },
    "rtfuelmix": {
        "file": "rtfuelmix_processed.csv",
        "label": "RT Fuel Mix (P-63)",
        "native": "5min",
        "time_col": "Time Stamp",
        "date_col": "Date",
        "he_col": "HE",
        "group_cols": ["Fuel Type"],
        "value_cols": ["Generation MW"],
        "chart_y": "Generation MW",
        "chart_group": "Fuel Type",
    },
    "gen_maint_report": {
        "file": "gen_maint_report_processed.csv",
        "label": "Generation Maintenance Report (P-15)",
        "native": "daily",
        "time_col": "Date",
        "date_col": "Date",
        "group_cols": [],
        "value_cols": ["Forecasted Gen Outage MW"],
        "chart_y": "Forecasted Gen Outage MW",
    },
    "op_in_commit": {
        "file": "op_in_commit_processed.csv",
        "label": "Operator-Initiated Commitments (P-26)",
        "native": "event",
    },
    "dam_imer": {
        "file": "dam_imer_processed.csv",
        "label": "DA IMER Report (P-71)",
        "native": "hourly",
        "time_col": "Time Stamp",
        "date_col": "Date",
        "he_col": "HE",
        "group_cols": ["Zone"],
        "value_cols": ["LMP", "VOM", "IHR", "IMER CO2", "IMER NOx"],
        "chart_y": "IMER CO2",
        "chart_group": "Zone",
    },
    "rt_imer": {
        "file": "rt_imer_processed.csv",
        "label": "RT IMER Report (P-72)",
        "native": "5min",
        "time_col": "Time Stamp",
        "date_col": "Date",
        "he_col": "HE",
        "group_cols": ["Zone"],
        "value_cols": ["LMP", "VOM", "IHR", "IMER CO2", "IMER NOx"],
        "chart_y": "IMER CO2",
        "chart_group": "Zone",
    },
    "btm_da_forecast": {
        "file": "btm_da_forecast_processed.csv",
        "label": "BTM Solar DA Forecast (P-70B)",
        "native": "hourly",
        "time_col": "Time Stamp",
        "date_col": "Date",
        "he_col": "HE",
        "group_cols": ["Zone"],
        "value_cols": ["BTM Solar Forecast MW"],
        "chart_y": "BTM Solar Forecast MW",
        "chart_group": "Zone",
    },
    "btm_estimated_actual": {
        "file": "btm_estimated_actual_processed.csv",
        "label": "BTM Solar Estimated Actuals (P-70A)",
        "native": "hourly",
        "time_col": "Time Stamp",
        "date_col": "Date",
        "he_col": "HE",
        "group_cols": ["Zone"],
        "value_cols": ["BTM Solar Actual MW"],
        "chart_y": "BTM Solar Actual MW",
        "chart_group": "Zone",
    },
    "external_limits_flows": {
        "file": "external_limits_flows_processed.csv",
        "label": "Interface Limits & Flows (P-32)",
        "native": "5min",
        "time_col": "Time Stamp",
        "date_col": "Date",
        "he_col": "HE",
        "group_cols": ["Interface"],
        "value_cols": ["Flow", "Positive Limit", "Negative Limit"],
        "chart_y": "Flow",
        "chart_group": "Interface",
    },
    "atc_ttc": {
        "file": "atc_ttc_processed.csv",
        "label": "ATC / TTC (P-8)",
        "native": "hourly",
        "time_col": "Time Stamp",
        "date_col": "Date",
        "he_col": "HE",
        "group_cols": ["Interface"],
        "value_cols": ["DAM TTC", "DAM ATC", "HAM TTC 00", "HAM ATC 00"],
        "chart_y": "DAM TTC",
        "chart_group": "Interface",
    },
    "ttcf": {
        "file": "ttcf_processed.csv",
        "label": "Transfer Limitation Derates",
        "native": "event",
    },
    "par_flows": {
        "file": "par_flows_processed.csv",
        "label": "PAR Flows (P-34)",
        "native": "5min",
        "time_col": "Time Stamp",
        "date_col": "Date",
        "he_col": "HE",
        "group_cols": ["PTID"],
        "value_cols": ["PAR Flow"],
        "chart_y": "PAR Flow",
        "chart_group": "PTID",
    },
    "erie_circulation_da": {
        "file": "erie_circulation_da_processed.csv",
        "label": "Lake Erie Circulation DA (P-53B)",
        "native": "hourly",
        "time_col": "Time Stamp",
        "date_col": "Date",
        "he_col": "HE",
        "group_cols": [],
        "value_cols": ["Lake Erie Circulation"],
        "chart_y": "Lake Erie Circulation",
    },
    "erie_circulation_rt": {
        "file": "erie_circulation_rt_processed.csv",
        "label": "Lake Erie Circulation RT (P-34A)",
        "native": "5min",
        "time_col": "Time Stamp",
        "date_col": "Date",
        "he_col": "HE",
        "group_cols": [],
        "value_cols": ["Lake Erie Circulation"],
        "chart_y": "Lake Erie Circulation",
    },
    "dam_limiting_constraints": {
        "file": "dam_limiting_constraints_processed.csv",
        "label": "DA Limiting Constraints (P-511A)",
        "native": "hourly",
        "time_col": "Time Stamp",
        "date_col": "Date",
        "he_col": "HE",
        "group_cols": ["Limiting Facility"],
        "value_cols": ["Constraint Cost"],
        "chart_y": "Constraint Cost",
        "chart_group": "Limiting Facility",
    },
    "rt_limiting_constraints": {
        "file": "rt_limiting_constraints_processed.csv",
        "label": "RT Limiting Constraints (P-33)",
        "native": "5min",
        "time_col": "Time Stamp",
        "date_col": "Date",
        "he_col": "HE",
        "group_cols": ["Limiting Facility"],
        "value_cols": ["Constraint Cost"],
        "chart_y": "Constraint Cost",
        "chart_group": "Limiting Facility",
    },
    "sc_line_outages": {
        "file": "sc_line_outages_processed.csv",
        "label": "RT Scheduled Outages (P-54A)",
        "native": "event",
    },
    "rt_line_outages": {
        "file": "rt_line_outages_processed.csv",
        "label": "RT Actual Outages (P-54B)",
        "native": "event",
    },
    "out_sched": {
        "file": "out_sched_processed.csv",
        "label": "DA Scheduled Outages (P-54C)",
        "native": "event",
    },
    "outage_schedule": {
        "file": "outage_schedule_processed.csv",
        "label": "Outage Schedules (P-14B)",
        "native": "event",
    },
    "rt_events": {
        "file": "rt_events_processed.csv",
        "label": "Real-Time Events (P-35)",
        "native": "event",
    },
    "oper_messages": {
        "file": "oper_messages_processed.csv",
        "label": "Operational Announcements",
        "native": "event",
    },
    "generator_names": {
        "file": "generator_names_processed.csv",
        "label": "Generator Names (P-19)",
        "native": "table",
    },
    "load_names": {
        "file": "load_names_processed.csv",
        "label": "Load Names (P-20)",
        "native": "table",
    },
    "active_transmission_nodes": {
        "file": "active_transmission_nodes_processed.csv",
        "label": "Active Transmission Nodes (P-66)",
        "native": "table",
    },
    "zonal_uplift": {
        "file": "zonal_uplift_processed.csv",
        "label": "Zonal Uplift Report (P-45)",
        "native": "table",
    },
    "resource_uplift": {
        "file": "resource_uplift_processed.csv",
        "label": "Resource Uplift Report (P-46)",
        "native": "table",
    },
}


PAGE_DATASETS = {
    "home": [
        "rt_events", "oper_messages", "generator_names",
        "load_names", "active_transmission_nodes",
        "zonal_uplift", "resource_uplift",
    ],
    "prices": [
        "da_lbmp_zone", "rt_lbmp_zone", "integrated_rt_lbmp_zone",
        "da_lbmp_gen", "rt_lbmp_gen", "integrated_rt_lbmp_gen",
        "reference_bus_lbmp", "ext_rto_cts_price",
        "damasp", "rtasp",
    ],
    "demand": [
        "isolf", "pal", "pal_integrated", "lfweather",
    ],
    "generation": [
        "rtfuelmix", "gen_maint_report", "op_in_commit",
        "dam_imer", "rt_imer", "btm_da_forecast", "btm_estimated_actual",
    ],
    "interfaces": [
        "external_limits_flows", "atc_ttc", "ttcf",
        "par_flows", "erie_circulation_da", "erie_circulation_rt",
    ],
    "congestion": [
        "dam_limiting_constraints", "rt_limiting_constraints",
        "sc_line_outages", "rt_line_outages", "out_sched", "outage_schedule",
    ],
}


def _aggregate_df(df: pd.DataFrame, meta: dict, resolution: str) -> pd.DataFrame:
    if resolution == "raw":
        return df
    native = meta.get("native", "event")
    if native in ("event", "table", "daily"):
        return df

    date_col = meta.get("date_col", "Date")
    he_col = meta.get("he_col")
    group_cols = [c for c in meta.get("group_cols", []) if c in df.columns]
    value_cols = [c for c in meta.get("value_cols", []) if c in df.columns]

    if not value_cols or date_col not in df.columns:
        return df

    if he_col and he_col in df.columns:
        df[he_col] = pd.to_numeric(df[he_col], errors="coerce")

    if resolution == "hourly":
        if native == "hourly":
            return df
        if he_col and he_col in df.columns:
            agg_keys = [date_col, he_col] + group_cols
        else:
            return df
    elif resolution == "on_peak":
        if he_col and he_col in df.columns:
            df = df[df[he_col].isin(ON_PEAK_HOURS)].copy()
        agg_keys = [date_col] + group_cols
    elif resolution == "off_peak":
        if he_col and he_col in df.columns:
            df = df[df[he_col].isin(OFF_PEAK_HOURS)].copy()
        agg_keys = [date_col] + group_cols
    elif resolution == "daily":
        agg_keys = [date_col] + group_cols
    else:
        return df

    if df.empty:
        return df

    for vc in value_cols:
        df[vc] = pd.to_numeric(df[vc], errors="coerce")

    existing_keys = [k for k in agg_keys if k in df.columns]
    result = df.groupby(existing_keys, dropna=False)[value_cols].mean().reset_index()

    for vc in value_cols:
        result[vc] = result[vc].round(2)

    return result


def get_dataset_json(
    dataset_key: str,
    resolution: str = "raw",
    limit: int = 10000,
    filter_col: str | None = None,
    filter_val: str | None = None,
) -> dict:
    meta = DATASET_META.get(dataset_key)
    if not meta:
        return {"dataset": dataset_key, "status": "unknown", "rows": 0, "data": []}

    df = _load_csv_safe(meta["file"])
    if df.empty:
        return {
            "dataset": dataset_key,
            "label": meta.get("label", dataset_key),
            "status": "empty",
            "rows": 0,
            "columns": [],
            "data": [],
            "meta": _safe_meta(meta),
        }

    total_raw = len(df)

    if filter_col and filter_val and filter_col in df.columns:
        df = df[df[filter_col].astype(str) == filter_val].copy()

    df = _aggregate_df(df, meta, resolution)
    total_after_agg = len(df)

    if limit and len(df) > limit:
        df = df.tail(limit)

    records = _clean_df_for_json(df)

    return {
        "dataset": dataset_key,
        "label": meta.get("label", dataset_key),
        "status": "ok",
        "rows": total_raw,
        "aggregated_rows": total_after_agg,
        "returned_rows": len(records),
        "resolution": resolution,
        "columns": list(df.columns),
        "data": records,
        "meta": _safe_meta(meta),
    }


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


def get_page_config(page: str) -> dict:
    dataset_keys = PAGE_DATASETS.get(page, [])
    datasets = {}
    for key in dataset_keys:
        meta = DATASET_META.get(key)
        if meta:
            datasets[key] = _safe_meta(meta)
    return {"page": page, "datasets": datasets}


def get_filter_options(dataset_key: str, column: str, max_options: int = 200) -> list:
    meta = DATASET_META.get(dataset_key)
    if not meta:
        return []
    df = _load_csv_safe(meta["file"])
    if df.empty or column not in df.columns:
        return []
    options = df[column].dropna().astype(str).unique().tolist()
    options.sort()
    return options[:max_options]


def get_data_inventory() -> dict:
    inventory = {}
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
                inventory[page][key] = {
                    "label": meta.get("label", key),
                    "status": "missing",
                    "rows": 0,
                }
            else:
                try:
                    cache_key = str(path)
                    cached = _df_cache.get(cache_key)
                    if cached:
                        row_count = len(cached[1])
                    elif path.suffix == ".parquet":
                        try:
                            import pyarrow.parquet as pq
                            pf = pq.ParquetFile(path)
                            row_count = pf.metadata.num_rows
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
                        "label": meta.get("label", key),
                        "status": "available",
                        "rows": row_count,
                        "native": meta.get("native", ""),
                    }
                except Exception:
                    inventory[page][key] = {
                        "label": meta.get("label", key),
                        "status": "error",
                        "rows": 0,
                    }
    return inventory
