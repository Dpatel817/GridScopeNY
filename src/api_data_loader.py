"""
GridScope NY — API data loader with aggregation support.
Handles NaN → None conversion, resolution-based aggregation,
and complete dataset metadata for all NYISO processed files.
"""
from __future__ import annotations

import logging
import os
import threading
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
        if col in ("Date",):
            df[col] = df[col].dt.strftime("%Y-%m-%d")
        else:
            df[col] = df[col].dt.strftime("%Y-%m-%dT%H:%M:%S")
    for col in df.columns:
        if df[col].dtype == "object":
            df[col] = df[col].where(df[col].notna(), None)
            df.loc[df[col].isin(["nan", "NaN", "NaT", "None", ""]), col] = None
    df = df.replace({np.nan: None, np.inf: None, -np.inf: None})
    records = df.to_dict(orient="records")
    return records


_COLUMN_RENAMES = {
    "LBMP ($/MWHr)": "LMP",
    "Marginal Cost Losses ($/MWHr)": "MLC",
    "Marginal Cost Congestion ($/MWHr)": "MCC",
    "Interface Name": "Interface",
    "Point ID": "PTID",
    "Flow (MWH)": "Flow",
    "Positive Limit (MWH)": "Positive Limit",
    "Negative Limit (MWH)": "Negative Limit",
    "Fuel Category": "Fuel Type",
    "Gen MW": "Generation MW",
    "Constraint Cost($)": "Constraint Cost",
    "Generator Name": "Generator",
    "Generator PTID": "PTID",
    "10 Min Spinning Reserve ($/MWHr)": "10 Min Spin",
    "10 Min Non-Synchronous Reserve ($/MWHr)": "10 Min Non-Sync",
    "30 Min Operating Reserve ($/MWHr)": "30 Min OR",
    "NYCA Regulation Capacity ($/MWHr)": "Reg Cap",
    "NYCA Regulation Movement ($/MW)": "Reg Move",
}

_ZONE_DATASETS = {
    "da_lbmp_zone", "rt_lbmp_zone", "integrated_rt_lbmp_zone",
}
_GEN_DATASETS = {
    "da_lbmp_gen", "rt_lbmp_gen", "integrated_rt_lbmp_gen",
    "reference_bus_lbmp", "ext_rto_cts_price",
}


def _normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df

    df = df.rename(columns=_COLUMN_RENAMES)

    if "Name" in df.columns:
        fname = df.attrs.get("_source_file", "")
        if "Zone" not in df.columns:
            df["Zone"] = df["Name"]
        if "Generator" not in df.columns:
            df["Generator"] = df["Name"]

    if "Time Stamp" in df.columns and "Date" not in df.columns:
        ts = pd.to_datetime(df["Time Stamp"], errors="coerce")
        df["Date"] = ts.dt.strftime("%Y-%m-%d")
        df["HE"] = ts.dt.hour
        df["Month"] = ts.dt.strftime("%Y-%m")
        df["Year"] = ts.dt.year

    _ISOLF_RENAMES = {
        "Capitl": "CAPITL", "Centrl": "CENTRL", "Dunwod": "DUNWOD",
        "Genese": "GENESE", "Hud Vl": "HUD VL", "Longil": "LONGIL",
        "Mhk Vl": "MHK VL", "Millwd": "MILLWD", "North": "NORTH", "West": "WEST",
    }
    df = df.rename(columns=_ISOLF_RENAMES)

    if "Timestamp" in df.columns and "Time Stamp" not in df.columns:
        df.rename(columns={"Timestamp": "Time Stamp"}, inplace=True)
        if "Date" not in df.columns:
            ts = pd.to_datetime(df["Time Stamp"], errors="coerce")
            df["Date"] = ts.dt.strftime("%Y-%m-%d")
            df["HE"] = ts.dt.hour
            df["Month"] = ts.dt.strftime("%Y-%m")
            df["Year"] = ts.dt.year

    for tc in ["RTC Execution Time", "RTC End Time Stamp", "Insert Time",
               "Event Start Time", "Forecast Date"]:
        if tc in df.columns and "Date" not in df.columns:
            ts = pd.to_datetime(df[tc], errors="coerce")
            df["Date"] = ts.dt.strftime("%Y-%m-%d")
            df["HE"] = ts.dt.hour
            break

    return df


MAX_ROWS_FOR_CACHE = 5_000_000
DEFAULT_RECENT_DAYS = 90

_TIME_COL_HINTS = [
    "Time Stamp", "Timestamp", "RTC Execution Time", "RTC End Time Stamp",
    "Event Start Time", "Event End Time", "Forecast Date", "Vintage Date",
    "Date", "source_date", "Out Start", "Out End", "Insert Time",
    "Scheduled Out", "Scheduled In", "Status Time", "Date Out", "Date In",
]


_DAILY_CACHE_DIR = PROCESSED_DIR / "_daily_cache"

_daily_mem_cache: dict[str, tuple[float, pd.DataFrame]] = {}
_daily_cache_lock = threading.Lock()


def _get_daily_cached(dataset_key: str, meta: dict) -> pd.DataFrame | None:
    _DAILY_CACHE_DIR.mkdir(exist_ok=True)
    daily_path = _DAILY_CACHE_DIR / f"{dataset_key}_daily.parquet"
    source_file = meta["file"]
    source_path = (PROCESSED_DIR / source_file).with_suffix(".parquet")
    if not source_path.exists():
        source_path = PROCESSED_DIR / source_file
    if not source_path.exists():
        return None
    src_mtime = os.path.getmtime(source_path)
    if daily_path.exists():
        cache_mtime = os.path.getmtime(daily_path)
        if cache_mtime >= src_mtime:
            with _daily_cache_lock:
                if dataset_key in _daily_mem_cache:
                    mem_mtime, mem_df = _daily_mem_cache[dataset_key]
                    if mem_mtime >= cache_mtime:
                        return mem_df.copy()
            try:
                df = pd.read_parquet(daily_path)
                logger.info("Loaded daily cache %s: %d rows", daily_path.name, len(df))
                with _daily_cache_lock:
                    _daily_mem_cache[dataset_key] = (cache_mtime, df)
                return df.copy()
            except Exception:
                pass
    return None


def _build_daily_cache(dataset_key: str, meta: dict, df: pd.DataFrame) -> None:
    _DAILY_CACHE_DIR.mkdir(exist_ok=True)
    daily_path = _DAILY_CACHE_DIR / f"{dataset_key}_daily.parquet"
    tmp_path = daily_path.with_suffix(".parquet.tmp")
    try:
        agg = _aggregate_df(df, meta, "daily")
        agg.to_parquet(tmp_path, index=False)
        tmp_path.rename(daily_path)
        mtime = os.path.getmtime(daily_path)
        with _daily_cache_lock:
            _daily_mem_cache[dataset_key] = (mtime, agg.copy())
        logger.info("Built daily cache %s: %d rows", daily_path.name, len(agg))
    except Exception as exc:
        if tmp_path.exists():
            tmp_path.unlink(missing_ok=True)
        logger.warning("Failed to build daily cache for %s: %s", dataset_key, exc)


_LARGE_DATASETS = {"da_lbmp_zone", "rt_lbmp_zone", "damasp", "rtasp", "rtfuelmix", "pal", "external_limits_flows"}


def _load_csv_safe(filename: str, days: int | None = None) -> pd.DataFrame:
    csv_path: Path = PROCESSED_DIR / filename
    parquet_path = csv_path.with_suffix(".parquet")

    use_parquet = False
    if parquet_path.exists() and csv_path.exists():
        try:
            import pyarrow.parquet as pq
            pf = pq.ParquetFile(parquet_path)
            pq_cols = {f.name.strip() for f in pf.schema_arrow}
            csv_sample = pd.read_csv(csv_path, nrows=0)
            csv_cols = {c.strip() for c in csv_sample.columns}
            pq_mtime = os.path.getmtime(parquet_path)
            csv_mtime = os.path.getmtime(csv_path)
            if not (csv_cols.issubset(pq_cols) or csv_cols == pq_cols):
                logger.info(
                    "Parquet %s has mismatched columns vs CSV (parquet: %s, csv: %s); using CSV",
                    parquet_path.name, pq_cols, csv_cols,
                )
                path = csv_path
            elif csv_mtime > pq_mtime:
                logger.info(
                    "CSV %s is newer than parquet (%s vs %s); using CSV",
                    csv_path.name, csv_mtime, pq_mtime,
                )
                path = csv_path
            else:
                path = parquet_path
                use_parquet = True
        except Exception:
            path = csv_path
    elif parquet_path.exists():
        path = parquet_path
        use_parquet = True
    elif csv_path.exists():
        path = csv_path
    else:
        logger.warning("File not found: %s (tried .parquet and .csv)", csv_path)
        return pd.DataFrame()

    mtime = os.path.getmtime(path)
    cache_key = f"{path}:{days}"
    cached = _df_cache.get(cache_key)
    if cached and cached[0] == mtime:
        return cached[1].copy()

    try:
        if use_parquet:
            import pyarrow.parquet as pq
            pf = pq.ParquetFile(path)
            schema_names = [f.name.strip() for f in pf.schema_arrow]
            time_col = None
            for col in _TIME_COL_HINTS:
                if col in schema_names:
                    time_col = col
                    break

            total_rows = pf.metadata.num_rows
            if time_col and total_rows > MAX_ROWS_FOR_CACHE and days != 0:
                filter_days = days or DEFAULT_RECENT_DAYS
                cutoff = pd.Timestamp.now() - pd.Timedelta(days=filter_days)
                tc_field = pf.schema_arrow.field(time_col)
                tc_type = str(tc_field.type)

                if "timestamp" in tc_type:
                    df = pd.read_parquet(path, filters=[(time_col, ">=", cutoff)])
                else:
                    cutoff_str = cutoff.strftime("%Y-%m-%d %H:%M:%S")
                    df = pd.read_parquet(path, filters=[(time_col, ">=", cutoff_str)])

                logger.info("Loaded+filtered parquet %s: %d/%d rows (last %d days)", path.name, len(df), total_rows, filter_days)
            else:
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
        for col in _TIME_COL_HINTS:
            if col in df.columns:
                if df[col].dtype == "object":
                    df[col] = pd.to_datetime(df[col], errors="coerce")

    df = _normalize_columns(df)

    if len(df) <= MAX_ROWS_FOR_CACHE:
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
    "interconnection_queue": {
        "file": "interconnection_queue_processed.csv",
        "label": "Interconnection Queue (All Sheets)",
        "native": "table",
        "group_cols": ["source_sheet"],
        "value_cols": ["sp_mw", "wp_mw"],
        "chart_y": "sp_mw",
        "chart_group": "source_sheet",
        "filterable": True,
    },
    "iq_active": {
        "file": "iq_active_processed.csv",
        "label": "Active Queue Projects",
        "native": "table",
        "group_cols": ["zone", "fuel_type"],
        "value_cols": ["sp_mw", "wp_mw"],
        "chart_y": "sp_mw",
        "chart_group": "fuel_type",
        "filterable": True,
    },
    "iq_cluster": {
        "file": "iq_cluster_processed.csv",
        "label": "Cluster Study Projects",
        "native": "table",
        "group_cols": ["zone", "fuel_type"],
        "value_cols": ["sp_mw", "wp_mw"],
        "chart_y": "sp_mw",
        "chart_group": "fuel_type",
        "filterable": True,
    },
    "iq_affected_system": {
        "file": "iq_affected_system_processed.csv",
        "label": "Affected System Projects",
        "native": "table",
        "group_cols": ["zone", "fuel_type"],
        "value_cols": ["sp_mw", "wp_mw"],
        "chart_y": "sp_mw",
        "chart_group": "fuel_type",
        "filterable": True,
    },
    "iq_in_service": {
        "file": "iq_in_service_processed.csv",
        "label": "In-Service Projects",
        "native": "table",
        "group_cols": ["zone", "fuel_type"],
        "value_cols": ["sp_mw", "wp_mw"],
        "chart_y": "sp_mw",
        "chart_group": "fuel_type",
        "filterable": True,
    },
    "iq_withdrawn": {
        "file": "iq_withdrawn_processed.csv",
        "label": "Withdrawn Projects",
        "native": "table",
        "group_cols": ["source_sheet", "fuel_type"],
        "value_cols": ["sp_mw", "wp_mw"],
        "chart_y": "sp_mw",
        "chart_group": "fuel_type",
        "filterable": True,
    },
    "iq_changes": {
        "file": "iq_changes_processed.csv",
        "label": "Queue Changes (Since Last Scrape)",
        "native": "event",
    },
    "iq_summary": {
        "file": "iq_summary_processed.csv",
        "label": "Queue Summary",
        "native": "table",
    },
}


PAGE_DATASETS = {
    "home": [
        "rt_events", "oper_messages", "generator_names",
        "load_names", "active_transmission_nodes",
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
    "interconnection_queue": [
        "interconnection_queue", "iq_active", "iq_cluster",
        "iq_affected_system", "iq_in_service", "iq_withdrawn", "iq_changes", "iq_summary",
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
    days: int | None = None,
) -> dict:
    meta = DATASET_META.get(dataset_key)
    if not meta:
        return {"dataset": dataset_key, "status": "unknown", "rows": 0, "data": []}

    use_daily_cache = (
        resolution == "daily"
        and dataset_key in _LARGE_DATASETS
        and not filter_col
    )

    if use_daily_cache:
        cached = _get_daily_cached(dataset_key, meta)
        if cached is not None:
            df = cached
            if days and days > 0:
                date_col = meta.get("date_col", "Date")
                if date_col in df.columns:
                    cutoff = (pd.Timestamp.now() - pd.Timedelta(days=days)).strftime("%Y-%m-%d")
                    df = df[df[date_col] >= cutoff]
            total_raw = len(df)
            total_after_agg = total_raw
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

    df = _load_csv_safe(meta["file"], days=days)
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

    if days and days > 0:
        date_col = meta.get("date_col", "Date")
        if date_col in df.columns:
            cutoff = (pd.Timestamp.now() - pd.Timedelta(days=days)).strftime("%Y-%m-%d")
            df = df[df[date_col] >= cutoff]

    total_raw = len(df)

    if filter_col and filter_val and filter_col in df.columns:
        df = df[df[filter_col].astype(str) == filter_val].copy()

    if use_daily_cache and not filter_col:
        _build_daily_cache(dataset_key, meta, df)

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
