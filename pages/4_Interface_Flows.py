import pandas as pd
import plotly.express as px
import streamlit as st

from src.data_loader import load_interface_data
from src.nav import render_sidebar_nav

render_sidebar_nav()

st.title("Interface Flows")

interface_data = load_interface_data()

OPA_START_HE = 7
OPA_END_HE = 22

EXTERNAL_INTERFACES = [
    "PJM AC",
    "PJM HTP",
    "PJM Neptune",
    "PJM VFT",
    "IMO AC",
    "HQ AC",
    "HQ Cedars",
    "NE AC",
    "1385",
    "CSC",
    "CHPE",
]

INTERNAL_INTERFACES = [
    "Central East",
    "Moses South",
    "Sprainbrook/Dunwoodie",
    "Dysinger East",
    "UPNY-ConED",
    "West Central",
    "ConED LIPA",
    "Total East",
    "Staten Island",
]


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


def format_metric(value, decimals=1):
    if pd.isna(value):
        return "-"
    return f"{value:,.{decimals}f}"


def calculate_opa(df, value_col, entity_col=None):
    if df.empty or value_col not in df.columns:
        return pd.DataFrame()

    if "HE" not in df.columns or "Date" not in df.columns:
        return pd.DataFrame()

    opa_df = df[(df["HE"] >= OPA_START_HE) & (df["HE"] <= OPA_END_HE)].copy()

    if opa_df.empty:
        return pd.DataFrame()

    group_cols = ["Date"]
    if entity_col and entity_col in opa_df.columns:
        group_cols.append(entity_col)

    opa_df = (
        opa_df.groupby(group_cols, dropna=False)[value_col]
        .mean()
        .reset_index()
        .rename(columns={value_col: f"OPA {value_col}"})
    )

    return opa_df


def show_basic_metrics(df, value_col):
    m1, m2, m3, m4 = st.columns(4)

    if df.empty or value_col not in df.columns:
        m1.metric("Avg", "-")
        m2.metric("Max", "-")
        m3.metric("Min", "-")
        m4.metric("Rows", "0")
        return

    series = pd.to_numeric(df[value_col], errors="coerce").dropna()

    if series.empty:
        m1.metric("Avg", "-")
        m2.metric("Max", "-")
        m3.metric("Min", "-")
        m4.metric("Rows", f"{len(df):,}")
        return

    m1.metric(f"Avg {value_col}", format_metric(series.mean()))
    m2.metric(f"Max {value_col}", format_metric(series.max()))
    m3.metric(f"Min {value_col}", format_metric(series.min()))
    m4.metric("Rows", f"{len(df):,}")


def build_flow_vs_limit_df(flows_df, limit_df, entity_col, flow_col, limit_col):
    if flows_df.empty or limit_df.empty:
        return pd.DataFrame()

    needed_flow_cols = {"Time Stamp", entity_col, flow_col}
    needed_limit_cols = {"Time Stamp", entity_col, limit_col}

    if not needed_flow_cols.issubset(flows_df.columns):
        return pd.DataFrame()

    if not needed_limit_cols.issubset(limit_df.columns):
        return pd.DataFrame()

    left = flows_df[["Time Stamp", "Date", "HE", entity_col, flow_col]].copy()
    right_cols = ["Time Stamp", entity_col, limit_col]
    right = limit_df[right_cols].copy()

    merged = left.merge(
        right,
        on=["Time Stamp", entity_col],
        how="inner"
    )

    return merged


def build_hourly_pivot(df, value_col):
    if df.empty or value_col not in df.columns or "Date" not in df.columns or "HE" not in df.columns:
        return pd.DataFrame()

    return (
        df.pivot_table(
            index="Date",
            columns="HE",
            values=value_col,
            aggfunc="mean"
        )
        .round(1)
    )


tab_overview, tab_compare, tab_derates = st.tabs(
    ["Overview", "Flows vs TTC", "Derates / TTCF"]
)

with tab_overview:
    st.subheader("Overview")

    top1, top2, top3, top4 = st.columns(4)

    with top1:
        area_choice = st.selectbox("Area", ("Internal Interface", "External Interface"))

    with top2:
        market_choice = st.selectbox("Market", ("DA", "RT"))

    if area_choice == "Internal Interface":
        metric_choices = ("Flows", "TTC")
    else:
        metric_choices = ("Flows", "Import TTC", "Export TTC")

    with top3:
        metric_choice = st.selectbox("Metric", metric_choices)

    if area_choice == "Internal Interface":
        if metric_choice == "Flows":
            dataset_key = "par_flows"
            time_col = "Time Stamp"
            entity_col = "PTID"
            value_col = "PAR Flow"
        else:
            dataset_key = "atc_ttc"
            time_col = "Time Stamp"
            entity_col = "Interface"
            value_col = "DAM TTC" if market_choice == "DA" else "HAM TTC 00"
    else:
        if metric_choice == "Flows":
            dataset_key = "external_limits_flows"
            time_col = "Time Stamp"
            entity_col = "Interface"
            value_col = "Flow"
        elif metric_choice == "Import TTC":
            dataset_key = "ttcf"
            time_col = "Date Out"
            entity_col = "Interface Name"
            value_col = "Revised Import TTC"
        else:
            dataset_key = "ttcf"
            time_col = "Date Out"
            entity_col = "Interface Name"
            value_col = "Revised Export TTC"

    df = interface_data.get(dataset_key, pd.DataFrame()).copy()
    min_date, max_date = get_default_date_range(df, time_col)

    with top4:
        if min_date is not None and max_date is not None:
            date_range = st.date_input(
                "Date range",
                value=(min_date, max_date),
                key="interface_overview_date_range"
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

    filter_left, filter_right = st.columns(2)

    with filter_left:
        if "HE" in filtered.columns:
            he_options = sorted(filtered["HE"].dropna().unique().tolist())
            selected_he = st.multiselect(
                "HE",
                he_options,
                default=he_options,
                key="interface_overview_he"
            )
            filtered = filtered[filtered["HE"].isin(selected_he)].copy()

    with filter_right:
        if entity_col in filtered.columns:
            if entity_col == "Interface":
                if area_choice == "External Interface":
                    entity_options = [x for x in EXTERNAL_INTERFACES if x in filtered[entity_col].astype(str).unique()]
                else:
                    entity_options = [x for x in INTERNAL_INTERFACES if x in filtered[entity_col].astype(str).unique()]
            else:
                entity_options = sorted(filtered[entity_col].dropna().astype(str).unique().tolist())

            selected_entities = st.multiselect(
                entity_col,
                entity_options,
                default=entity_options,
                key="interface_overview_entities"
            )

            filtered = filtered[filtered[entity_col].astype(str).isin(selected_entities)].copy()

    show_basic_metrics(filtered, value_col)

    left, right = st.columns([2, 1])

    with left:
        if not filtered.empty and value_col in filtered.columns:
            fig = px.line(
                filtered,
                x=time_col,
                y=value_col,
                color=entity_col if entity_col in filtered.columns else None,
                title=f"{area_choice} | {market_choice} | {metric_choice}"
            )
            st.plotly_chart(fig, use_container_width=True)
        else:
            st.info("No data available for chart.")

    with right:
        st.markdown("#### OPA Summary")
        if time_col == "Time Stamp":
            opa_df = calculate_opa(filtered, value_col, entity_col)
        else:
            opa_df = pd.DataFrame()

        if not opa_df.empty:
            st.dataframe(opa_df, use_container_width=True, hide_index=True)
        else:
            st.info("No OPA data available.")

    if "HE" in filtered.columns and "Date" in filtered.columns and value_col in filtered.columns:
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
                title=f"{metric_choice} Heatmap",
                labels={"x": "HE", "y": "Date", "color": value_col}
            )
            st.plotly_chart(fig_heatmap, use_container_width=True)

    st.markdown("#### Data")
    st.dataframe(filtered, use_container_width=True)

with tab_compare:
    st.subheader("Flows vs TTC")

    compare_area = st.selectbox(
        "Comparison Area",
        ("External Interface", "Internal Interface"),
        key="compare_area"
    )

    compare_market = st.selectbox(
        "Comparison Market",
        ("DA", "RT"),
        key="compare_market"
    )

    if compare_area == "External Interface":
        flows_df = interface_data.get("external_limits_flows", pd.DataFrame()).copy()
        limits_df = interface_data.get("ttcf", pd.DataFrame()).copy()
        entity_col = "Interface"
        flow_col = "Flow"
        limit_choice = st.selectbox(
            "Limit Type",
            ("Revised Import TTC", "Revised Export TTC"),
            key="compare_limit_type"
        )
        limit_col = limit_choice
        limit_entity_col = "Interface Name"
        compare_interfaces = EXTERNAL_INTERFACES
        flow_time_col = "Time Stamp"
        limit_time_col = "Date Out"
    else:
        flows_df = interface_data.get("par_flows", pd.DataFrame()).copy()
        limits_df = interface_data.get("atc_ttc", pd.DataFrame()).copy()
        entity_col = "PTID"
        flow_col = "PAR Flow"
        limit_col = "DAM TTC" if compare_market == "DA" else "HAM TTC 00"
        limit_entity_col = "Interface"
        compare_interfaces = []
        flow_time_col = "Time Stamp"
        limit_time_col = "Time Stamp"

    compare_min_1, compare_max_1 = get_default_date_range(flows_df, flow_time_col)
    compare_min_2, compare_max_2 = get_default_date_range(limits_df, limit_time_col)

    compare_min = compare_min_1 if compare_min_1 is not None else compare_min_2
    compare_max = compare_max_1 if compare_max_1 is not None else compare_max_2

    date_range = st.date_input(
        "Comparison date range",
        value=(compare_min, compare_max),
        key="compare_date_range"
    )

    if isinstance(date_range, tuple) and len(date_range) == 2:
        compare_start, compare_end = date_range
    else:
        compare_start = date_range
        compare_end = date_range

    flows_df = filter_by_date(flows_df, flow_time_col, compare_start, compare_end)
    limits_df = filter_by_date(limits_df, limit_time_col, compare_start, compare_end)

    if compare_area == "External Interface":
        if "Interface" in flows_df.columns:
            flow_options = [x for x in compare_interfaces if x in flows_df["Interface"].astype(str).unique()]
        else:
            flow_options = []

        selected_interface = st.selectbox("Interface", flow_options, key="compare_interface")
        flows_df = flows_df[flows_df["Interface"].astype(str) == str(selected_interface)].copy()

        if "Interface Name" in limits_df.columns:
            limits_df = limits_df[limits_df["Interface Name"].astype(str) == str(selected_interface)].copy()

        if "Interface Name" in limits_df.columns and "Time Stamp" not in limits_df.columns and "Date Out" in limits_df.columns:
            limits_df["Time Stamp"] = pd.to_datetime(limits_df["Date Out"], errors="coerce")
            limits_df["Interface"] = limits_df["Interface Name"]

    merged = build_flow_vs_limit_df(
        flows_df,
        limits_df.rename(columns={limit_entity_col: entity_col}),
        entity_col=entity_col,
        flow_col=flow_col,
        limit_col=limit_col
    )

    if merged.empty:
        st.info("No overlapping flow vs TTC data available.")
    else:
        metric1, metric2, metric3 = st.columns(3)
        flow_series = pd.to_numeric(merged[flow_col], errors="coerce").dropna()
        limit_series = pd.to_numeric(merged[limit_col], errors="coerce").dropna()

        metric1.metric(f"Avg {flow_col}", format_metric(flow_series.mean()))
        metric2.metric(f"Avg {limit_col}", format_metric(limit_series.mean()))
        metric3.metric("Rows", f"{len(merged):,}")

        fig_compare = px.line(
            merged,
            x="Time Stamp",
            y=[flow_col, limit_col],
            title=f"{flow_col} vs {limit_col}"
        )
        st.plotly_chart(fig_compare, use_container_width=True)

        dod_choice = st.selectbox(
            "DoD Variable",
            [flow_col, limit_col],
            key="compare_dod_variable"
        )

        if "HE" in merged.columns and "Date" in merged.columns:
            fig_dod = px.line(
                merged,
                x="HE",
                y=dod_choice,
                color="Date",
                markers=True,
                title=f"{dod_choice} DoD"
            )
            st.plotly_chart(fig_dod, use_container_width=True)

        st.dataframe(merged, use_container_width=True)

with tab_derates:
    st.subheader("Derates / TTCF")

    ttcf_df = interface_data.get("ttcf", pd.DataFrame()).copy()

    if ttcf_df.empty:
        st.info("No TTCF data available.")
    else:
        ttcf_min, ttcf_max = get_default_date_range(ttcf_df, "Date Out")

        ttcf_range = st.date_input(
            "Derate date range",
            value=(ttcf_min, ttcf_max),
            key="ttcf_date_range"
        )

        if isinstance(ttcf_range, tuple) and len(ttcf_range) == 2:
            ttcf_start, ttcf_end = ttcf_range
        else:
            ttcf_start = ttcf_range
            ttcf_end = ttcf_range

        ttcf_df = filter_by_date(ttcf_df, "Date Out", ttcf_start, ttcf_end)

        c1, c2, c3 = st.columns(3)

        with c1:
            interface_group_choice = st.selectbox(
                "Interface Group",
                ("All", "External", "Internal"),
                key="ttcf_group"
            )

        if interface_group_choice == "External":
            available_interfaces = EXTERNAL_INTERFACES
        elif interface_group_choice == "Internal":
            available_interfaces = INTERNAL_INTERFACES
        else:
            available_interfaces = EXTERNAL_INTERFACES + INTERNAL_INTERFACES

        with c2:
            selected_interfaces = st.multiselect(
                "Interfaces",
                options=available_interfaces,
                default=available_interfaces,
                key="ttcf_interfaces"
            )

        with c3:
            ttcf_metric = st.selectbox(
                "TTCF Metric",
                [
                    "Revised Import TTC",
                    "Revised Export TTC",
                    "Import TTC Impact",
                    "Export TTC Impact",
                ],
                key="ttcf_metric"
            )

        if "Interface Name" in ttcf_df.columns and selected_interfaces:
            ttcf_df = ttcf_df[ttcf_df["Interface Name"].isin(selected_interfaces)].copy()

        show_basic_metrics(ttcf_df, ttcf_metric)

        left, right = st.columns([2, 1])

        with left:
            if not ttcf_df.empty and ttcf_metric in ttcf_df.columns:
                fig_ttcf = px.line(
                    ttcf_df,
                    x="Date Out",
                    y=ttcf_metric,
                    color="Interface Name" if "Interface Name" in ttcf_df.columns else None,
                    title=f"TTCF | {ttcf_metric}"
                )
                st.plotly_chart(fig_ttcf, use_container_width=True)
            else:
                st.info("No TTCF chart data available.")

        with right:
            st.markdown("#### Top Derates")
            display_cols = [
                col for col in [
                    "Interface Name",
                    "Derate Reason/Actual Limit",
                    "Date Out",
                    "Date In",
                    "Revised Import TTC",
                    "Revised Export TTC",
                    "Import TTC Impact",
                    "Export TTC Impact",
                ]
                if col in ttcf_df.columns
            ]

            st.dataframe(
                ttcf_df[display_cols].head(25),
                use_container_width=True
            )

        st.markdown("#### Full TTCF Table")
        st.dataframe(ttcf_df, use_container_width=True)