import pandas as pd
import plotly.express as px
import streamlit as st

from src.utils import get_entity_col, get_time_col, get_numeric_columns


def line_chart(df: pd.DataFrame, x_col=None, y_col=None, color_col=None, title="Chart"):
    if df.empty:
        st.info("No data available for chart.")
        return

    x_col = x_col or get_time_col(df) or df.columns[0]

    if y_col is None:
        numeric_cols = get_numeric_columns(df)
        if not numeric_cols:
            st.info("No numeric columns found for plotting.")
            return
        y_col = numeric_cols[0]

    fig = px.line(df, x=x_col, y=y_col, color=color_col, title=title)
    st.plotly_chart(fig, use_container_width=True)


def bar_chart(df: pd.DataFrame, x_col, y_col, color_col=None, title="Bar Chart"):
    if df.empty or x_col not in df.columns or y_col not in df.columns:
        st.info("No data available for chart.")
        return

    fig = px.bar(df, x=x_col, y=y_col, color=color_col, title=title)
    st.plotly_chart(fig, use_container_width=True)


def stacked_area_chart(df: pd.DataFrame, x_col=None, y_col=None, group_col=None, title="Stacked Area Chart"):
    if df.empty:
        st.info("No data available for chart.")
        return

    x_col = x_col or get_time_col(df)
    group_col = group_col or get_entity_col(df)

    if y_col is None:
        numeric_cols = get_numeric_columns(df)
        if not numeric_cols:
            st.info("No numeric columns found for plotting.")
            return
        y_col = numeric_cols[0]

    if x_col is None or group_col is None:
        st.info("Need a time column and group column for this chart.")
        return

    fig = px.area(df, x=x_col, y=y_col, color=group_col, title=title)
    st.plotly_chart(fig, use_container_width=True)


def heatmap_by_date_he(df: pd.DataFrame, value_col: str, title="Heatmap"):
    if df.empty or "Date" not in df.columns or "HE" not in df.columns or value_col not in df.columns:
        st.info("No data available for heatmap.")
        return

    table = df.pivot_table(index="Date", columns="HE", values=value_col, aggfunc="mean")

    if table.empty:
        st.info("No data available for heatmap.")
        return

    fig = px.imshow(
        table,
        aspect="auto",
        title=title,
        labels={"x": "HE", "y": "Date", "color": value_col}
    )
    st.plotly_chart(fig, use_container_width=True)


def duration_curve(df: pd.DataFrame, value_col: str, title="Duration Curve"):
    if df.empty or value_col not in df.columns:
        st.info("No data available for chart.")
        return

    series = pd.to_numeric(df[value_col], errors="coerce").dropna().sort_values(ascending=False).reset_index(drop=True)

    if series.empty:
        st.info("No data available for chart.")
        return

    curve_df = pd.DataFrame({
        "Rank": range(1, len(series) + 1),
        value_col: series
    })

    fig = px.line(curve_df, x="Rank", y=value_col, title=title)
    st.plotly_chart(fig, use_container_width=True)