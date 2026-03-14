import pandas as pd
import streamlit as st

from src.config import PROCESSED_DIR
from src.utils import prepare_datetime_columns


@st.cache_data
def load_processed_data(filename: str) -> pd.DataFrame:
    path = PROCESSED_DIR / filename

    if not path.exists():
        return pd.DataFrame()

    df = pd.read_csv(path)
    df = prepare_datetime_columns(df)
    return df


@st.cache_data
def load_many(files: dict[str, str]) -> dict[str, pd.DataFrame]:
    return {name: load_processed_data(filename) for name, filename in files.items()}


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


def load_prices_data():
    return load_many(PRICES_FILES)


def load_demand_data():
    return load_many(DEMAND_FILES)


def load_generation_data():
    return load_many(GENERATION_FILES)


def load_interface_data():
    return load_many(INTERFACE_FILES)


def load_congestion_data():
    return load_many(CONGESTION_FILES)