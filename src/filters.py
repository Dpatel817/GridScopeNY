import streamlit as st
import pandas as pd

def apply_basic_filters(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df

    filtered = df.copy()

    for col in filtered.columns[:3]:
        if filtered[col].dtype == "object":
            options = sorted(filtered[col].dropna().unique().tolist())
            if options:
                selected = st.multiselect(f"Filter {col}", options, default=options)
                filtered = filtered[filtered[col].isin(selected)]

    return filtered
