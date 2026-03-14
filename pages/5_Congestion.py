import pandas as pd
import plotly.express as px
import streamlit as st

from src.data_loader import load_congestion_data
from src.nav import render_sidebar_nav

render_sidebar_nav()

st.title("Congestion")

congestion = load_congestion_data()

OPA_START_HE = 7
OPA_END_HE = 22


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


tab_overview, tab_constraints, tab_outages, tab_reference = st.tabs(
    ["Overview", "Constraints", "Outages & Uplift", "Reference Tables"]
)

with tab_overview:
    st.subheader("Overview")

    dataset_options = {
        "DA Limiting Constraints": {
            "key": "dam_limiting_constraints",
            "time_col": "Time Stamp",
            "entity_col": "Limiting Facility",
            "value_options": ["Constraint Cost"],
            "default_value": "Constraint Cost",
        },
        "RT Limiting Constraints": {
            "key": "rt_limiting_constraints",
            "time_col": "Time Stamp",
            "entity_col": "Limiting Facility",
            "value_options": ["Constraint Cost"],
            "default_value": "Constraint Cost",
        },
        "Zonal Uplift": {
            "key": "zonal_uplift",
            "time_col": "Time Stamp",
            "entity_col": "Zone",
            "value_options": ["Zonal Uplift"],
            "default_value": "Zonal Uplift",
        },
        "DA Scheduled Outages": {
            "key": "out_sched",
            "time_col": "Time Stamp",
            "entity_col": "Equipment",
            "value_options": ["Outage Duration Hours"],
            "default_value": "Outage Duration Hours",
        },
        "Scheduled Line Outages": {
            "key": "sc_line_outages",
            "time_col": "Time Stamp",
            "entity_col": "Equipment",
            "value_options": ["Outage Duration Hours"],
            "default_value": "Outage Duration Hours",
        },
        "RT Line Outages": {
            "key": "rt_line_outages",
            "time_col": "Time Stamp",
            "entity_col": "Equipment",
            "value_options": ["Outage Duration Hours"],
            "default_value": "Outage Duration Hours",
        },
    }

    c1, c2, c3 = st.columns(3)

    with c1:
        dataset_label = st.selectbox("Dataset", list(dataset_options.keys()))

    cfg = dataset_options[dataset_label]
    df = congestion.get(cfg["key"], pd.DataFrame()).copy()
    time_col = cfg["time_col"]
    entity_col = cfg["entity_col"]

    with c2:
        value_col = st.selectbox(
            "Metric",
            cfg["value_options"],
            index=cfg["value_options"].index(cfg["default_value"])
        )

    min_date, max_date = get_default_date_range(df, time_col)

    with c3:
        if min_date is not None and max_date is not None:
            date_range = st.date_input(
                "Date range",
                value=(min_date, max_date),
                key="congestion_overview_date_range"
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
                key="congestion_overview_he"
            )
            filtered = filtered[filtered["HE"].isin(selected_he)].copy()

    with filter_right:
        if entity_col in filtered.columns:
            entity_options = sorted(filtered[entity_col].dropna().astype(str).unique().tolist())
            default_entities = entity_options[:15] if len(entity_options) > 15 else entity_options
            selected_entities = st.multiselect(
                entity_col,
                entity_options,
                default=default_entities,
                key="congestion_overview_entities"
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
                title=f"{dataset_label} | {value_col}"
            )
            st.plotly_chart(fig, use_container_width=True)
        else:
            st.info("No data available for chart.")

    with right:
        st.markdown("#### OPA Summary")
        opa_df = calculate_opa(filtered, value_col, entity_col)
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
                title=f"{dataset_label} Heatmap | {value_col}",
                labels={"x": "HE", "y": "Date", "color": value_col}
            )
            st.plotly_chart(fig_heatmap, use_container_width=True)

    st.markdown("#### Data")
    st.dataframe(filtered, use_container_width=True)

with tab_constraints:
    st.subheader("Constraints")

    da_df = congestion.get("dam_limiting_constraints", pd.DataFrame()).copy()
    rt_df = congestion.get("rt_limiting_constraints", pd.DataFrame()).copy()

    if da_df.empty and rt_df.empty:
        st.info("No DA or RT limiting constraints data available.")
    else:
        c1, c2, c3 = st.columns(3)

        merged_base = pd.concat(
            [df for df in [da_df, rt_df] if not df.empty],
            ignore_index=True
        ) if not da_df.empty or not rt_df.empty else pd.DataFrame()

        base_min, base_max = get_default_date_range(merged_base, "Time Stamp")

        with c1:
            date_range = st.date_input(
                "Constraint date range",
                value=(base_min, base_max),
                key="constraint_date_range"
            )
            if isinstance(date_range, tuple) and len(date_range) == 2:
                constraint_start, constraint_end = date_range
            else:
                constraint_start = date_range
                constraint_end = date_range

        da_df = filter_by_date(da_df, "Time Stamp", constraint_start, constraint_end)
        rt_df = filter_by_date(rt_df, "Time Stamp", constraint_start, constraint_end)

        available_facilities = sorted(
            pd.concat([
                da_df["Limiting Facility"] if "Limiting Facility" in da_df.columns else pd.Series(dtype="object"),
                rt_df["Limiting Facility"] if "Limiting Facility" in rt_df.columns else pd.Series(dtype="object")
            ]).dropna().astype(str).unique().tolist()
        )

        with c2:
            selected_facilities = st.multiselect(
                "Facilities",
                available_facilities,
                default=available_facilities[:10] if len(available_facilities) > 10 else available_facilities,
                key="constraint_facilities"
            )

        with c3:
            metric_choice = st.selectbox(
                "Metric",
                ["Constraint Cost"],
                key="constraint_metric"
            )

        if selected_facilities:
            if "Limiting Facility" in da_df.columns:
                da_df = da_df[da_df["Limiting Facility"].astype(str).isin(selected_facilities)].copy()
            if "Limiting Facility" in rt_df.columns:
                rt_df = rt_df[rt_df["Limiting Facility"].astype(str).isin(selected_facilities)].copy()

        left, right = st.columns([2, 1])

        with left:
            chart_parts = []

            if not da_df.empty and metric_choice in da_df.columns:
                temp = da_df[["Time Stamp", "Limiting Facility", metric_choice]].copy()
                temp["Market"] = "DA"
                chart_parts.append(temp)

            if not rt_df.empty and metric_choice in rt_df.columns:
                temp = rt_df[["Time Stamp", "Limiting Facility", metric_choice]].copy()
                temp["Market"] = "RT"
                chart_parts.append(temp)

            if chart_parts:
                chart_df = pd.concat(chart_parts, ignore_index=True)

                fig = px.line(
                    chart_df,
                    x="Time Stamp",
                    y=metric_choice,
                    color="Limiting Facility",
                    line_dash="Market",
                    title="DA vs RT Constraint Cost"
                )
                st.plotly_chart(fig, use_container_width=True)
            else:
                st.info("No constraint chart data available.")

        with right:
            st.markdown("#### Top Constraint Costs")

            top_parts = []

            if not da_df.empty and metric_choice in da_df.columns:
                temp = da_df.copy()
                temp["Market"] = "DA"
                top_parts.append(temp)

            if not rt_df.empty and metric_choice in rt_df.columns:
                temp = rt_df.copy()
                temp["Market"] = "RT"
                top_parts.append(temp)

            if top_parts:
                top_df = pd.concat(top_parts, ignore_index=True)
                top_df[metric_choice] = pd.to_numeric(top_df[metric_choice], errors="coerce")
                top_df = top_df.sort_values(metric_choice, ascending=False)

                display_cols = [
                    col for col in [
                        "Market", "Time Stamp", "Limiting Facility", "Contingency", metric_choice
                    ]
                    if col in top_df.columns
                ]
                st.dataframe(top_df[display_cols].head(25), use_container_width=True)
            else:
                st.info("No top constraint data available.")

        st.markdown("#### Hourly Pivot")
        if not rt_df.empty:
            pivot_df = build_hourly_pivot(rt_df, metric_choice)
            if not pivot_df.empty:
                st.dataframe(pivot_df, use_container_width=True)
            else:
                st.info("No hourly pivot available.")
        else:
            st.info("No RT constraint pivot available.")

        st.markdown("#### Raw Tables")
        raw_tab1, raw_tab2 = st.tabs(["DA Constraints", "RT Constraints"])

        with raw_tab1:
            st.dataframe(da_df, use_container_width=True)

        with raw_tab2:
            st.dataframe(rt_df, use_container_width=True)

with tab_outages:
    st.subheader("Outages & Uplift")

    outage_tabs = st.tabs(
        ["DA Scheduled Outages", "Scheduled Line Outages", "RT Line Outages", "Outage Schedule", "Zonal Uplift"]
    )

    with outage_tabs[0]:
        out_sched_df = congestion.get("out_sched", pd.DataFrame()).copy()

        if out_sched_df.empty:
            st.info("No DA scheduled outages available.")
        else:
            date_min, date_max = get_default_date_range(out_sched_df, "Time Stamp")
            date_range = st.date_input(
                "DA scheduled outages date range",
                value=(date_min, date_max),
                key="out_sched_date_range"
            )
            if isinstance(date_range, tuple) and len(date_range) == 2:
                start_date, end_date = date_range
            else:
                start_date = date_range
                end_date = date_range

            out_sched_df = filter_by_date(out_sched_df, "Time Stamp", start_date, end_date)

            equipment_options = sorted(out_sched_df["Equipment"].dropna().astype(str).unique().tolist()) if "Equipment" in out_sched_df.columns else []
            selected_equipment = st.multiselect(
                "Equipment",
                equipment_options,
                default=equipment_options[:20] if len(equipment_options) > 20 else equipment_options,
                key="out_sched_equipment"
            )

            if selected_equipment:
                out_sched_df = out_sched_df[out_sched_df["Equipment"].astype(str).isin(selected_equipment)].copy()

            show_basic_metrics(out_sched_df, "Outage Duration Hours")
            st.dataframe(out_sched_df, use_container_width=True)

    with outage_tabs[1]:
        sc_df = congestion.get("sc_line_outages", pd.DataFrame()).copy()

        if sc_df.empty:
            st.info("No scheduled line outages available.")
        else:
            date_min, date_max = get_default_date_range(sc_df, "Time Stamp")
            date_range = st.date_input(
                "Scheduled line outages date range",
                value=(date_min, date_max),
                key="sc_line_outages_date_range"
            )
            if isinstance(date_range, tuple) and len(date_range) == 2:
                start_date, end_date = date_range
            else:
                start_date = date_range
                end_date = date_range

            sc_df = filter_by_date(sc_df, "Time Stamp", start_date, end_date)

            if not sc_df.empty and "Outage Duration Hours" in sc_df.columns:
                fig = px.bar(
                    sc_df.sort_values("Outage Duration Hours", ascending=False).head(30),
                    x="Equipment",
                    y="Outage Duration Hours",
                    title="Top Scheduled Line Outages by Duration"
                )
                st.plotly_chart(fig, use_container_width=True)

            st.dataframe(sc_df, use_container_width=True)

    with outage_tabs[2]:
        rt_out_df = congestion.get("rt_line_outages", pd.DataFrame()).copy()

        if rt_out_df.empty:
            st.info("No RT line outages available.")
        else:
            date_min, date_max = get_default_date_range(rt_out_df, "Time Stamp")
            date_range = st.date_input(
                "RT line outages date range",
                value=(date_min, date_max),
                key="rt_line_outages_date_range"
            )
            if isinstance(date_range, tuple) and len(date_range) == 2:
                start_date, end_date = date_range
            else:
                start_date = date_range
                end_date = date_range

            rt_out_df = filter_by_date(rt_out_df, "Time Stamp", start_date, end_date)

            if not rt_out_df.empty and "Outage Duration Hours" in rt_out_df.columns:
                fig = px.bar(
                    rt_out_df.sort_values("Outage Duration Hours", ascending=False).head(30),
                    x="Equipment",
                    y="Outage Duration Hours",
                    title="Top RT Line Outages by Duration"
                )
                st.plotly_chart(fig, use_container_width=True)

            st.dataframe(rt_out_df, use_container_width=True)

    with outage_tabs[3]:
        outage_schedule_df = congestion.get("outage_schedule", pd.DataFrame()).copy()

        if outage_schedule_df.empty:
            st.info("No outage schedule available.")
        else:
            date_min, date_max = get_default_date_range(outage_schedule_df, "Out Start")
            date_range = st.date_input(
                "Outage schedule date range",
                value=(date_min, date_max),
                key="outage_schedule_date_range"
            )
            if isinstance(date_range, tuple) and len(date_range) == 2:
                start_date, end_date = date_range
            else:
                start_date = date_range
                end_date = date_range

            outage_schedule_df = filter_by_date(outage_schedule_df, "Out Start", start_date, end_date)

            status_options = sorted(outage_schedule_df["Status"].dropna().astype(str).unique().tolist()) if "Status" in outage_schedule_df.columns else []
            selected_status = st.multiselect(
                "Status",
                status_options,
                default=status_options,
                key="outage_schedule_status"
            )

            if selected_status:
                outage_schedule_df = outage_schedule_df[outage_schedule_df["Status"].astype(str).isin(selected_status)].copy()

            st.dataframe(outage_schedule_df, use_container_width=True)

    with outage_tabs[4]:
        zonal_uplift_df = congestion.get("zonal_uplift", pd.DataFrame()).copy()

        if zonal_uplift_df.empty:
            st.info("No zonal uplift available.")
        else:
            date_min, date_max = get_default_date_range(zonal_uplift_df, "Time Stamp")
            date_range = st.date_input(
                "Zonal uplift date range",
                value=(date_min, date_max),
                key="zonal_uplift_date_range"
            )
            if isinstance(date_range, tuple) and len(date_range) == 2:
                start_date, end_date = date_range
            else:
                start_date = date_range
                end_date = date_range

            zonal_uplift_df = filter_by_date(zonal_uplift_df, "Time Stamp", start_date, end_date)

            zone_options = sorted(zonal_uplift_df["Zone"].dropna().astype(str).unique().tolist()) if "Zone" in zonal_uplift_df.columns else []
            selected_zones = st.multiselect(
                "Zones",
                zone_options,
                default=zone_options,
                key="zonal_uplift_zones"
            )

            if selected_zones:
                zonal_uplift_df = zonal_uplift_df[zonal_uplift_df["Zone"].astype(str).isin(selected_zones)].copy()

            show_basic_metrics(zonal_uplift_df, "Zonal Uplift")

            if not zonal_uplift_df.empty and "Zonal Uplift" in zonal_uplift_df.columns:
                fig = px.line(
                    zonal_uplift_df,
                    x="Time Stamp",
                    y="Zonal Uplift",
                    color="Zone" if "Zone" in zonal_uplift_df.columns else None,
                    title="Zonal Uplift"
                )
                st.plotly_chart(fig, use_container_width=True)

                opa_df = calculate_opa(zonal_uplift_df, "Zonal Uplift", "Zone")
                st.markdown("#### OPA Summary")
                if not opa_df.empty:
                    st.dataframe(opa_df, use_container_width=True, hide_index=True)

            st.dataframe(zonal_uplift_df, use_container_width=True)

with tab_reference:
    st.subheader("Reference Tables")

    ref_tabs = st.tabs(["Active Transmission Nodes", "Load Names"])

    with ref_tabs[0]:
        nodes_df = congestion.get("active_transmission_nodes", pd.DataFrame()).copy()

        if nodes_df.empty:
            st.info("No active transmission nodes data available.")
        else:
            c1, c2 = st.columns(2)

            with c1:
                zone_options = sorted(nodes_df["Zone"].dropna().astype(str).unique().tolist()) if "Zone" in nodes_df.columns else []
                selected_zones = st.multiselect(
                    "Zone",
                    zone_options,
                    default=zone_options,
                    key="nodes_zone_filter"
                )

            with c2:
                subzone_options = sorted(nodes_df["Subzone"].dropna().astype(str).unique().tolist()) if "Subzone" in nodes_df.columns else []
                selected_subzones = st.multiselect(
                    "Subzone",
                    subzone_options,
                    default=subzone_options,
                    key="nodes_subzone_filter"
                )

            if selected_zones:
                nodes_df = nodes_df[nodes_df["Zone"].astype(str).isin(selected_zones)].copy()

            if selected_subzones:
                nodes_df = nodes_df[nodes_df["Subzone"].astype(str).isin(selected_subzones)].copy()

            search_text = st.text_input("Search node", key="nodes_search")
            if search_text:
                nodes_df = nodes_df[nodes_df["Node"].astype(str).str.contains(search_text, case=False, na=False)].copy()

            st.dataframe(nodes_df, use_container_width=True)

    with ref_tabs[1]:
        loads_df = congestion.get("load_names", pd.DataFrame()).copy()

        if loads_df.empty:
            st.info("No load names data available.")
        else:
            c1, c2 = st.columns(2)

            with c1:
                zone_options = sorted(loads_df["Zone"].dropna().astype(str).unique().tolist()) if "Zone" in loads_df.columns else []
                selected_zones = st.multiselect(
                    "Zone",
                    zone_options,
                    default=zone_options,
                    key="loads_zone_filter"
                )

            with c2:
                subzone_options = sorted(loads_df["Subzone"].dropna().astype(str).unique().tolist()) if "Subzone" in loads_df.columns else []
                selected_subzones = st.multiselect(
                    "Subzone",
                    subzone_options,
                    default=subzone_options,
                    key="loads_subzone_filter"
                )

            if selected_zones:
                loads_df = loads_df[loads_df["Zone"].astype(str).isin(selected_zones)].copy()

            if selected_subzones:
                loads_df = loads_df[loads_df["Subzone"].astype(str).isin(selected_subzones)].copy()

            search_text = st.text_input("Search load", key="loads_search")
            if search_text:
                loads_df = loads_df[loads_df["Load"].astype(str).str.contains(search_text, case=False, na=False)].copy()

            st.dataframe(loads_df, use_container_width=True)