import pandas as pd
import streamlit as st

from src.utils import get_entity_col, get_time_col, safe_date_range, apply_date_filter


def render_date_filter(df: pd.DataFrame, key_prefix: str = "date"):
    time_col = get_time_col(df)

    if time_col is None or df.empty:
        return None, None, time_col

    min_date, max_date = safe_date_range(df, time_col)

    if min_date is None or max_date is None:
        return None, None, time_col

    date_value = st.date_input(
        "Date range",
        value=(min_date, max_date),
        key=f"{key_prefix}_date_range"
    )

    if isinstance(date_value, tuple) and len(date_value) == 2:
        start_date, end_date = date_value
    else:
        start_date = date_value
        end_date = date_value

    return start_date, end_date, time_col


def render_he_filter(df: pd.DataFrame, key_prefix: str = "he"):
    if "HE" not in df.columns or df.empty:
        return None

    he_values = sorted(df["HE"].dropna().unique().tolist())

    selected_he = st.multiselect(
        "Hour Ending (HE)",
        options=he_values,
        default=he_values,
        key=f"{key_prefix}_he"
    )

    return selected_he


def render_entity_filter(
    df: pd.DataFrame,
    entity_col: str | None = None,
    label: str = "Select values",
    key_prefix: str = "entity"
):
    entity_col = entity_col or get_entity_col(df)

    if entity_col is None or entity_col not in df.columns or df.empty:
        return None, entity_col

    options = sorted(df[entity_col].dropna().astype(str).unique().tolist())

    selected = st.multiselect(
        label,
        options=options,
        default=options,
        key=f"{key_prefix}_{entity_col}"
    )

    return selected, entity_col


def apply_common_filters(
    df: pd.DataFrame,
    entity_col: str | None = None,
    entity_label: str = "Select values",
    key_prefix: str = "common"
) -> pd.DataFrame:
    if df.empty:
        return df.copy()

    filtered = df.copy()

    c1, c2, c3 = st.columns(3)

    with c1:
        start_date, end_date, time_col = render_date_filter(filtered, key_prefix=key_prefix)

    if start_date and end_date and time_col:
        filtered = apply_date_filter(filtered, time_col, start_date, end_date)

    with c2:
        selected_he = render_he_filter(filtered, key_prefix=key_prefix)

    if selected_he is not None and "HE" in filtered.columns:
        filtered = filtered[filtered["HE"].isin(selected_he)].copy()

    with c3:
        selected_entities, resolved_entity_col = render_entity_filter(
            filtered,
            entity_col=entity_col,
            label=entity_label,
            key_prefix=key_prefix
        )

    if selected_entities is not None and resolved_entity_col in filtered.columns:
        filtered = filtered[filtered[resolved_entity_col].astype(str).isin(selected_entities)].copy()

    return filtered.reset_index(drop=True)