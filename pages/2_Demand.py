import pandas as pd
import plotly.express as px
import streamlit as st

from src.data_loader import load_demand_data
from src.nav import render_sidebar_nav

render_sidebar_nav()

st.title("Demand")

demand = load_demand_data()

OPA_START_HE = 7
OPA_END_HE = 22

ZONE_COLUMNS = [
    "CAPITL", "CENTRL", "DUNWOD", "GENESE", "HUD VL",
    "LONGIL", "MHK VL", "MILLWD", "N.Y.C.", "NORTH", "WEST", "NYISO"
]

BTM_DATASET_CONFIG = {
    "BTM Solar Forecast": {
        "key": "btm_da_forecast",
        "value_col": "BTM Solar Forecast MW",
        "entity_col": "Zone",
    },
    "BTM Solar Actual": {
        "key": "btm_estimated_actual",
        "value_col": "BTM Solar Actual MW",
        "entity_col": "Zone",
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


def wide_to_long_isolf(df):
    if df.empty:
        return pd.DataFrame()

    zone_cols = [col for col in ZONE_COLUMNS if col in df.columns]
    if not zone_cols:
        return pd.DataFrame()

    keep_cols = [col for col in ["Time Stamp", "Date", "HE", "Month", "Year", "source_date", "source_file"] if col in df.columns]

    long_df = df.melt(
        id_vars=keep_cols,
        value_vars=zone_cols,
        var_name="Zone",
        value_name="Forecast Load"
    )

    return long_df


def build_forecast_vs_actual(isolf_df, pal_df, selected_zones, start_date, end_date):
    if isolf_df.empty or pal_df.empty:
        return pd.DataFrame()

    forecast_long = wide_to_long_isolf(isolf_df)
    if forecast_long.empty:
        return pd.DataFrame()

    forecast_long = filter_by_date(forecast_long, "Time Stamp", start_date, end_date)
    forecast_long = forecast_long[forecast_long["Zone"].isin(selected_zones)].copy()

    actual_df = filter_by_date(pal_df, "Time Stamp", start_date, end_date)
    actual_df = actual_df[actual_df["Zone"].astype(str).isin(selected_zones)].copy()

    actual_df = actual_df.rename(columns={"Load": "Actual Load"})

    merged = forecast_long.merge(
        actual_df[["Time Stamp", "Zone", "Actual Load"]],
        on=["Time Stamp", "Zone"],
        how="inner"
    )

    if merged.empty:
        return merged

    merged["Forecast Error"] = merged["Actual Load"] - merged["Forecast Load"]

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


tab_overview, tab_forecast_vs_actual, tab_weather_solar = st.tabs(
    ["Overview", "Forecast vs Actual", "Weather & Solar"]
)

with tab_overview:
    st.subheader("Overview")

    overview_options = {
        "Actual Load": {
            "key": "pal",
            "entity_col": "Zone",
            "value_col": "Load",
        },
        "Integrated Actual Load": {
            "key": "pal_integrated",
            "entity_col": "Zone",
            "value_col": "Integrated Load",
        },
        "ISO Load Forecast": {
            "key": "isolf",
            "entity_col": None,
            "value_col": "NYISO",
        },
    }

    top1, top2, top3 = st.columns(3)

    with top1:
        dataset_label = st.selectbox("Dataset", list(overview_options.keys()))

    cfg = overview_options[dataset_label]
    dataset_key = cfg["key"]
    entity_col = cfg["entity_col"]
    value_col = cfg["value_col"]
    df = demand.get(dataset_key, pd.DataFrame()).copy()

    time_col = "Time Stamp"
    min_date, max_date = get_default_date_range(df, time_col)

    with top2:
        if min_date is not None and max_date is not None:
            date_range = st.date_input(
                "Date range",
                value=(min_date, max_date),
                key="demand_overview_date_range"
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

    with top3:
        if entity_col and entity_col in filtered.columns:
            entity_options = sorted(filtered[entity_col].dropna().astype(str).unique().tolist())
            selected_entities = st.multiselect(
                entity_col,
                entity_options,
                default=entity_options,
                key="demand_overview_entities"
            )
            filtered = filtered[filtered[entity_col].astype(str).isin(selected_entities)].copy()
        elif dataset_key == "isolf":
            zone_options = [col for col in ZONE_COLUMNS if col in filtered.columns]
            selected_entities = st.multiselect(
                "Forecast Zones",
                zone_options,
                default=["NYISO"] if "NYISO" in zone_options else zone_options[:3],
                key="demand_forecast_zones"
            )
        else:
            selected_entities = []

    if "HE" in filtered.columns:
        he_options = sorted(filtered["HE"].dropna().unique().tolist())
        selected_he = st.multiselect(
            "HE",
            he_options,
            default=he_options,
            key="demand_overview_he"
        )
        filtered = filtered[filtered["HE"].isin(selected_he)].copy()

    metric1, metric2, metric3, metric4 = st.columns(4)

    if dataset_key in ["pal", "pal_integrated"] and not filtered.empty and value_col in filtered.columns:
        series = pd.to_numeric(filtered[value_col], errors="coerce").dropna()
        metric1.metric(f"Avg {value_col}", format_metric(series.mean()))
        metric2.metric(f"Max {value_col}", format_metric(series.max()))
        metric3.metric(f"Min {value_col}", format_metric(series.min()))
        metric4.metric("Rows", f"{len(filtered):,}")

    elif dataset_key == "isolf" and not filtered.empty and selected_entities:
        available_cols = [col for col in selected_entities if col in filtered.columns]
        if available_cols:
            nyiso_series = pd.to_numeric(filtered[available_cols[0]], errors="coerce").dropna()
            metric1.metric(f"Avg {available_cols[0]}", format_metric(nyiso_series.mean()))
            metric2.metric(f"Max {available_cols[0]}", format_metric(nyiso_series.max()))
            metric3.metric(f"Min {available_cols[0]}", format_metric(nyiso_series.min()))
            metric4.metric("Rows", f"{len(filtered):,}")
        else:
            metric1.metric("Avg", "-")
            metric2.metric("Max", "-")
            metric3.metric("Min", "-")
            metric4.metric("Rows", "0")
    else:
        metric1.metric("Avg", "-")
        metric2.metric("Max", "-")
        metric3.metric("Min", "-")
        metric4.metric("Rows", "0")

    left, right = st.columns([2, 1])

    with left:
        if dataset_key in ["pal", "pal_integrated"] and not filtered.empty and value_col in filtered.columns:
            fig = px.line(
                filtered,
                x="Time Stamp",
                y=value_col,
                color=entity_col if entity_col in filtered.columns else None,
                title=f"{dataset_label} | {value_col}"
            )
            st.plotly_chart(fig, use_container_width=True)

        elif dataset_key == "isolf" and not filtered.empty and selected_entities:
            long_forecast = filtered.melt(
                id_vars=[col for col in ["Time Stamp", "Date", "HE", "Month", "Year"] if col in filtered.columns],
                value_vars=[col for col in selected_entities if col in filtered.columns],
                var_name="Zone",
                value_name="Forecast Load"
            )

            fig = px.line(
                long_forecast,
                x="Time Stamp",
                y="Forecast Load",
                color="Zone",
                title="ISO Load Forecast"
            )
            st.plotly_chart(fig, use_container_width=True)
        else:
            st.info("No data available for chart.")

    with right:
        st.markdown("#### OPA Summary")

        if dataset_key in ["pal", "pal_integrated"]:
            opa_df = calculate_opa(filtered, value_col, entity_col)
        elif dataset_key == "isolf" and selected_entities:
            long_forecast = filtered.melt(
                id_vars=[col for col in ["Time Stamp", "Date", "HE", "Month", "Year"] if col in filtered.columns],
                value_vars=[col for col in selected_entities if col in filtered.columns],
                var_name="Zone",
                value_name="Forecast Load"
            )
            opa_df = calculate_opa(long_forecast, "Forecast Load", "Zone")
        else:
            opa_df = pd.DataFrame()

        if not opa_df.empty:
            st.dataframe(opa_df, use_container_width=True, hide_index=True)
        else:
            st.info("No OPA data available.")

    if dataset_key in ["pal", "pal_integrated"] and not filtered.empty and "Date" in filtered.columns and "HE" in filtered.columns:
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
                title=f"{dataset_label} Heatmap",
                labels={"x": "HE", "y": "Date", "color": value_col}
            )
            st.plotly_chart(fig_heatmap, use_container_width=True)

    st.markdown("#### Data")
    st.dataframe(filtered, use_container_width=True)

with tab_forecast_vs_actual:
    st.subheader("Forecast vs Actual")

    isolf_df = demand.get("isolf", pd.DataFrame()).copy()
    pal_df = demand.get("pal", pd.DataFrame()).copy()

    if isolf_df.empty or pal_df.empty:
        st.info("ISO Load Forecast and Actual Load processed files are required.")
    else:
        c1, c2, c3 = st.columns(3)

        compare_min_date, compare_max_date = get_default_date_range(isolf_df, "Time Stamp")

        with c1:
            compare_range = st.date_input(
                "Date range",
                value=(compare_min_date, compare_max_date),
                key="forecast_actual_date_range"
            )
            if isinstance(compare_range, tuple) and len(compare_range) == 2:
                compare_start, compare_end = compare_range
            else:
                compare_start = compare_range
                compare_end = compare_range

        with c2:
            zone_options = [col for col in ZONE_COLUMNS if col != "NYISO" and col in isolf_df.columns]
            selected_zones = st.multiselect(
                "Zones",
                zone_options,
                default=zone_options[:4],
                key="forecast_actual_zones"
            )

        with c3:
            compare_metric = st.selectbox(
                "Metric",
                ["Forecast Load", "Actual Load", "Forecast Error"],
                key="forecast_actual_metric"
            )

        compare_df = build_forecast_vs_actual(
            isolf_df,
            pal_df,
            selected_zones,
            compare_start,
            compare_end
        )

        if compare_df.empty:
            st.info("No overlapping forecast vs actual data for the selected filters.")
        else:
            metric1, metric2, metric3, metric4 = st.columns(4)
            series = pd.to_numeric(compare_df[compare_metric], errors="coerce").dropna()

            metric1.metric(f"Avg {compare_metric}", format_metric(series.mean()))
            metric2.metric(f"Max {compare_metric}", format_metric(series.max()))
            metric3.metric(f"Min {compare_metric}", format_metric(series.min()))
            metric4.metric("Rows", f"{len(compare_df):,}")

            left, right = st.columns([2, 1])

            with left:
                fig = px.line(
                    compare_df,
                    x="Time Stamp",
                    y=compare_metric,
                    color="Zone",
                    title=f"Forecast vs Actual | {compare_metric}"
                )
                st.plotly_chart(fig, use_container_width=True)

            with right:
                st.markdown("#### OPA Summary")
                opa_compare = calculate_opa(compare_df, compare_metric, "Zone")
                if not opa_compare.empty:
                    st.dataframe(opa_compare, use_container_width=True, hide_index=True)
                else:
                    st.info("No OPA data available.")

            st.markdown("#### Hourly Pivot")
            pivot_df = build_hourly_pivot(compare_df, compare_metric)
            if not pivot_df.empty:
                st.dataframe(pivot_df, use_container_width=True)
            else:
                st.info("No pivot data available.")

            dod_zone = st.selectbox(
                "DoD Zone",
                selected_zones,
                key="forecast_actual_dod_zone"
            )

            dod_df = compare_df[compare_df["Zone"] == dod_zone].copy()
            if not dod_df.empty:
                fig_dod = px.line(
                    dod_df,
                    x="HE",
                    y=compare_metric,
                    color="Date",
                    markers=True,
                    title=f"{dod_zone} | {compare_metric} DoD"
                )
                st.plotly_chart(fig_dod, use_container_width=True)

            st.markdown("#### Data")
            st.dataframe(compare_df, use_container_width=True)

with tab_weather_solar:
    st.subheader("Weather & Solar")

    c1, c2 = st.columns(2)

    with c1:
        st.markdown("#### Weather Forecast")

        weather_df = demand.get("lfweather", pd.DataFrame()).copy()

        if weather_df.empty:
            st.info("No weather forecast data available.")
        else:
            weather_min_date, weather_max_date = get_default_date_range(weather_df, "Forecast Date")

            weather_range = st.date_input(
                "Weather date range",
                value=(weather_min_date, weather_max_date),
                key="weather_date_range"
            )
            if isinstance(weather_range, tuple) and len(weather_range) == 2:
                weather_start, weather_end = weather_range
            else:
                weather_start = weather_range
                weather_end = weather_range

            weather_df = filter_by_date(weather_df, "Forecast Date", weather_start, weather_end)

            station_options = sorted(weather_df["Station"].dropna().astype(str).unique().tolist()) if "Station" in weather_df.columns else []
            selected_stations = st.multiselect(
                "Stations",
                station_options,
                default=station_options[:3] if len(station_options) >= 3 else station_options,
                key="weather_stations"
            )

            if selected_stations:
                weather_df = weather_df[weather_df["Station"].astype(str).isin(selected_stations)].copy()

            weather_metric = st.selectbox(
                "Weather Metric",
                [col for col in ["Avg Temp", "Max Temp", "Min Temp", "Avg Wet Bulb"] if col in weather_df.columns],
                key="weather_metric"
            )

            if not weather_df.empty and weather_metric in weather_df.columns:
                fig_weather = px.line(
                    weather_df,
                    x="Forecast Date",
                    y=weather_metric,
                    color="Station" if "Station" in weather_df.columns else None,
                    title=f"Weather | {weather_metric}"
                )
                st.plotly_chart(fig_weather, use_container_width=True)
                st.dataframe(weather_df, use_container_width=True)
            else:
                st.info("No weather data available for chart.")

    with c2:
        st.markdown("#### BTM Solar")

        solar_label = st.selectbox("Solar Dataset", list(BTM_DATASET_CONFIG.keys()))
        solar_cfg = BTM_DATASET_CONFIG[solar_label]
        solar_df = demand.get(solar_cfg["key"], pd.DataFrame()).copy()
        solar_value_col = solar_cfg["value_col"]
        solar_entity_col = solar_cfg["entity_col"]

        if solar_df.empty:
            st.info("No BTM solar data available.")
        else:
            solar_min_date, solar_max_date = get_default_date_range(solar_df, "Time Stamp")

            solar_range = st.date_input(
                "Solar date range",
                value=(solar_min_date, solar_max_date),
                key="solar_date_range"
            )
            if isinstance(solar_range, tuple) and len(solar_range) == 2:
                solar_start, solar_end = solar_range
            else:
                solar_start = solar_range
                solar_end = solar_range

            solar_df = filter_by_date(solar_df, "Time Stamp", solar_start, solar_end)

            zone_options = sorted(solar_df[solar_entity_col].dropna().astype(str).unique().tolist())
            selected_zones = st.multiselect(
                "Solar Zones",
                zone_options,
                default=zone_options,
                key="solar_zones"
            )

            solar_df = solar_df[solar_df[solar_entity_col].astype(str).isin(selected_zones)].copy()

            if "HE" in solar_df.columns:
                he_options = sorted(solar_df["HE"].dropna().unique().tolist())
                selected_he = st.multiselect(
                    "Solar HE",
                    he_options,
                    default=he_options,
                    key="solar_he"
                )
                solar_df = solar_df[solar_df["HE"].isin(selected_he)].copy()

            if not solar_df.empty and solar_value_col in solar_df.columns:
                fig_solar = px.line(
                    solar_df,
                    x="Time Stamp",
                    y=solar_value_col,
                    color=solar_entity_col,
                    title=solar_label
                )
                st.plotly_chart(fig_solar, use_container_width=True)

                solar_opa = calculate_opa(solar_df, solar_value_col, solar_entity_col)
                st.markdown("##### OPA Summary")
                if not solar_opa.empty:
                    st.dataframe(solar_opa, use_container_width=True, hide_index=True)

                st.dataframe(solar_df, use_container_width=True)
            else:
                st.info("No solar data available for chart.")