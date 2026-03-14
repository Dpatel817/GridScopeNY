import pandas as pd
import plotly.express as px
import streamlit as st

from src.data_loader import load_prices_data
from src.nav import render_sidebar_nav

render_sidebar_nav()

st.title("Prices")

prices = load_prices_data()

OPA_START_HE = 7
OPA_END_HE = 22

DATASET_CONFIG = {
    "DA Zonal LMP": {
        "key": "da_lbmp_zone",
        "entity_col": "Zone",
        "default_value": "LMP",
        "value_options": ["LMP", "MCC", "MLC"],
    },
    "RT Zonal LMP": {
        "key": "rt_lbmp_zone",
        "entity_col": "Zone",
        "default_value": "LMP",
        "value_options": ["LMP", "MCC", "MLC"],
    },
    "Integrated RT Zonal LMP": {
        "key": "integrated_rt_lbmp_zone",
        "entity_col": "Zone",
        "default_value": "LMP",
        "value_options": ["LMP", "MCC", "MLC"],
    },
    "DA Generator LMP": {
        "key": "da_lbmp_gen",
        "entity_col": "Generator",
        "default_value": "LMP",
        "value_options": ["LMP", "MCC", "MLC"],
    },
    "RT Generator LMP": {
        "key": "rt_lbmp_gen",
        "entity_col": "Generator",
        "default_value": "LMP",
        "value_options": ["LMP", "MCC", "MLC"],
    },
    "Integrated RT Generator LMP": {
        "key": "integrated_rt_lbmp_gen",
        "entity_col": "Generator",
        "default_value": "LMP",
        "value_options": ["LMP", "MCC", "MLC"],
    },
    "Reference Bus": {
        "key": "reference_bus_lbmp",
        "entity_col": "Generator",
        "default_value": "LMP",
        "value_options": ["LMP", "MCC", "MLC"],
    },
    "DA ASP": {
        "key": "damasp",
        "entity_col": "Zone",
        "default_value": "10 Min Spin",
        "value_options": ["10 Min Spin", "10 Min Non-Sync", "30 Min OR", "Reg Cap"],
    },
    "RT ASP": {
        "key": "rtasp",
        "entity_col": "Zone",
        "default_value": "10 Min Spin",
        "value_options": ["10 Min Spin", "10 Min Non-Sync", "30 Min OR", "Reg Cap"],
    },
    "External RTO CTS": {
        "key": "ext_rto_cts_price",
        "entity_col": "Generator",
        "default_value": "CTS Spread",
        "value_options": ["Gen LMP", "External CTS Price", "CTS Spread"],
    },
}


def get_default_date_range(df, time_col):
    if df.empty or time_col not in df.columns:
        return None, None

    ts = pd.to_datetime(df[time_col], errors="coerce").dropna()
    if ts.empty:
        return None, None

    return ts.dt.date.min(), ts.dt.date.max()


def filter_by_date(df, time_col, start_date, end_date):
    if df.empty or time_col not in df.columns:
        return df.copy()

    ts = pd.to_datetime(df[time_col], errors="coerce")
    mask = (ts.dt.date >= start_date) & (ts.dt.date <= end_date)
    return df.loc[mask].copy()


def format_metric(value, decimals=2):
    if pd.isna(value):
        return "-"
    return f"{value:,.{decimals}f}"


def calculate_opa(df, value_col, entity_col):
    if df.empty or value_col not in df.columns:
        return pd.DataFrame()

    if "HE" not in df.columns or "Date" not in df.columns:
        return pd.DataFrame()

    opa_df = df[(df["HE"] >= OPA_START_HE) & (df["HE"] <= OPA_END_HE)].copy()

    if opa_df.empty:
        return pd.DataFrame()

    group_cols = ["Date"]
    if entity_col in opa_df.columns:
        group_cols.append(entity_col)

    opa_df = (
        opa_df.groupby(group_cols, dropna=False)[value_col]
        .mean()
        .reset_index()
        .rename(columns={value_col: f"OPA {value_col}"})
    )

    return opa_df


def build_spread_df(da_zone_df):
    needed_cols = {"Date", "HE", "Zone", "LMP"}
    if da_zone_df.empty or not needed_cols.issubset(da_zone_df.columns):
        return pd.DataFrame()

    pivot_df = (
        da_zone_df.pivot_table(
            index=["Date", "HE"],
            columns="Zone",
            values="LMP",
            aggfunc="mean"
        )
        .reset_index()
    )

    zone_map = {str(col): col for col in pivot_df.columns}

    def get_zone_col(zone):
        return zone_map.get(zone)

    spread_df = pivot_df[["Date", "HE"]].copy()

    if get_zone_col("G") is not None and get_zone_col("A") is not None:
        spread_df["G/A Spread"] = pivot_df[get_zone_col("G")] - pivot_df[get_zone_col("A")]

    if get_zone_col("J") is not None and get_zone_col("G") is not None:
        spread_df["J/G Spread"] = pivot_df[get_zone_col("J")] - pivot_df[get_zone_col("G")]

    if get_zone_col("K") is not None and get_zone_col("J") is not None:
        spread_df["K/J Spread"] = pivot_df[get_zone_col("K")] - pivot_df[get_zone_col("J")]

    if get_zone_col("F") is not None and get_zone_col("G") is not None:
        spread_df["F/G Spread"] = pivot_df[get_zone_col("F")] - pivot_df[get_zone_col("G")]

    if get_zone_col("C") is not None and get_zone_col("A") is not None:
        spread_df["C/A Spread"] = pivot_df[get_zone_col("C")] - pivot_df[get_zone_col("A")]

    return spread_df


tab_overview, tab_hourly_pivot, tab_spreads = st.tabs(
    ["Overview", "Hourly Pivot", "Spreads"]
)

with tab_overview:
    st.subheader("Overview")

    top1, top2, top3 = st.columns(3)

    with top1:
        dataset_label = st.selectbox("Dataset", list(DATASET_CONFIG.keys()))

    dataset_cfg = DATASET_CONFIG[dataset_label]
    dataset_key = dataset_cfg["key"]
    entity_col = dataset_cfg["entity_col"]
    df = prices.get(dataset_key, pd.DataFrame()).copy()

    with top2:
        value_col = st.selectbox(
            "Metric",
            dataset_cfg["value_options"],
            index=dataset_cfg["value_options"].index(dataset_cfg["default_value"])
        )

    time_col = "Time Stamp" if "Time Stamp" in df.columns else "RTC Execution Time"
    min_date, max_date = get_default_date_range(df, time_col)

    with top3:
        if min_date is not None and max_date is not None:
            date_range = st.date_input(
                "Date range",
                value=(min_date, max_date)
            )
            if isinstance(date_range, tuple) and len(date_range) == 2:
                start_date, end_date = date_range
            else:
                start_date = date_range
                end_date = date_range
        else:
            start_date, end_date = None, None

    filtered = df.copy()

    if start_date is not None and end_date is not None:
        filtered = filter_by_date(filtered, time_col, start_date, end_date)

    filter_col1, filter_col2 = st.columns(2)

    with filter_col1:
        if "HE" in filtered.columns:
            he_options = sorted(filtered["HE"].dropna().unique().tolist())
            selected_he = st.multiselect("HE", he_options, default=he_options)
            filtered = filtered[filtered["HE"].isin(selected_he)].copy()

    with filter_col2:
        if entity_col in filtered.columns:
            entity_options = sorted(filtered[entity_col].dropna().astype(str).unique().tolist())
            selected_entities = st.multiselect(
                entity_col,
                entity_options,
                default=entity_options
            )
            filtered = filtered[filtered[entity_col].astype(str).isin(selected_entities)].copy()

    metric1, metric2, metric3, metric4 = st.columns(4)

    if not filtered.empty and value_col in filtered.columns:
        series = pd.to_numeric(filtered[value_col], errors="coerce").dropna()

        metric1.metric(f"Avg {value_col}", format_metric(series.mean()))
        metric2.metric(f"Max {value_col}", format_metric(series.max()))
        metric3.metric(f"Min {value_col}", format_metric(series.min()))
        metric4.metric("Rows", f"{len(filtered):,}")
    else:
        metric1.metric("Avg", "-")
        metric2.metric("Max", "-")
        metric3.metric("Min", "-")
        metric4.metric("Rows", "0")

    opa_df = calculate_opa(filtered, value_col, entity_col)

    left, right = st.columns([2, 1])

    with left:
        if not filtered.empty and value_col in filtered.columns:
            fig = px.line(
                filtered,
                x=time_col,
                y=value_col,
                color=entity_col if entity_col in filtered.columns else None,
                title=f"{dataset_label} | {value_col}"
            )
            st.plotly_chart(fig, use_container_width=True)
        else:
            st.info("No data available for chart.")

    with right:
        st.markdown("#### OPA Summary")
        if not opa_df.empty:
            st.dataframe(opa_df, use_container_width=True, hide_index=True)
        else:
            st.info("No OPA data available.")

    if not filtered.empty and "Date" in filtered.columns and "HE" in filtered.columns and value_col in filtered.columns:
        heatmap_df = filtered.pivot_table(
            index="Date",
            columns="HE",
            values=value_col,
            aggfunc="mean"
        )

        if not heatmap_df.empty:
            fig_heatmap = px.imshow(
                heatmap_df,
                aspect="auto",
                title=f"{dataset_label} Heatmap | {value_col}",
                labels={"x": "HE", "y": "Date", "color": value_col}
            )
            st.plotly_chart(fig_heatmap, use_container_width=True)

    st.markdown("#### Data")
    st.dataframe(filtered, use_container_width=True)

with tab_hourly_pivot:
    st.subheader("Hourly Pivot")

    zone_df = prices.get("da_lbmp_zone", pd.DataFrame()).copy()
    rt_zone_df = prices.get("rt_lbmp_zone", pd.DataFrame()).copy()

    if zone_df.empty or rt_zone_df.empty:
        st.info("DA and RT zonal processed files are required for this section.")
    else:
        pivot_col1, pivot_col2, pivot_col3 = st.columns(3)

        available_zones = sorted(zone_df["Zone"].dropna().astype(str).unique().tolist())

        with pivot_col1:
            zone_choice = st.selectbox("Zone", available_zones)

        pivot_min_date, pivot_max_date = get_default_date_range(zone_df, "Time Stamp")

        with pivot_col2:
            date_range = st.date_input(
                "Date range",
                value=(pivot_min_date, pivot_max_date),
                key="pivot_date_range"
            )
            if isinstance(date_range, tuple) and len(date_range) == 2:
                pivot_start, pivot_end = date_range
            else:
                pivot_start = date_range
                pivot_end = date_range

        with pivot_col3:
            dod_row_choice = st.selectbox(
                "DoD Chart Row",
                ["DA LMP", "DA MCC", "DA MLC", "RT LMP", "RT MCC", "RT MLC"]
            )

        zone_da = filter_by_date(zone_df, "Time Stamp", pivot_start, pivot_end)
        zone_rt = filter_by_date(rt_zone_df, "Time Stamp", pivot_start, pivot_end)

        zone_da = zone_da[zone_da["Zone"].astype(str) == str(zone_choice)].copy()
        zone_rt = zone_rt[zone_rt["Zone"].astype(str) == str(zone_choice)].copy()

        long_parts = []

        for market_name, source_df in [("DA", zone_da), ("RT", zone_rt)]:
            for metric_name in ["LMP", "MCC", "MLC"]:
                if metric_name in source_df.columns:
                    temp = source_df[["Date", "HE", metric_name]].copy()
                    temp["Market"] = market_name
                    temp["Metric"] = metric_name
                    temp["Value"] = temp[metric_name]
                    long_parts.append(temp[["Date", "HE", "Market", "Metric", "Value"]])

        if not long_parts:
            st.info("No pivot data available.")
        else:
            long_df = pd.concat(long_parts, ignore_index=True)

            hourly_pivot_df = (
                long_df.pivot_table(
                    index=["Date", "Market", "Metric"],
                    columns="HE",
                    values="Value",
                    aggfunc="mean"
                )
                .round(2)
            )

            st.dataframe(hourly_pivot_df, use_container_width=True)

            dod_market = "DA" if dod_row_choice.startswith("DA") else "RT"
            dod_metric = dod_row_choice.replace("DA ", "").replace("RT ", "")

            dod_plot_df = long_df[
                (long_df["Market"] == dod_market) &
                (long_df["Metric"] == dod_metric)
            ].copy()

            if not dod_plot_df.empty:
                fig_dod = px.line(
                    dod_plot_df,
                    x="HE",
                    y="Value",
                    color="Date",
                    markers=True,
                    title=f"{zone_choice} | {dod_row_choice} DoD"
                )
                st.plotly_chart(fig_dod, use_container_width=True)

with tab_spreads:
    st.subheader("Spreads")

    da_zone_df = prices.get("da_lbmp_zone", pd.DataFrame()).copy()

    if da_zone_df.empty:
        st.info("DA zonal LMP processed file is required for spreads.")
    else:
        spread_min_date, spread_max_date = get_default_date_range(da_zone_df, "Time Stamp")

        spread_range = st.date_input(
            "Spread date range",
            value=(spread_min_date, spread_max_date),
            key="spread_date_range"
        )

        if isinstance(spread_range, tuple) and len(spread_range) == 2:
            spread_start, spread_end = spread_range
        else:
            spread_start = spread_range
            spread_end = spread_range

        spread_source = filter_by_date(da_zone_df, "Time Stamp", spread_start, spread_end)
        spread_df = build_spread_df(spread_source)

        if spread_df.empty:
            st.info("No spread data available.")
        else:
            spread_cols = [col for col in spread_df.columns if col not in ["Date", "HE"]]

            st.dataframe(spread_df, use_container_width=True)

            spread_choice = st.multiselect(
                "Spread series",
                spread_cols,
                default=spread_cols[:3] if len(spread_cols) >= 3 else spread_cols
            )

            if spread_choice:
                daily_spread_df = spread_df.groupby("Date", as_index=False)[spread_choice].mean()

                fig_spread = px.line(
                    daily_spread_df,
                    x="Date",
                    y=spread_choice,
                    title="Daily Average DA Spreads"
                )
                st.plotly_chart(fig_spread, use_container_width=True)