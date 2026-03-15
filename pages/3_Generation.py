import pandas as pd
import plotly.express as px
import streamlit as st

from src.data_loader import load_generation_data
from src.nav import render_sidebar_nav

render_sidebar_nav()

st.title("Generation")

generation = load_generation_data()

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


tab_overview, tab_fuel_mix, tab_imer, tab_events = st.tabs(
    ["Overview", "Fuel Mix & Maintenance", "IMER", "Events & Commitments"]
)

with tab_overview:
    st.subheader("Overview")

    dataset_options = {
        "RT Fuel Mix": {
            "key": "rtfuelmix",
            "time_col": "Time Stamp",
            "entity_col": "Fuel Type",
            "value_options": ["Generation MW"],
            "default_value": "Generation MW",
        },
        "Generation Maintenance": {
            "key": "gen_maint_report",
            "time_col": "Date",
            "entity_col": None,
            "value_options": ["Forecasted Gen Outage MW"],
            "default_value": "Forecasted Gen Outage MW",
        },
        "Operator-Initiated Commitments": {
            "key": "op_in_commit",
            "time_col": "Event Start Time",
            "entity_col": "Resource",
            "value_options": ["MW Committed / LSL / POI Withdrawal"],
            "default_value": "MW Committed / LSL / POI Withdrawal",
        },
        "DA IMER": {
            "key": "dam_imer",
            "time_col": "Time Stamp",
            "entity_col": "Zone",
            "value_options": ["IMER CO2", "IMER NOx", "LMP", "IHR", "VOM"],
            "default_value": "IMER CO2",
        },
        "RT IMER": {
            "key": "rt_imer",
            "time_col": "Time Stamp",
            "entity_col": "Zone",
            "value_options": ["IMER CO2", "IMER NOx", "LMP", "IHR", "VOM"],
            "default_value": "IMER CO2",
        },
    }

    c1, c2, c3 = st.columns(3)

    with c1:
        dataset_label = st.selectbox("Dataset", list(dataset_options.keys()))

    cfg = dataset_options[dataset_label]
    df = generation.get(cfg["key"], pd.DataFrame()).copy()
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
                key="generation_overview_date_range"
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
                key="generation_overview_he"
            )
            filtered = filtered[filtered["HE"].isin(selected_he)].copy()

    with filter_right:
        if entity_col and entity_col in filtered.columns:
            entity_options = sorted(filtered[entity_col].dropna().astype(str).unique().tolist())
            default_entities = entity_options[:10] if len(entity_options) > 10 else entity_options
            selected_entities = st.multiselect(
                entity_col,
                entity_options,
                default=default_entities,
                key="generation_overview_entities"
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
                color=entity_col if entity_col and entity_col in filtered.columns else None,
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

with tab_fuel_mix:
    st.subheader("Fuel Mix & Maintenance")

    fuel_df = generation.get("rtfuelmix", pd.DataFrame()).copy()
    maint_df = generation.get("gen_maint_report", pd.DataFrame()).copy()
    oic_df = generation.get("op_in_commit", pd.DataFrame()).copy()

    left, right = st.columns([2, 1])

    with left:
        st.markdown("#### RT Fuel Mix")

        if fuel_df.empty:
            st.info("No RT fuel mix data available.")
        else:
            min_date, max_date = get_default_date_range(fuel_df, "Time Stamp")
            fuel_range = st.date_input(
                "Fuel mix date range",
                value=(min_date, max_date),
                key="fuel_mix_date_range"
            )

            if isinstance(fuel_range, tuple) and len(fuel_range) == 2:
                fuel_start, fuel_end = fuel_range
            else:
                fuel_start = fuel_range
                fuel_end = fuel_range

            fuel_df = filter_by_date(fuel_df, "Time Stamp", fuel_start, fuel_end)

            fuel_options = sorted(fuel_df["Fuel Type"].dropna().astype(str).unique().tolist()) if "Fuel Type" in fuel_df.columns else []
            selected_fuels = st.multiselect(
                "Fuel Types",
                fuel_options,
                default=fuel_options,
                key="fuel_mix_fuels"
            )

            if selected_fuels:
                fuel_df = fuel_df[fuel_df["Fuel Type"].astype(str).isin(selected_fuels)].copy()

            if not fuel_df.empty and "Generation MW" in fuel_df.columns:
                fig_fuel = px.area(
                    fuel_df,
                    x="Time Stamp",
                    y="Generation MW",
                    color="Fuel Type",
                    title="RT Fuel Mix"
                )
                st.plotly_chart(fig_fuel, use_container_width=True)

                opa_fuel = calculate_opa(fuel_df, "Generation MW", "Fuel Type")
                if not opa_fuel.empty:
                    fig_opa_fuel = px.bar(
                        opa_fuel,
                        x="Date",
                        y="OPA Generation MW",
                        color="Fuel Type",
                        title="OPA Fuel Mix"
                    )
                    st.plotly_chart(fig_opa_fuel, use_container_width=True)

    with right:
        st.markdown("#### Generation Maintenance")

        if maint_df.empty:
            st.info("No maintenance data available.")
        else:
            maint_min, maint_max = get_default_date_range(maint_df, "Date")
            maint_range = st.date_input(
                "Maintenance date range",
                value=(maint_min, maint_max),
                key="maint_date_range"
            )

            if isinstance(maint_range, tuple) and len(maint_range) == 2:
                maint_start, maint_end = maint_range
            else:
                maint_start = maint_range
                maint_end = maint_range

            maint_df = filter_by_date(maint_df, "Date", maint_start, maint_end)

            if not maint_df.empty and "Forecasted Gen Outage MW" in maint_df.columns:
                fig_maint = px.line(
                    maint_df,
                    x="Date",
                    y="Forecasted Gen Outage MW",
                    markers=True,
                    title="Forecasted Generation Outage MW"
                )
                st.plotly_chart(fig_maint, use_container_width=True)

                st.dataframe(maint_df, use_container_width=True)

    st.markdown("#### Operator-Initiated Commitments")

    if oic_df.empty:
        st.info("No OIC data available.")
    else:
        oic_min, oic_max = get_default_date_range(oic_df, "Event Start Time")
        oic_range = st.date_input(
            "OIC date range",
            value=(oic_min, oic_max),
            key="oic_date_range"
        )

        if isinstance(oic_range, tuple) and len(oic_range) == 2:
            oic_start, oic_end = oic_range
        else:
            oic_start = oic_range
            oic_end = oic_range

        oic_df = filter_by_date(oic_df, "Event Start Time", oic_start, oic_end)

        zone_options = sorted(oic_df["Zone"].dropna().astype(str).unique().tolist()) if "Zone" in oic_df.columns else []
        selected_zones = st.multiselect(
            "OIC Zones",
            zone_options,
            default=zone_options,
            key="oic_zones"
        )

        if selected_zones:
            oic_df = oic_df[oic_df["Zone"].astype(str).isin(selected_zones)].copy()

        if not oic_df.empty and "MW Committed / LSL / POI Withdrawal" in oic_df.columns:
            daily_oic = (
                oic_df.groupby(["Date", "Zone"], as_index=False)["MW Committed / LSL / POI Withdrawal"]
                .sum()
            )

            fig_oic = px.bar(
                daily_oic,
                x="Date",
                y="MW Committed / LSL / POI Withdrawal",
                color="Zone",
                title="Daily OIC MW by Zone"
            )
            st.plotly_chart(fig_oic, use_container_width=True)

        st.dataframe(oic_df, use_container_width=True)

with tab_imer:
    st.subheader("IMER")

    imer_options = {
        "DA IMER": "dam_imer",
        "RT IMER": "rt_imer",
    }

    c1, c2, c3 = st.columns(3)

    with c1:
        imer_label = st.selectbox("IMER Dataset", list(imer_options.keys()))

    imer_df = generation.get(imer_options[imer_label], pd.DataFrame()).copy()

    with c2:
        imer_metric = st.selectbox(
            "IMER Metric",
            ["IMER CO2", "IMER NOx", "LMP", "IHR", "VOM"]
        )

    imer_min, imer_max = get_default_date_range(imer_df, "Time Stamp")

    with c3:
        if imer_min is not None and imer_max is not None:
            imer_range = st.date_input(
                "IMER date range",
                value=(imer_min, imer_max),
                key="imer_date_range"
            )
            if isinstance(imer_range, tuple) and len(imer_range) == 2:
                imer_start, imer_end = imer_range
            else:
                imer_start = imer_range
                imer_end = imer_range
        else:
            imer_start, imer_end = None, None

    if imer_start is not None and imer_end is not None:
        imer_df = filter_by_date(imer_df, "Time Stamp", imer_start, imer_end)

    zone_options = sorted(imer_df["Zone"].dropna().astype(str).unique().tolist()) if "Zone" in imer_df.columns else []
    selected_zones = st.multiselect(
        "Zones",
        zone_options,
        default=zone_options,
        key="imer_zones"
    )

    if selected_zones:
        imer_df = imer_df[imer_df["Zone"].astype(str).isin(selected_zones)].copy()

    if "HE" in imer_df.columns:
        he_options = sorted(imer_df["HE"].dropna().unique().tolist())
        selected_he = st.multiselect(
            "HE",
            he_options,
            default=he_options,
            key="imer_he"
        )
        imer_df = imer_df[imer_df["HE"].isin(selected_he)].copy()

    show_basic_metrics(imer_df, imer_metric)

    if not imer_df.empty and imer_metric in imer_df.columns:
        fig_imer = px.line(
            imer_df,
            x="Time Stamp",
            y=imer_metric,
            color="Zone" if "Zone" in imer_df.columns else None,
            title=f"{imer_label} | {imer_metric}"
        )
        st.plotly_chart(fig_imer, use_container_width=True)

        heatmap_df = imer_df.pivot_table(
            index="Date",
            columns="HE",
            values=imer_metric,
            aggfunc="mean"
        )
        if not heatmap_df.empty:
            fig_heatmap = px.imshow(
                heatmap_df,
                aspect="auto",
                title=f"{imer_label} Heatmap | {imer_metric}",
                labels={"x": "HE", "y": "Date", "color": imer_metric}
            )
            st.plotly_chart(fig_heatmap, use_container_width=True)

        pivot_df = build_hourly_pivot(imer_df, imer_metric)
        if not pivot_df.empty:
            st.markdown("#### Hourly Pivot")
            st.dataframe(pivot_df, use_container_width=True)

        dod_zone = st.selectbox(
            "DoD Zone",
            selected_zones if selected_zones else zone_options,
            key="imer_dod_zone"
        )

        dod_df = imer_df[imer_df["Zone"] == dod_zone].copy()
        if not dod_df.empty:
            fig_dod = px.line(
                dod_df,
                x="HE",
                y=imer_metric,
                color="Date",
                markers=True,
                title=f"{dod_zone} | {imer_metric} DoD"
            )
            st.plotly_chart(fig_dod, use_container_width=True)

    st.markdown("#### Data")
    st.dataframe(imer_df, use_container_width=True)

with tab_events:
    st.subheader("Events & Commitments")

    event_tabs = st.tabs(["RT Events", "Operational Messages"])

    with event_tabs[0]:
        rt_events_df = generation.get("rt_events", pd.DataFrame()).copy()

        if rt_events_df.empty:
            st.info("No RT events data available.")
        else:
            ev_min, ev_max = get_default_date_range(rt_events_df, "Time Stamp")
            ev_range = st.date_input(
                "RT Events date range",
                value=(ev_min, ev_max),
                key="rt_events_date_range"
            )

            if isinstance(ev_range, tuple) and len(ev_range) == 2:
                ev_start, ev_end = ev_range
            else:
                ev_start = ev_range
                ev_end = ev_range

            rt_events_df = filter_by_date(rt_events_df, "Time Stamp", ev_start, ev_end)

            st.dataframe(rt_events_df, use_container_width=True)

    with event_tabs[1]:
        oper_messages_df = generation.get("oper_messages", pd.DataFrame()).copy()

        if oper_messages_df.empty:
            st.info("No operational messages available.")
        else:
            st.dataframe(oper_messages_df, use_container_width=True)