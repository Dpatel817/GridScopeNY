import pandas as pd
import streamlit as st

from src.utils import format_number, get_numeric_columns


def show_metric_row(metric_dict: dict[str, str | int | float]):
    if not metric_dict:
        return

    cols = st.columns(len(metric_dict))

    for col, (label, value) in zip(cols, metric_dict.items()):
        col.metric(label, value)


def build_numeric_metrics(df: pd.DataFrame, value_col: str) -> dict[str, str]:
    if df.empty or value_col not in df.columns:
        return {}

    series = pd.to_numeric(df[value_col], errors="coerce").dropna()
    if series.empty:
        return {}

    return {
        f"Avg {value_col}": format_number(series.mean()),
        f"Max {value_col}": format_number(series.max()),
        f"Min {value_col}": format_number(series.min()),
        "Rows": f"{len(df):,}",
    }


def build_price_metrics(df: pd.DataFrame, value_col: str = "LMP") -> dict[str, str]:
    return build_numeric_metrics(df, value_col)


def build_demand_metrics(df: pd.DataFrame) -> dict[str, str]:
    for col in ["Load", "Integrated Load", "NYISO"]:
        if col in df.columns:
            return build_numeric_metrics(df, col)
    return {}


def build_generation_metrics(df: pd.DataFrame) -> dict[str, str]:
    for col in ["Generation MW", "Forecasted Gen Outage MW", "BTM Solar Forecast MW", "BTM Solar Actual MW"]:
        if col in df.columns:
            return build_numeric_metrics(df, col)
    return {}


def build_interface_metrics(df: pd.DataFrame) -> dict[str, str]:
    for col in ["Flow", "PAR Flow", "Lake Erie Circulation", "TTC", "ATC", "Revised Import TTC", "Revised Export TTC"]:
        if col in df.columns:
            return build_numeric_metrics(df, col)
    return {}


def build_congestion_metrics(df: pd.DataFrame) -> dict[str, str]:
    for col in ["Constraint Cost", "Zonal Uplift", "Resource Uplift", "Outage Duration Hours"]:
        if col in df.columns:
            return build_numeric_metrics(df, col)

    return {"Rows": f"{len(df):,}"} if not df.empty else {}


def rank_opportunities(
    df: pd.DataFrame,
    score_col: str | None = None,
    ascending: bool = False,
    top_n: int | None = 20
) -> pd.DataFrame:
    if df.empty:
        return df

    ranked = df.copy()

    if score_col and score_col in ranked.columns:
        ranked["score"] = pd.to_numeric(ranked[score_col], errors="coerce").fillna(0)
    else:
        numeric_cols = get_numeric_columns(ranked)
        if numeric_cols:
            ranked["score"] = ranked[numeric_cols].apply(pd.to_numeric, errors="coerce").fillna(0).sum(axis=1)
        else:
            ranked["score"] = 0

    ranked = ranked.sort_values("score", ascending=ascending).reset_index(drop=True)

    if top_n is not None:
        ranked = ranked.head(top_n)

    return ranked