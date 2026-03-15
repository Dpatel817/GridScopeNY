import io
from datetime import date, datetime, timedelta

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import requests
import streamlit as st
from plotly.subplots import make_subplots

api_key = "c4ac48298a3c4751be7851b9571855af"
storm_vistra_api_key = "8e13ebe846737079d4054b1f9328d96a"


# <editor-fold desc="API/Scraper Functions">
@st.cache_data
def pull_data(api_key, sids, start_date, end_date, interval):
    import requests
    import pandas as pd
    import time

    api_url = "https://api.genscape.com/power/epcalc/v1/getepcalcsiddata"

    # allow dict -> friendly column names
    id_to_name = None
    if isinstance(sids, dict):
        id_to_name = {v: k for k, v in sids.items()}
        sids_list = list(sids.values())
    elif isinstance(sids, (list, tuple, set)):
        sids_list = list(sids)
    else:
        sids_list = [sids]

    headers = {"Gen-Api-Key": api_key}

    # ---- NEW: chunk pulling w/ exponential backoff between pulls ----
    all_rows = []
    chunk_size = 20
    base_delay = 2  # seconds: 2, 4, 8, 16, ...
    max_delay = 60  # optional cap so delays don't explode

    num_chunks = (len(sids_list) + chunk_size - 1) // chunk_size

    for chunk_idx in range(num_chunks):
        chunk = sids_list[chunk_idx * chunk_size: (chunk_idx + 1) * chunk_size]
        sids_param = ",".join(map(str, chunk))

        params = {
            "sids": sids_param,
            "start_date": start_date,  # local calendar dates
            "end_date": end_date,  # local calendar dates
            "interval": interval,  # e.g. "H"
            "standard_time": 1,  # LOCAL time (HE 0â€“23 in local zone)
            "orientation": "records",
            "limit": 5000,
        }

        r = requests.get(api_url, params=params, headers=headers, timeout=60)
        r.raise_for_status()
        payload = r.json()

        # unwrap {"data": [...]} if present
        if isinstance(payload, dict) and "data" in payload:
            payload = payload["data"]

        if isinstance(payload, list):
            all_rows.extend(payload)

        # exponential delay BETWEEN pulls (skip after last chunk)
        if chunk_idx < num_chunks - 1:
            delay = min(base_delay * (2 ** chunk_idx), max_delay)  # 2,4,8,...
            time.sleep(delay)
    # ---------------------------------------------------------------

    df = pd.json_normalize(all_rows)

    # normalize expected columns
    rename_map = {
        "sid": "SensorID",
        "timestamp": "date",
        "time": "date",
        "datetime": "date",
        "value": "Value",
    }
    for src, dst in rename_map.items():
        if src in df.columns and dst not in df.columns:
            df.rename(columns={src: dst}, inplace=True)

    # if no date column, return empty with expected structure
    if "date" not in df.columns:
        return pd.DataFrame(columns=["Date", "HE"])

    # parse datetime
    df["date"] = pd.to_datetime(df["date"], errors="coerce")

    # If timestamps are tz-aware (e.g. UTC), convert to ET and drop tz.
    # If they are naive, treat them as local wall-clock time (no tz_localize)
    if getattr(df["date"].dtype, "tz", None) is not None:
        df["date"] = (
            df["date"]
            .dt.tz_convert("America/New_York")
            .dt.tz_localize(None)
        )

    # set index for time slicing
    df = df.set_index("date").sort_index()

    # strict local-day slice: [start, end + 1 day) using naive timestamps
    start_ts = pd.Timestamp(start_date)
    end_ts = pd.Timestamp(end_date) + pd.Timedelta(days=1)
    df = df.loc[(df.index >= start_ts) & (df.index < end_ts)]

    # shape to wide
    if id_to_name is not None and {"SensorID", "Value"} <= set(df.columns):
        # map SensorID -> friendly name, then pivot
        df["name"] = df["SensorID"].map(id_to_name)
        df = df.pivot_table(
            index=df.index,
            columns="name",
            values="Value",
            aggfunc="first"
        )
    elif "SensorID" in df.columns and "Value" in df.columns:
        # if multiple SIDs without friendly names, use SensorID as columns
        if df["SensorID"].nunique() > 1:
            df = df.pivot_table(
                index=df.index,
                columns="SensorID",
                values="Value",
                aggfunc="first"
            )
        else:
            # single SID without a friendly name -> make a single value column
            sid = int(df["SensorID"].iloc[0])
            df = df[["Value"]].rename(columns={"Value": f"SID {sid}"})

    # tidy up column index name
    try:
        df.columns.name = None
    except Exception:
        pass

    # add HE and Date (YYYY-MM-DD string)
    he = df.index.hour.astype(int)
    date_str = df.index.strftime("%Y-%m-%d")  # local date only (naive)

    df_out = df.copy()
    df_out.insert(0, "Date", date_str)
    df_out.insert(1, "HE", he)

    return df_out.reset_index(drop=True)


@st.cache_data
def pull_ontario_wind_forecast_df(api_key, start, end, cycle="00z"):
    # Pre-processing
    region = "ieso"
    models = ["ecmwf", "mlr15", "mlr45"]
    run_date_str = datetime.today().strftime("%Y%m%d")
    base_url = "https://api.stormvistawxmodels.com/v1/model-data"

    results = []

    for model_name in models:
        url = (
            f"{base_url}/{model_name}/{run_date_str}/{cycle}/renewables/"
            f"{region}-windgen-forecast-hourly.csv?apikey={api_key}"
        )

        try:
            df_raw = pd.read_csv(url)

            # Same logic as your script
            df_t = df_raw.iloc[:, 1:].T
            series = df_t.mean(axis=1)
            series.name = model_name.upper()

            results.append(series)

        except Exception as e:
            print(f"Warning: Could not fetch {model_name} ({e})")

    if not results:
        return pd.DataFrame()

    df = pd.concat(results, axis=1)

    # Timezone & HE Processing
    start_utc = datetime.strptime(run_date_str, "%Y%m%d")
    timestamps_utc = [start_utc + timedelta(hours=i) for i in range(len(df))]
    df.index = pd.to_datetime(timestamps_utc).tz_localize("UTC")
    df = df.tz_convert("US/Eastern")

    # Combined Average
    model_cols = df.columns.tolist()
    df["Combined_Avg"] = df[model_cols].mean(axis=1)

    # Match your app format
    df = df.reset_index().rename(columns={"index": "Timestamp"})
    df["Date"] = pd.to_datetime(df["Timestamp"]).dt.date

    # IMPORTANT: match pull_data HE convention (0-23)
    df["HE"] = pd.to_datetime(df["Timestamp"]).dt.hour

    # Filter to selected range
    start_date = pd.to_datetime(start).date()
    end_date = pd.to_datetime(end).date()
    df = df[(df["Date"] >= start_date) & (df["Date"] <= end_date)]

    return df


@st.cache_data
def ttcf_scrape(date):
    date_str = date.strftime('%Y%m%d')
    ttcf_url = f"https://mis.nyiso.com/public/csv/ttcf/{date_str}ttcf.csv"
    response = requests.get(ttcf_url, verify=False)

    if response.status_code == 404:
        return st.write("No TTCF Data Available")
    else:
        df = pd.read_csv(io.StringIO(response.text))
        df = df.rename(columns={
            "RTSA FACILITY NAME": "Derate Reason/Actual Limit",
            "DATE_OUT": "Date Out",
            "TIME_OU": "Time Out",
            "DATE_IN": "Date In",
            "TIME_IN": "Time In",
            "CALLED_IN_": "Work Scheduled By",
            "CANCELLATI": "Cancellation Type",
            "mod mess": "Updated By",
            "CANCELLATI2": "Update Date",
            "EXPORT PATH NAME": "Interface Name",
            "FWD - Total Transfer Cap": "Revised Import TTC",
            "FWD - TTC transfer impact": "Import TTC Impact",
            "FWD - TTC ALL I/S": "Base Impoort TTC",
            "REV - Total Transfer Cap": "Revised Export TTC",
            "REV - TTC transfer impact": "Export TTC Impact",
            "REV - TTC ALL I/S": "Base Export TTC",
        })
        df = df.drop(columns={
            "ATI",
            "PTID",
            "ARR"
        })
        mapping = {
            "SCH - PJ - NY": "PJM AC",
            "SCH - PJM_HTP": "PJM HTP",
            "SCH - PJM_NEPTUNE": "PJM Neptune",
            "SCH - PJM_VFT": "PJM VFT",

            "SCH - OH - NY": "IMO AC",

            "SCH - HQ - NY": "HQ AC",
            "SCH - HQ_CEDARS": "HQ Cedars",

            "SCH - NE - NY": "NE AC",
            "SCH - NPX_1385": "1385",
            "SCH - NPX_CSC": "CSC",
            "SCH - HQ_CHPE": "CHPE",

            "CENTRAL EAST - VC": "Central East",
            "MOSES SOUTH": "Moses South",
            "SPR/DUN-SOUTH": "Sprainbrook/Dunwoodie",
            "DYSINGER EAST": "Dysinger East",
            "UPNY CONED": "UPNY-ConED",
            "WEST CENTRAL": "West Central",
            "CONED - LIPA": "ConED LIPA",
            "TOTAL EAST": "Total East",
            "STATEN ISLAND": "Staten Island"

        }
        df['Interface Name'] = df['Interface Name'].map(mapping)
        df["Date Out"] = pd.to_datetime(df["Date Out"]).dt.strftime('%m/%d/%Y')
        df["Date In"] = pd.to_datetime(df["Date In"]).dt.strftime('%m/%d/%Y')
        return df


@st.cache_data
def oic_scrape(date):
    date_str = date.strftime('%Y%m%d')
    oic_url = f"https://mis.nyiso.com/public/csv/OpInCommit/{date_str}OpInCommit.csv"
    response = requests.get(oic_url, verify=False)

    if response.status_code == 404:
        return 404
    else:
        df = pd.read_csv(io.StringIO(response.text))
        df = df.rename(columns={})
        df = df.drop(columns={" PTID"})
        return df


@st.cache_data
def outage_schedule_scrape():
    outage_schedule_url = "https://mis.nyiso.com/public/csv/os/outage-schedule.csv"

    import requests
    import io

    response = requests.get(outage_schedule_url, verify=False)

    if response.status_code == 404:
        return 404
    else:
        df = pd.read_csv(io.StringIO(response.text))

        # Pre-processing
        out_df = df.copy()

        # Filter to only LINE / TRANSFORMER
        out_df = out_df[out_df["Equipment Type"].isin(["LINE", "TRANSFORMER"])].copy()

        out_df["Outage Label"] = out_df["Equipment Name"] + " (" + out_df["Outage ID"] + ")"

        out_df["Start Date"] = pd.to_datetime(out_df["Date Out"])
        out_df["Start Time"] = pd.to_datetime(out_df["Time Out"])

        out_df["End Date"] = pd.to_datetime(out_df["Date In"])
        out_df["End Time"] = pd.to_datetime(out_df["Time In"])

        out_df["Outage Start"] = pd.to_datetime(
            out_df["Start Date"].dt.strftime("%Y-%m-%d") + " " + out_df["Start Time"].dt.strftime("%H:%M")
        )
        out_df["Outage End"] = pd.to_datetime(
            out_df["End Date"].dt.strftime("%Y-%m-%d") + " " + out_df["End Time"].dt.strftime("%H:%M")
        )

        def format_outage_dt(x):
            if pd.isna(x):
                return ""
            return f"{x.month}/{x.day}/{x.year} {x.hour}:{x.minute:02d}"

        out_df["Outage Duration"] = (
                out_df["Outage Start"].apply(format_outage_dt)
                + " - "
                + out_df["Outage End"].apply(format_outage_dt)
        )

        # Keep dates as real datetime values so sorting works
        out_df["Start Date"] = out_df["Start Date"].dt.normalize()
        out_df["End Date"] = out_df["End Date"].dt.normalize()

        # Format times for display
        out_df["Start Time"] = out_df["Start Time"].dt.strftime("%H:%M")
        out_df["End Time"] = out_df["End Time"].dt.strftime("%H:%M")

        # If your source columns have different names, rename them here
        out_df = out_df.rename(columns={
            "CALLED_IN_": "Called In",
            "CANCELLATI": "Status",
            "CANCELLATI2": "Status Date",
            "mod mess": "Message",
        })

        # Create final outage dataframe
        outage_df = out_df[[
            "Equipment Type",
            "Outage Label",
            "Start Date",
            "Start Time",
            "End Date",
            "End Time",
            "Outage Duration",
            "Called In",
            "Status",
            "Status Date",
            "Message",
        ]].copy()

        return outage_df


@st.cache_data
def da_outages_scrape(date):
    date_str = date.strftime('%Y%m%d')
    da_outages_url = f"https://mis.nyiso.com/public/csv/outSched/{date_str}outSched.csv"
    response = requests.get(da_outages_url, verify=False)
    if response.status_code == 404:
        return 404
    else:
        df = pd.read_csv(io.StringIO(response.text))
        df = df.rename(columns={})
        df = df.drop(columns={})
        return df


@st.cache_data
def rt_outages_scrape(date):
    date_str = date.strftime('%Y%m%d')
    rt_outages_url = f"https://mis.nyiso.com/public/csv/realtimelineoutages/{date_str}RTLineOutages.csv"
    response = requests.get(rt_outages_url, verify=False)
    if response.status_code == 404:
        return 404
    else:
        df = pd.read_csv(io.StringIO(response.text))
        df = df.rename(columns={})
        df = df.drop(columns={})
        return df


@st.cache_data
def dam_congestion_scrape(date):
    date_str = date.strftime('%Y%m%d')
    dam_congestion_url = f"https://mis.nyiso.com/public/csv/DAMLimitingConstraints/{date_str}DAMLimitingConstraints.csv"
    response = requests.get(dam_congestion_url, verify=False)
    if response.status_code == 404:
        return 404
    else:
        df = pd.read_csv(io.StringIO(response.text))
        df = df.rename(columns={})
        df = df.drop(columns={})
        return df


@st.cache_data
def dam_zonal_lmps_scrape(date):
    date_str = date.strftime('%Y%m%d')
    dam_congestion_url = f"https://mis.nyiso.com/public/csv/damlbmp/{date_str}damlbmp_zone.csv"
    response = requests.get(dam_congestion_url, verify=False)
    if response.status_code == 404:
        return 404
    else:
        df = pd.read_csv(io.StringIO(response.text))
        df["Time Stamp"] = pd.to_datetime(df["Time Stamp"])
        df["Date"] = df["Time Stamp"]
        df["HE"] = df["Date"].dt.hour
        df = df.rename(columns={
            "Name": "Zone",
            "LBMP ($/MWHr)": "LMP",
            "Marginal Cost Losses ($/MWHr)": "MLC",
            "Marginal Cost Congestion ($/MWHr)": "MCC"
        })
        df = df.drop(columns={"PTID", "Time Stamp"})
        return df


@st.cache_data
def dam_gen_lmps_scrape(date):
    date_str = date.strftime('%Y%m%d')
    dam_congestion_url = f"https://mis.nyiso.com/public/csv/damlbmp/{date_str}damlbmp_gen.csv"
    response = requests.get(dam_congestion_url, verify=False)
    if response.status_code == 404:
        return 404
    else:
        df = pd.read_csv(io.StringIO(response.text))
        df["Time Stamp"] = pd.to_datetime(df["Time Stamp"])
        df["Date"] = df["Time Stamp"]
        df["HE"] = df["Date"].dt.hour
        df = df.rename(columns={
            "Name": "Generator",
            "LBMP ($/MWHr)": "LMP",
            "Marginal Cost Losses ($/MWHr)": "MLC",
            "Marginal Cost Congestion ($/MWHr)": "MCC"
        })
        df = df.drop(columns={"PTID", "Time Stamp"})
        return df


@st.cache_data
def rtm_congestion_scrape(date):
    date_str = date.strftime('%Y%m%d')
    rtm_congestion_url = f"https://mis.nyiso.com/public/csv/LimitingConstraints/{date_str}LimitingConstraints.csv"
    response = requests.get(rtm_congestion_url, verify=False)
    if response.status_code == 404:
        return 404
    else:
        df = pd.read_csv(io.StringIO(response.text))
        df = df.rename(columns={})
        df = df.drop(columns={})
        return df


@st.cache_data
def rtm_zonal_lmps_scrape(date):
    date_str = date.strftime('%Y%m%d')
    dam_congestion_url = f"https://mis.nyiso.com/public/csv/realtime/{date_str}3realtime_zone.csv"
    response = requests.get(dam_congestion_url, verify=False)
    if response.status_code == 404:
        return 404
    else:
        df = pd.read_csv(io.StringIO(response.text))
        df["Time Stamp"] = pd.to_datetime(df["Time Stamp"])
        df["Date"] = df["Time Stamp"]
        df["HE"] = df["Date"].dt.hour
        df = df.rename(columns={
            "Name": "Zone",
            "LBMP ($/MWHr)": "LMP",
            "Marginal Cost Losses ($/MWHr)": "MLC",
            "Marginal Cost Congestion ($/MWHr)": "MCC"
        })
        df = df.drop(columns={"PTID", "Time Stamp"})
        return df


@st.cache_data
def rtm_gen_lmps_scrape(date):
    date_str = date.strftime('%Y%m%d')
    dam_congestion_url = f"https://mis.nyiso.com/public/csv/realtime/{date_str}realtime_gen.csv"
    response = requests.get(dam_congestion_url, verify=False)
    if response.status_code == 404:
        return 404
    else:
        df = pd.read_csv(io.StringIO(response.text))
        df["Time Stamp"] = pd.to_datetime(df["Time Stamp"])
        df["Date"] = df["Time Stamp"]
        df["HE"] = df["Date"].dt.hour
        df = df.rename(columns={
            "Name": "Generator",
            "LBMP ($/MWHr)": "LMP",
            "Marginal Cost Losses ($/MWHr)": "MLC",
            "Marginal Cost Congestion ($/MWHr)": "MCC"
        })
        df = df.drop(columns={"PTID", "Time Stamp"})
        return df


@st.cache_resource
def flow_to_ttc_name(flow_name, ttc_type):
    if " DA Flows" in flow_name:
        base = flow_name.replace(" DA Flows", "")
        return f"{base} {ttc_type} DA TTC"
    else:
        base = flow_name.replace(" RT Flows", "")
        return f"{base} {ttc_type} RT TTC"


def render_natgas_notices_dashboard(api_key, key_prefix="natgas_notices"):
    import streamlit as st
    import pandas as pd
    import requests

    BASE_URL = "https://api.genscape.com/natgas/events"

    # Pipeline metadata (from your provided JSON)
    PIPELINE_META = {
        252: {"pipelineName": "Algonquin", "pipelineLongName": "Algonquin Gas Transmission, LLC"},
        368: {"pipelineName": "Iroquois", "pipelineLongName": "Iroquois Gas Transmission System, LP"},
        440: {"pipelineName": "Sabine", "pipelineLongName": "Sabine Pl"},
        449: {"pipelineName": "SG Resources", "pipelineLongName": "SG Resources Mississippi, L.L.C."},
        461: {"pipelineName": "TGP", "pipelineLongName": "Tennessee Gas Pipeline"},
        462: {"pipelineName": "TETCO", "pipelineLongName": "Texas Eastern Transmission Co"},
        467: {"pipelineName": "Transco", "pipelineLongName": "Transcontinental Gas Pipe Line Corporation"},
    }

    PIPELINE_OPTIONS = {
        f"{v['pipelineName']} ({pid})": pid for pid, v in PIPELINE_META.items()
    }

    @st.cache_data(show_spinner=False)
    def _pull_natgas_notice_details_single_pipeline(
        api_key, pipeline_id, top_n=20, limit=25, offset=0, sort="insertDate:desc"
    ):
        """
        Pull preview notices + details for ONE pipeline ID and return cleaned dataframe.
        """
        headers = {"Gen-Api-Key": api_key, "Accept": "application/json"}
        s = requests.Session()

        # 1) Preview notices
        notices_url = f"{BASE_URL}/v1/notices"
        notices_params = {
            "pipelineIds": [int(pipeline_id)],
            "limit": int(limit),
            "offset": int(offset),
            "sort": sort,
            "format": "json",
        }

        r = s.get(notices_url, headers=headers, params=notices_params, timeout=30)
        r.raise_for_status()

        payload = r.json()
        notices_rows = payload.get("data", payload)
        if isinstance(notices_rows, dict):
            notices_rows = [notices_rows]

        notices = pd.DataFrame(notices_rows)

        if notices.empty or "id" not in notices.columns:
            return pd.DataFrame()

        # 2) Details pull
        notice_ids = notices["id"].head(top_n).tolist()
        if not notice_ids:
            return pd.DataFrame()

        details_url = f"{BASE_URL}/v1/notices/details"
        details_params = {"ids": notice_ids, "format": "json"}

        r = s.get(details_url, headers=headers, params=details_params, timeout=30)
        r.raise_for_status()

        payload = r.json()
        details_rows = payload.get("data", payload)
        if isinstance(details_rows, dict):
            details_rows = [details_rows]

        details = pd.DataFrame(details_rows)
        if details.empty:
            return pd.DataFrame()

        # 3) Preprocessing / formatting
        for col in ["postDate", "effDate", "endDate", "insertDate"]:
            if col in details.columns:
                details[col] = pd.to_datetime(details[col], errors="coerce")

        # Drop noisy ids (keep pipelineName)
        drop_cols = ["id", "priorNoticeIdentifierId", "noticeIdentifierId"]
        drop_cols = [c for c in drop_cols if c in details.columns]
        details = details.drop(columns=drop_cols)

        details = details.rename(columns={
            "pipelineId": "Pipeline ID",
            "pipelineName": "Pipeline Name",
            "priority": "Priority",
            "type": "Type",
            "status": "Status",
            "subject": "Subject of Notice",
            "body": "Body",
            "postDate": "Post Date",
            "effDate": "Effective Date",
            "endDate": "End Date",
            "insertDate": "Insert Date",
        })

        # Readable timestamps for display
        for dt_col in ["Post Date", "Effective Date", "End Date", "Insert Date"]:
            if dt_col in details.columns:
                details[f"{dt_col} (fmt)"] = details[dt_col].dt.strftime("%m/%d/%Y %H:%M")

        # Clean body text
        if "Body" in details.columns:
            details["Body"] = (
                details["Body"]
                .fillna("")
                .astype(str)
                .str.replace("\\\\n", "\n", regex=False)
                .str.replace("\\n", "\n", regex=False)
                .str.replace("\\\\t", "\t", regex=False)
                .str.replace("\\t", "\t", regex=False)
                .str.replace("\\\\'", "'", regex=False)
                .str.replace("\\'", "'", regex=False)
                .str.replace('\\"', '"', regex=False)
                .str.replace("BackPrint", "", regex=False)
                .str.replace("\n\n\n+", "\n\n", regex=True)
                .str.strip()
            )

        # Add explicit selected pipeline metadata (useful if API response omits anything)
        details["Selected Pipeline ID"] = int(pipeline_id)
        details["Selected Pipeline"] = PIPELINE_META.get(int(pipeline_id), {}).get("pipelineName", str(pipeline_id))

        # Column order (display-first)
        preferred_cols = [
            "Selected Pipeline",
            "Selected Pipeline ID",
            "Pipeline Name",
            "Pipeline ID",
            "Priority",
            "Type",
            "Status",
            "Subject of Notice",
            "Post Date (fmt)",
            "Effective Date (fmt)",
            "End Date (fmt)",
            "Insert Date (fmt)",
            "Body",
        ]
        existing_preferred = [c for c in preferred_cols if c in details.columns]
        remaining = [c for c in details.columns if c not in existing_preferred]
        details = details[existing_preferred + remaining]

        return details

    st.subheader("Natural Gas Pipeline Notices")
    st.markdown("Pull and view latest notice details by selected pipeline.")

    # Controls
    selected_labels = st.multiselect(
        "Select Pipeline(s)",
        options=list(PIPELINE_OPTIONS.keys()),
        default=["Iroquois (368)"],
        key=f"{key_prefix}_pipelines",
    )
    selected_pipeline_ids = [PIPELINE_OPTIONS[x] for x in selected_labels]

    c1, c2, c3 = st.columns(3)
    with c1:
        top_n = st.number_input("Top N details per pipeline", min_value=1, max_value=100, value=20, step=1,
                                key=f"{key_prefix}_topn")
    with c2:
        limit = st.number_input("Preview limit", min_value=1, max_value=200, value=25, step=1,
                                key=f"{key_prefix}_limit")
    with c3:
        sort = st.selectbox(
            "Sort",
            options=["insertDate:desc", "insertDate:asc", "postDate:desc", "postDate:asc"],
            index=0,
            key=f"{key_prefix}_sort",
        )

    show_body = st.checkbox("Show full Body column", value=False, key=f"{key_prefix}_show_body")

    if f"{key_prefix}_results" not in st.session_state:
        st.session_state[f"{key_prefix}_results"] = {}

    if st.button("Pull NatGas Notices", type="primary", key=f"{key_prefix}_run"):
        results = {}
        if not api_key:
            st.error("Missing API key.")
        elif not selected_pipeline_ids:
            st.warning("Select at least one pipeline.")
        else:
            with st.spinner("Pulling notices..."):
                for pid in selected_pipeline_ids:
                    try:
                        df = _pull_natgas_notice_details_single_pipeline(
                            api_key=api_key,
                            pipeline_id=pid,
                            top_n=top_n,
                            limit=limit,
                            offset=0,
                            sort=sort,
                        )
                        results[pid] = df
                    except Exception as e:
                        st.error(f"Failed for pipeline {pid}: {e}")
                        results[pid] = pd.DataFrame()

            st.session_state[f"{key_prefix}_results"] = results
            st.success("Notices pull complete.")

    # Render results
    results = st.session_state.get(f"{key_prefix}_results", {})
    if results:
        for pid in selected_pipeline_ids:
            df = results.get(pid, pd.DataFrame())
            meta = PIPELINE_META.get(pid, {})
            short_name = meta.get("pipelineName", str(pid))
            long_name = meta.get("pipelineLongName", "")

            st.markdown(f"### {short_name} ({pid})")
            if long_name:
                st.caption(long_name)

            if df is None or df.empty:
                st.info("No notices returned.")
                continue

            display_df = df.copy()
            if not show_body and "Body" in display_df.columns:
                display_df = display_df.drop(columns=["Body"])

            st.dataframe(display_df, use_container_width=True, hide_index=True)

            with st.expander(f"Show raw/cleaned notice text for {short_name}"):
                if "Body" in df.columns:
                    for i, row in df.head(top_n).iterrows():
                        st.markdown(f"**{row.get('Subject of Notice', '(No Subject)')}**")
                        st.caption(
                            f"Priority: {row.get('Priority', '')} | Type: {row.get('Type', '')} | "
                            f"Status: {row.get('Status', '')} | Post: {row.get('Post Date (fmt)', '')}"
                        )
                        st.text(row.get("Body", ""))
                        st.markdown("---")

    return st.session_state.get(f"{key_prefix}_results", {})
# </editor-fold>


# <editor-fold desc="Helper Functions">
def find_clean_prints(congestion_pivoted_df, tol=0.0001):
    clean_print_rows = []

    for he in congestion_pivoted_df.columns:
        col_series = congestion_pivoted_df[he]
        non_zero_rows = col_series[col_series.abs() > tol]

        if len(non_zero_rows) == 1:
            row_idx = non_zero_rows.index[0]
            constraint_cost = non_zero_rows.iloc[0]

            clean_print_rows.append({
                "HE": he,
                "Limiting Facility": row_idx[0],
                "Contingency": row_idx[1],
                "Constraint Cost($)": constraint_cost,
            })

    clean_print_df = pd.DataFrame(clean_print_rows)

    if not clean_print_df.empty:
        clean_print_df = clean_print_df.sort_values("HE").reset_index(drop=True)

    return clean_print_df


def calculate_opa(df):
    opa_mask = df["HE"].between(7, 22)
    opa_df = df[opa_mask].groupby("Date", as_index=False).mean().round(2)
    return opa_df


def plotly_heatmap(df):
    fig = px.imshow(df)
    return fig


def plotly_line_chart(df, x, y, y2=None):
    df["Timestamp"] = pd.to_datetime(df["Date"]) + pd.to_timedelta(df["HE"], unit="h")
    df = df.sort_values("Timestamp")

    # keep your original behavior
    if y2 is None:
        fig = px.line(df, x=x, y=y, markers=True)
        return fig

    # only for dual axis
    fig = make_subplots(specs=[[{"secondary_y": True}]])
    fig.add_trace(go.Scatter(x=df[x], y=df[y], mode="lines+markers", name=y), secondary_y=False)
    fig.add_trace(go.Scatter(x=df[x], y=df[y2], mode="lines+markers", name=y2), secondary_y=True)
    return fig


def ny_gen_sec_maker(df, var, who, type):
    opa_df = df[df["HE"].between(8, 23)].groupby("Date", as_index=False).mean(numeric_only=True).round(0).drop(
        columns="HE")

    start_df = df[df["Date"] == start].reset_index()
    end_df = df[df["Date"] == end].reset_index()

    end_opa_df = opa_df[opa_df["Date"] == end]
    start_opa_df = opa_df[opa_df["Date"] == start]

    # OPA
    opa = end_opa_df[var].iloc[0]

    # Delta
    opa_delta = end_opa_df[var].iloc[0] - start_opa_df[var].iloc[0]

    # Peak, Peak Delta, & Peak HE
    peak_end = end_df[var].max()
    peak_start = start_df[var].max()
    peak_delta = peak_end - peak_start
    peak_end_HE = end_df[var].idxmax() + 1

    if opa_delta > 0:
        opa_delta_word = "increase"
    elif opa_delta < 0:
        opa_delta_word = "decrease"
    else:
        opa_delta_word = "remain flat"

    if peak_delta > 0:
        peak_delta_word = "rise"
    elif peak_delta < 0:
        peak_delta_word = "decline"
    else:
        peak_delta_word = "remain flat"

    sentence = f"{who} is forecasting OPA {type} levels to {opa_delta_word} {abs(opa_delta):,.0f} MW d/d to an OPA of {opa:,.0f} MW. Peak {type} is projected to {peak_delta_word} by {abs(peak_delta):,.0f} MW d/d to a peak of {peak_end:,.0f} MW at HE {peak_end_HE}."
    return (sentence)


def compact_date(d):
    return d.strftime("%Y%m%d")


def build_congestion_pivot_and_stacked_chart(congestion_df):
    # Pre-processing
    congestion_df = congestion_df.copy()
    congestion_df["Time Stamp"] = pd.to_datetime(congestion_df["Time Stamp"])
    congestion_df["Date"] = congestion_df["Time Stamp"].dt.date
    congestion_df["HE"] = congestion_df["Time Stamp"].dt.hour

    congestion_pivoted_df = congestion_df.pivot_table(
        index=["Limiting Facility", "Contingency"],
        columns="HE",
        values="Constraint Cost($)",
        aggfunc="sum"
    ).round(2).fillna(0)

    # Plot Stacked Bar Chart
    plot_df = congestion_pivoted_df.T.copy()
    plot_df.index.name = "HE"
    plot_df = plot_df.reset_index()

    series_names = [
        f"{facility} | {contingency}"
        for facility, contingency in congestion_pivoted_df.index.tolist()
    ]
    plot_df.columns = ["HE"] + series_names

    fig = go.Figure()
    for col in series_names:
        fig.add_trace(
            go.Bar(
                name=col,
                x=plot_df["HE"],
                y=plot_df[col]
            )
        )

    fig.update_layout(barmode="stack")

    return congestion_df, congestion_pivoted_df, fig
# </editor-fold>


# <editor-fold desc="Report Functions">
def report_summary_section_writer(report_type):
    if report_type == "Final":
        opa_sentence = f"Day-ahead zonal A, G, J, and K OPA prices are expected to see an [increase/decrease] due to [x]."
        ga_spread_sentence = f" The G/A OPA spread is expected to [increase/decrease] due to [x]."
        jg_spread_sentence = f" The J/G OPA spread is expected to [increase/decrease] due to [x]."
        return opa_sentence + ga_spread_sentence + jg_spread_sentence
    elif report_type == "Prelim":
        opa_sentence = f"Day-ahead zonal A, G, J, and K OPA prices are expected to see an [increase/decrease] due to [x]."
        ga_spread_sentence = f" The G/A OPA spread is expected to [increase/decrease] due to [x]."
        jg_spread_sentence = f" The J/G OPA spread is expected to [increase/decrease] due to [x]."
        return opa_sentence + ga_spread_sentence + jg_spread_sentence
    elif report_type == "Weekend Prelim":
        sat_opa_sentence = f"For this upcoming Saturday, Zonal AGJK OPA prices are expected to see an [increase/decrease] due to [x]."
        sat_ga_spread_sentence = f" On Saturday, the DA G/A OPA spread is expected to [increase/decrease] due to [x]."
        sat_jg_spread_sentence = f" On Saturday, the DA J/G OPA spread is expected to [increase/decrease] due to [x]."
        sun_opa_sentence = f" For this upcoming Sunday, Zonal AGJK OPA prices are expected to see an [increase/decrease] due to [x]."
        sun_ga_spread_sentence = f" On Sunday, the DA G/A OPA spread is expected to [increase/decrease] due to [x]."
        sun_jg_spread_sentence = f" On Sunday, the DA J/G OPA spread is expected to [increase/decrease] due to [x]."
        return sat_opa_sentence + sat_ga_spread_sentence + sat_jg_spread_sentence + sun_opa_sentence + sun_ga_spread_sentence + sun_jg_spread_sentence
    elif report_type == "Mon Final":
        opa_sentence = f"For this upcoming Monday, day-ahead zonal AGJK OPA prices are expected to see an [increase/decrease] due to [x]."
        ga_spread_sentence = f" On Monday, the DA G/A OPA spread is expected to [increase/decrease] due to [x]."
        jg_spread_sentence = f" On Monday, the DA J/G OPA spread is expected to [increase/decrease] due to [x]."
        return opa_sentence + ga_spread_sentence + jg_spread_sentence
    elif report_type == "Tue Prelim":
        opa_sentence = f"For this upcoming Tuesday, day-ahead zonal AGJK OPA prices are expected to see an [increase/decrease] due to [x]."
        ga_spread_sentence = f" On Tuesday, the DA G/A OPA spread is expected to [increase/decrease] due to [x]."
        jg_spread_sentence = f" On Tuesday, the DA J/G OPA spread is expected to [increase/decrease] due to [x]."
        return opa_sentence + ga_spread_sentence + jg_spread_sentence
    elif report_type == "14-Day Outlook":
        first_week = f"For the first week, day-ahead zonal AGJK OPA prices are expected to see an [increase/decrease] due to [x]."
        second_week = f"For the second week, day-ahead zonal AGJK OPA prices are expected to see an [increase/decrease] due to [x]."
        return first_week + second_week


def tf_derate_sentences_for_date(path_name, d1):
    from zoneinfo import ZoneInfo
    import numpy as np

    @st.cache_data(show_spinner=False)
    def _download_ttcf_csv(file_day):
        tf_file_date = compact_date(file_day)
        url = f"https://mis.nyiso.com/public/csv/ttcf/{tf_file_date}ttcf.csv"
        response = requests.get(url, timeout=30, verify=False)
        response.raise_for_status()
        return response.content

    def _clean_time_to_hhmm(series: pd.Series) -> pd.Series:
        """
        Robustly normalize TTCF time fields to 'HH:MM' strings.
        Handles: 0/NaN, 'HH:MM', 'HH:MM:SS', 'HMM', 'HHMM', 'HHMMSS'.
        """
        if series is None:
            return pd.Series(dtype="object")

        s = series.copy()

        # convert 0/0.0 to NaN, strip whitespace
        s = s.replace([0, 0.0, "0", "0.0"], np.nan)
        s = s.astype("string").str.strip()
        s = s.replace({"": pd.NA, "nan": pd.NA, "NaT": pd.NA, "None": pd.NA})

        # normalize pure-digit formats
        # HHMMSS -> HH:MM:SS
        mask6 = s.str.fullmatch(r"\d{6}", na=False)
        s.loc[mask6] = (
                s.loc[mask6].str.slice(0, 2) + ":" +
                s.loc[mask6].str.slice(2, 4) + ":" +
                s.loc[mask6].str.slice(4, 6)
        )

        # HHMM -> HH:MM
        mask4 = s.str.fullmatch(r"\d{4}", na=False)
        s.loc[mask4] = s.loc[mask4].str.slice(0, 2) + ":" + s.loc[mask4].str.slice(2, 4)

        # HMM -> 0H:MM
        mask3 = s.str.fullmatch(r"\d{3}", na=False)
        s.loc[mask3] = "0" + s.loc[mask3].str.slice(0, 1) + ":" + s.loc[mask3].str.slice(1, 3)

        # parse; if it has seconds, keep; then drop seconds to HH:MM
        dt = pd.to_datetime(s, errors="coerce")
        out = dt.dt.strftime("%H:%M")

        # return as object with NaN for missing
        return out

    now_et = datetime.now(ZoneInfo("America/New_York"))
    cutoff_et = now_et.replace(hour=10, minute=0, second=0, microsecond=0)

    primary_day = now_et.date() if now_et >= cutoff_et else (now_et.date() - timedelta(days=1))
    fallback_day = primary_day - timedelta(days=1)

    try:
        content = _download_ttcf_csv(primary_day)
    except requests.exceptions.HTTPError as e:
        if getattr(e.response, "status_code", None) == 404:
            content = _download_ttcf_csv(fallback_day)
        else:
            raise

    raw_df = pd.read_csv(io.BytesIO(content))
    tf_df = raw_df.fillna(0)

    tf_df = tf_df.drop(
        columns={'ATI', 'CALLED_IN_', 'CANCELLATI', 'mod mess', 'CANCELLATI2', 'PTID', 'ARR'},
        errors="ignore"
    )

    tf_df = tf_df.rename(columns={
        'RTSA FACILITY NAME': 'Cause Of Derate',
        'DATE_OUT': 'Date Out',
        'TIME_OU': 'Time Out',
        'DATE_IN': 'Date In',
        'TIME_IN': 'Time In',
        'EXPORT PATH NAME': 'Path Name',
        'FWD - Total Transfer Cap': 'Revised Import TTC',
        'FWD - TTC transfer impact': 'Import TTC Impact',
        'FWD - TTC ALL I/S': 'Base Import TTC',
        'REV - Total Transfer Cap': 'Revised Export TTC',
        'REV - TTC transfer impact': 'Export TTC Impact',
        'REV - TTC ALL I/S': 'Base Export TTC'
    })

    path_map = {
        'SCH - PJ - NY': 'PJM AC',
        'SCH - PJM_HTP': 'PJM HTP',
        'SCH - PJM_VFT': 'PJM VFT',
        'SCH - PJM_NEPTUNE': 'PJM Neptune',
        'SCH - NE - NY': 'NE AC',
        'SCH - NPX_1385': '1385',
        'SCH - NPX_CSC': 'CSC',
        'SCH - OH - NY': 'IMO AC',
        'SCH - HQ - NY': 'HQ AC',
        'SCH - HQ_CEDARS': 'HQ Cedars',
        'CENTRAL EAST - VC': 'Central East',
        'MOSES SOUTH': 'Moses South',
        'SPR/DUN-SOUTH': 'Spr/Dun South',
        'UPNY CONED': 'UPNY-ConEd',
        'DYSINGER EAST': 'Dysinger East',
        'TOTAL EAST': 'Total East',
        'CONED - LIPA': 'ConEd–LIPA',
        'WEST CENTRAL': 'West Central',
    }
    tf_df["Path Name"] = tf_df["Path Name"].replace(path_map)

    tf_df["Date Out"] = pd.to_datetime(tf_df["Date Out"], errors="coerce")
    tf_df["Date In"] = pd.to_datetime(tf_df["Date In"], errors="coerce")

    # ✅ NEW: normalize time columns to HH:MM
    tf_df["Time Out"] = _clean_time_to_hhmm(tf_df.get("Time Out"))
    tf_df["Time In"] = _clean_time_to_hhmm(tf_df.get("Time In"))

    tf_df["Import TTC Impact"] = pd.to_numeric(tf_df["Import TTC Impact"], errors="coerce").fillna(0)
    tf_df["Export TTC Impact"] = pd.to_numeric(tf_df["Export TTC Impact"], errors="coerce").fillna(0)

    tf_df["Revised Import TTC"] = pd.to_numeric(tf_df["Revised Import TTC"], errors="coerce").fillna(0)
    tf_df["Revised Export TTC"] = pd.to_numeric(tf_df["Revised Export TTC"], errors="coerce").fillna(0)

    one_year_old = datetime.now() - timedelta(days=365)
    tf_df = tf_df[tf_df["Date Out"] >= one_year_old]

    if isinstance(d1, str):
        d1_dt = pd.to_datetime(d1).normalize()
    elif isinstance(d1, date) and not isinstance(d1, datetime):
        d1_dt = pd.to_datetime(d1).normalize()
    else:
        d1_dt = pd.to_datetime(d1).normalize()

    tf_df = tf_df[tf_df["Path Name"] == path_name].copy()
    tf_df = tf_df[(tf_df["Date Out"] <= d1_dt) & (tf_df["Date In"] >= d1_dt)].copy()

    sentences_df = pd.DataFrame()

    import_candidates = tf_df[tf_df["Import TTC Impact"] != 0].copy()
    if not import_candidates.empty:
        top_import = import_candidates.loc[import_candidates["Import TTC Impact"].abs().idxmax()]
        sentences_df = pd.concat([sentences_df, top_import.to_frame().T], ignore_index=True)

    export_candidates = tf_df[tf_df["Export TTC Impact"] != 0].copy()
    if not export_candidates.empty:
        top_export = export_candidates.loc[export_candidates["Export TTC Impact"].abs().idxmax()]
        if sentences_df.empty or not top_export.equals(sentences_df.iloc[0]):
            sentences_df = pd.concat([sentences_df, top_export.to_frame().T], ignore_index=True)

    sentences = []

    for _, row in sentences_df.iterrows():
        # ✅ NEW: build "MM/DD/YY HH:MM" strings (default time = 00:00 if missing)
        out_date = row.get("Date Out")
        in_date = row.get("Date In")
        out_time = row.get("Time Out")
        in_time = row.get("Time In")

        out_time = out_time if isinstance(out_time, str) and out_time.strip() else "00:00"
        in_time = in_time if isinstance(in_time, str) and in_time.strip() else "00:00"

        out_str = f"{out_date:%m/%d/%y} {out_time}" if pd.notna(out_date) else ""
        in_str = f"{in_date:%m/%d/%y} {in_time}" if pd.notna(in_date) else ""

        imp_impact = float(row["Import TTC Impact"])
        exp_impact = float(row["Export TTC Impact"])

        if imp_impact != 0:
            sentences.append(
                f"{path_name} import TTC is derated to {row['Revised Import TTC']:,.0f} MW "
                f"({imp_impact:,.0f} MW impact) from {out_str} to {in_str}."
            )

        if exp_impact != 0:
            sentences.append(
                f"{path_name} export TTC is derated to {row['Revised Export TTC']:,.0f} MW "
                f"({exp_impact:,.0f} MW impact) from {out_str} to {in_str}."
            )

    return " ".join(sentences)


def report_imports_section_writer(report_type):
    if report_type in ("Final", "Prelim", "Mon Final", "Tue Prelim"):
        nyiso_da_flows = {
            "NE AC DA flows": 9554,
            "1385 DA flows": 44420,
            "CSC DA flows": 9555,
            "PJM AC DA flows": 9558,
            "PJM HTP DA flows": 65039,
            "PJM VFT DA flows": 40623,
            "PJM Neptune DA flows": 9557,
            "IMO AC DA flows": 9556,
            "HQ AC DA flows": 9553,
            "HQ Cedars DA flows": 9552,
        }
        week_days = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")

        # target date = d1
        today = date.today()
        if report_type == "Final":
            d1 = today
        elif report_type == "Prelim":
            d1 = today + timedelta(days=1)
        elif report_type == "Mon Final":
            d1 = today - timedelta(days=(today.weekday() - 6) % 7)  # Sunday
        elif report_type == "Tue Prelim":
            d1 = today - timedelta(days=(today.weekday() - 0) % 7)  # Monday
        else:
            d1 = today

        interval = "H"
        flows_d1 = date.today()
        flows_d2 = date.today()

        da_flows_df = pull_data(api_key, nyiso_da_flows, flows_d1, flows_d2, interval)
        da_flows_df_opa = calculate_opa(da_flows_df).mean(numeric_only=True)

        all_sentences = []

        for name in nyiso_da_flows.keys():
            new_name = name.replace(" DA flows", "")
            opa_val = da_flows_df_opa[name]

            if report_type == "Final":
                if opa_val > 0:
                    flow_dir = "imports are modeled [higher/lower] relative to today's DAM clear due to [x]. "
                elif opa_val < 0:
                    flow_dir = "exports are modeled [higher/lower] relative to today's DAM clear due to [x]. "
                else:
                    flow_dir = "flows are modelled out. "
            elif report_type == "Prelim":
                if opa_val > 0:
                    flow_dir = "imports are modeled [higher/lower] relative to tomorrow's DAM clear due to [x]. "
                elif opa_val < 0:
                    flow_dir = "exports are modeled [higher/lower] relative to tomorrow's DAM clear due to [x]. "
                else:
                    flow_dir = "flows are modelled out. "
            elif report_type == "Mon Final":
                if opa_val > 0:
                    flow_dir = "imports are modeled [higher/lower] relative to Sunday's forecast due to [x]. "
                elif opa_val < 0:
                    flow_dir = "exports are modeled [higher/lower] relative to Sunday's forecast due to [x]. "
                else:
                    flow_dir = "flows are modelled out. "
            elif report_type == "Tue Prelim":
                if opa_val > 0:
                    flow_dir = "imports are modeled [higher/lower] relative to Tuesday's forecast due to [x]. "
                elif opa_val < 0:
                    flow_dir = "exports are modeled [higher/lower] relative to Tuesday's forecast due to [x]. "
                else:
                    flow_dir = "flows are modelled out. "

            sentences = []

            # For IMO AC only:
            d2 = d1 - timedelta(days=1)
            ontario_wind_df = pull_ontario_wind_forecast_df(storm_vistra_api_key, d1, d2)
            ontario_wind_df_opa = calculate_opa(ontario_wind_df).mean(numeric_only=True)
            # st.write(ontario_wind_df_opa)

            if new_name == "IMO AC":
                sentences.append(
                    f"The IESO is forecasting [a lack of SBG (surplus baseload generation) levels from HE [x] to [x]]. "
                )
                sentences.append(
                    "Ontario wind generation levels are forecast to [increase/decrease] [x] MW d/d to an average [x] MW. "
                )
                sentences.append(
                    f"{new_name} {flow_dir}"
                )
            elif new_name == "PJM AC":
                sentences.append(
                    f"{new_name} {flow_dir}"
                )
            elif new_name == "PJM HTP":
                sentences.append(
                    f"{new_name} {flow_dir}"
                )
            elif new_name == "PJM VFT":
                sentences.append(
                    f"{new_name} {flow_dir}"
                )
            elif new_name == "PJM Neptune":
                sentences.append(
                    f"{new_name} {flow_dir}"
                )
            elif new_name == "NE AC":
                sentences.append(
                    f"{new_name} {flow_dir}"
                )
            elif new_name == "1385":
                sentences.append(
                    f"{new_name} {flow_dir}"
                )
            elif new_name == "CSC":
                sentences.append(
                    f"{new_name} {flow_dir}"
                )
            elif new_name == "HQ AC":
                sentences.append(
                    f"{new_name} {flow_dir}"
                )
            elif new_name == "HQ Cedars":
                sentences.append(
                    f"{new_name} {flow_dir}"
                )

            # ---- TTCF derates for target date d1 (call your function) ----
            derate_sentence = tf_derate_sentences_for_date(new_name, d1)
            if derate_sentence:
                sentences.append(derate_sentence)

            if sentences:
                all_sentences.append(" ".join(sentences))

        return "\n\n".join(all_sentences)


    elif report_type == "Weekend Prelim":

        nyiso_da_flows = {

            "NE AC DA flows": 9554,

            "1385 DA flows": 44420,

            "CSC DA flows": 9555,

            "PJM AC DA flows": 9558,

            "PJM HTP DA flows": 65039,

            "PJM VFT DA flows": 40623,

            "PJM Neptune DA flows": 9557,

            "IMO AC DA flows": 9556,

            "HQ AC DA flows": 9553,

            "HQ Cedars DA flows": 9552,

        }

        today = date.today()

        days_to_friday = (4 - today.weekday()) % 7

        friday = today + timedelta(days=days_to_friday)

        saturday = friday + timedelta(days=1)

        sunday = saturday + timedelta(days=1)

        interval = "H"

        flows_d1 = date.today()

        flows_d2 = date.today()

        da_flows_df = pull_data(api_key, nyiso_da_flows, flows_d1, flows_d2, interval)

        da_flows_df_opa = calculate_opa(da_flows_df).mean(numeric_only=True)

        all_sentences = []

        for name in nyiso_da_flows.keys():

            new_name = name.replace(" DA flows", "")

            opa_val = da_flows_df_opa[name]

            # ---- Weekend flow direction phrasing (same style as other branch) ----

            if opa_val > 0:

                sat_flow_dir = "imports are modeled [higher/lower] relative to Friday's clear due to [x]. "

                sun_flow_dir = "imports are modeled [higher/lower] relative to Saturdays's forecast due to [x]. "

            elif opa_val < 0:

                sat_flow_dir = "exports are modeled [higher/lower] relative to Friday's clear due to [x]. "

                sun_flow_dir = "exports are modeled [higher/lower] relative to Friday's clear due to [x]. "

            else:

                sat_flow_dir = "flows are modelled out. "

                sun_flow_dir = "flows are modelled out. "

            sentences = []

            if new_name == "IMO AC":

                sentences.append(

                    "On Saturday, the IESO is forecasting [a lack of SBG (surplus baseload generation) levels from HE [x] to [x]]. "

                )

                sentences.append(

                    "On Saturday, Ontario wind generation levels are forecast to [increase/decrease] [x] MW d/d to an average [x] MW. "

                )

                sentences.append(

                    f"On Saturday, {new_name} {sat_flow_dir}"

                )

                sentences.append(

                    "On Sunday, the IESO is forecasting [a lack of SBG (surplus baseload generation) levels from HE [x] to [x]]. "

                )

                sentences.append(

                    "On Sunday, Ontario wind generation levels are forecast to [increase/decrease] [x] MW d/d to an average [x] MW. "

                )

                sentences.append(

                    f"On Sunday, {new_name} {sun_flow_dir}"

                )


            elif new_name == "PJM AC":

                sentences.append(f"On Saturday, {new_name} {sat_flow_dir}")

                sentences.append(f"On Sunday, {new_name} {sun_flow_dir}")


            elif new_name == "PJM HTP":

                sentences.append(f"On Saturday, {new_name} {sat_flow_dir}")

                sentences.append(f"On Sunday, {new_name} {sun_flow_dir}")


            elif new_name == "PJM VFT":

                sentences.append(f"On Saturday, {new_name} {sat_flow_dir}")

                sentences.append(f"On Sunday, {new_name} {sun_flow_dir}")


            elif new_name == "PJM Neptune":

                sentences.append(f"On Saturday, {new_name} {sat_flow_dir}")

                sentences.append(f"On Sunday, {new_name} {sun_flow_dir}")


            elif new_name == "NE AC":

                sentences.append(f"On Saturday, {new_name} {sat_flow_dir}")

                sentences.append(f"On Sunday, {new_name} {sun_flow_dir}")


            elif new_name == "1385":

                sentences.append(f"On Saturday, {new_name} {sat_flow_dir}")

                sentences.append(f"On Sunday, {new_name} {sun_flow_dir}")


            elif new_name == "CSC":

                sentences.append(f"On Saturday, {new_name} {sat_flow_dir}")

                sentences.append(f"On Sunday, {new_name} {sun_flow_dir}")


            elif new_name == "HQ AC":

                sentences.append(f"On Saturday, {new_name} {sat_flow_dir}")

                sentences.append(f"On Sunday, {new_name} {sun_flow_dir}")


            elif new_name == "HQ Cedars":

                sentences.append(f"On Saturday, {new_name} {sat_flow_dir}")

                sentences.append(f"On Sunday, {new_name} {sun_flow_dir}")

            # ---- TTCF derates for Saturday + Sunday (same append style) ----

            sat_derate = tf_derate_sentences_for_date(new_name, saturday)

            if sat_derate:
                sentences.append(f"On Saturday, {sat_derate}")

            sun_derate = tf_derate_sentences_for_date(new_name, sunday)

            if sun_derate:
                sentences.append(f"On Sunday, {sun_derate}")

            if sentences:
                all_sentences.append(" ".join(sentences))

        return "\n\n".join(all_sentences)



    elif report_type == "14-Day Outlook":

        nyiso_da_flows = {

            "NE AC DA flows": 9554,

            "1385 DA flows": 44420,

            "CSC DA flows": 9555,

            "PJM AC DA flows": 9558,

            "PJM HTP DA flows": 65039,

            "PJM VFT DA flows": 40623,

            "PJM Neptune DA flows": 9557,

            "IMO AC DA flows": 9556,

            "HQ AC DA flows": 9553,

            "HQ Cedars DA flows": 9552,

        }

        start = date.today()

        end = start + timedelta(days=14)

        interval = "H"

        flows_d1 = date.today()

        flows_d2 = date.today()

        da_flows_df = pull_data(api_key, nyiso_da_flows, flows_d1, flows_d2, interval)

        da_flows_df_opa = calculate_opa(da_flows_df).mean(numeric_only=True)

        all_sentences = []

        for name in nyiso_da_flows.keys():

            new_name = name.replace(" DA flows", "")

            opa_val = da_flows_df_opa[name]

            # ---- Outlook flow direction phrasing in same style ----

            if opa_val > 0:

                flow_dir = "imports are expected to be [higher/lower] in the first week and [higher/lower] in the second week due to [x]. "

            elif opa_val < 0:

                flow_dir = "exports are expected to be [higher/lower] in the first week and [higher/lower] in the second week due to [x]. "

            else:

                flow_dir = "flows are expected to see a lack of flows due to [x]. "

            sentences = []

            if new_name == "IMO AC":

                sentences.append(

                    "The IESO is forecasting [periods of limited/excess SBG] across the outlook window. "

                )

                sentences.append(

                    "Ontario wind generation levels are expected to [increase/decrease] versus recent levels through portions of the period. "

                )

                sentences.append(

                    f"Over the 14-day outlook, {new_name} {flow_dir}"

                )


            elif new_name == "PJM AC":

                sentences.append(f"Over the 14-day outlook, {new_name} {flow_dir}")


            elif new_name == "PJM HTP":

                sentences.append(f"Over the 14-day outlook, {new_name} {flow_dir}")


            elif new_name == "PJM VFT":

                sentences.append(f"Over the 14-day outlook, {new_name} {flow_dir}")


            elif new_name == "PJM Neptune":

                sentences.append(f"Over the 14-day outlook, {new_name} {flow_dir}")


            elif new_name == "NE AC":

                sentences.append(f"Over the 14-day outlook, {new_name} {flow_dir}")


            elif new_name == "1385":

                sentences.append(f"Over the 14-day outlook, {new_name} {flow_dir}")


            elif new_name == "CSC":

                sentences.append(f"Over the 14-day outlook, {new_name} {flow_dir}")


            elif new_name == "HQ AC":

                sentences.append(f"Over the 14-day outlook, {new_name} {flow_dir}")


            elif new_name == "HQ Cedars":

                sentences.append(f"Over the 14-day outlook, {new_name} {flow_dir}")

            # ---- TTCF derates across 14 days, deduped, but appended in same style ----

            seen = set()

            for i in range((end - start).days + 1):

                day = start + timedelta(days=i)

                derate_sentence = tf_derate_sentences_for_date(new_name, day)

                if derate_sentence and derate_sentence not in seen:
                    seen.add(derate_sentence)

                    sentences.append(derate_sentence)

            if sentences:
                all_sentences.append(" ".join(sentences))

        if not all_sentences:
            return "No TTC derates are currently flagged across major NYISO interfaces over the next 14 days."

        return "\n\n".join(all_sentences)


def report_generation_section_writer(report_type, api_key):
    demand_dataset = {
        "NYISO System Load Forecast": 54132,
        "WM NYISO System Load Forecast": 64472,
        "WM NYISO Wind Forecast": 105427,
    }

    def _gen_sentence_from_df(df, start_day, end_day, var, who, metric_type, prefix=""):
        # normalize dates
        temp = df.copy()
        temp["Date"] = pd.to_datetime(temp["Date"]).dt.strftime("%Y-%m-%d")

        start_str = pd.to_datetime(start_day).strftime("%Y-%m-%d")
        end_str = pd.to_datetime(end_day).strftime("%Y-%m-%d")

        # OPA window (adjust if your HE convention is 1-24 instead of 0-23)
        opa_df = (
            temp[temp["HE"].between(7, 22)]
            .groupby("Date", as_index=False)
            .mean(numeric_only=True)
            .round(0)
            .drop(columns="HE", errors="ignore")
        )

        start_df = temp[temp["Date"] == start_str].copy().reset_index(drop=True)
        end_df = temp[temp["Date"] == end_str].copy().reset_index(drop=True)

        start_opa_df = opa_df[opa_df["Date"] == start_str]
        end_opa_df = opa_df[opa_df["Date"] == end_str]

        # OPA + delta
        opa = end_opa_df[var].iloc[0]
        opa_delta = end_opa_df[var].iloc[0] - start_opa_df[var].iloc[0]

        # Peak + peak delta + HE
        peak_end = end_df[var].max()
        peak_start = start_df[var].max()
        peak_delta = peak_end - peak_start
        peak_end_he = int(end_df.loc[end_df[var].idxmax(), "HE"]) + 1

        if opa_delta > 0:
            opa_delta_word = "increase"
        elif opa_delta < 0:
            opa_delta_word = "decrease"
        else:
            opa_delta_word = "remain flat"

        if peak_delta > 0:
            peak_delta_word = "rise"
        elif peak_delta < 0:
            peak_delta_word = "decline"
        else:
            peak_delta_word = "remain flat"

        sentence = (
            f"{prefix}{who} is forecasting OPA {metric_type} levels to {opa_delta_word} "
            f"{abs(opa_delta):,.0f} MW d/d to an OPA of {opa:,.0f} MW. "
            f"Peak {metric_type} is projected to {peak_delta_word} by {abs(peak_delta):,.0f} MW d/d "
            f"to a peak of {peak_end:,.0f} MW at HE {peak_end_he}."
        )
        return sentence

    def _daily_generation_block(start_day, end_day, prefix=""):
        # one pull for all 3 series
        demand_df = pull_data(
            api_key,
            demand_dataset,
            pd.to_datetime(start_day).strftime("%Y-%m-%d"),
            pd.to_datetime(end_day).strftime("%Y-%m-%d"),
            "H"
        )

        iso_demand_sentence = _gen_sentence_from_df(
            demand_df, start_day, end_day, "NYISO System Load Forecast", "NYISO", "demand", prefix
        )
        wm_demand_sentence = _gen_sentence_from_df(
            demand_df, start_day, end_day, "WM NYISO System Load Forecast", "WoodMac", "demand", prefix
        )
        wm_wind_sentence = _gen_sentence_from_df(
            demand_df, start_day, end_day, "WM NYISO Wind Forecast", "WoodMac", "wind", prefix
        )

        return " ".join([iso_demand_sentence, wm_demand_sentence, wm_wind_sentence])

    today = date.today()

    if report_type == "Final":
        # compare yesterday -> today
        start_day = today
        end_day = today + timedelta(days=1)
        return _daily_generation_block(start_day, end_day)

    elif report_type == "Prelim":
        # compare today -> tomorrow
        start_day = today + timedelta(days=1)
        end_day = today + timedelta(days=2)
        return _daily_generation_block(start_day, end_day)

    elif report_type == "Weekend Prelim":
        # Friday->Saturday and Saturday->Sunday
        days_to_friday = (4 - today.weekday()) % 7
        friday = today + timedelta(days=days_to_friday)
        saturday = friday + timedelta(days=1)
        sunday = saturday + timedelta(days=1)

        sat_block = _daily_generation_block(friday, saturday, prefix="On Saturday, ")
        sun_block = _daily_generation_block(saturday, sunday, prefix="On Sunday, ")

        return sat_block + "\n\n" + sun_block

    elif report_type == "Mon Final":
        # Sunday -> Monday
        monday = today - timedelta(days=(today.weekday() - 0) % 7)
        sunday = monday - timedelta(days=1)
        return _daily_generation_block(sunday, monday, prefix="On Monday, ")

    elif report_type == "Tue Prelim":
        # Monday -> Tuesday
        monday = today - timedelta(days=(today.weekday() - 0) % 7)
        tuesday = monday + timedelta(days=1)
        return _daily_generation_block(monday, tuesday, prefix="On Tuesday, ")

    elif report_type == "14-Day Outlook":
        # keeping this branch in the same pattern; you can replace with longer-horizon logic later
        start_day = today
        end_day = today + timedelta(days=1)
        return (
                "14-Day Outlook generation section (placeholder): "
                + _daily_generation_block(start_day, end_day)
        )

    return ""


def report_congestion_section_writer(report_type):
    impact_lookup = {
        # --- Zone J (Bullish) ---
        "GREENWD_-FOXHILLS_138": ["Gowanus-Greenwood", "Vernon-Greenwood", "Foxhills-Greenwood", "Goethals-Gowanus"],
        "DUNWOODN-SHERMCRK_138": ["Mott Haven-Rainey", "Dunwoodie-Mott Haven", "Lake Success-Shore Rd",
                                  "Dunwoodie-Shore Rd"],
        "W49TH_ST-E13THSTA_345": ["East 13 St-West 49th St", "Dunwoodie-Sprainbrook"],
        "W49TH_ST-W49TH_ST_138": ["East 13 St-West 49th St", "Foxhills-Greenwood", "Gowanus-Greenwood"],
        "RAINEY__-E75THSTA_138": ["Mott Haven-Rainey East"],
        "MOTTHAVN-RAINEY___345": ["Mott Haven-Rainey West"],
        "BENSHRST-GREENWD__138": ["parallel Greenwood-Bensonhurst lines"],
        "SPRNBRK_-W49TH_ST_345": ["Foxhills-Greenwood"],
        "SPRNBRK_-TREMONT__345": ["Mott Haven-Rainey"],

        # --- Zone K (Bullish & Bearish) ---
        "GLENWOOD-CARLPLCE_138": ["Glenwood-Shore Rd", "Lake Success-Shore Rd"],
        "NRTHPORT-PILGRIM__138": ["parallel Northport-Pilgrim line", "Northport XFs"],
        "SHORE_RD-GLENWOOD_138": ["Glenwood-Shore Rd", "Lake Success-Shore Rd"],
        "OAKWOOD_-ELWOOD___138": ["Elwood-Northport", "parallel Newbridge-Ruland lines", "Northport-Pilgrim"],
        "RULAND__-HOLBROOK_138": ["Elwood-Northport", "Newbridge-Ruland Rd"],
        "SPRNBRK_-DUNWOODS_138": ["Dunwoodie-Sprainbrook"],
        "HEWLETT_-VALLYSTR_69": ["Malverine-West Hempstead"],
        "EASTVIEW-SPRNBRK__345": ["Dunwoodie-Sprainbrook", "Goethals-Linden"],
        "VALLYSTR-STEWRTAV_138": ["parallel Stewart Ave-Newbridge lines", "Parallel Lake Success-Shore Rd lines",
                                  "Barrett-Valley Stream"],
        "RONKOKMA-HOLBROOK_138": ["Pilgrim XF", "Northport XF", "Northport-Pilgrim"],
        "SHORE_RD-LAKSUCSS_138": ["Lake Success-Shore Rd", "parallel Glenwood-Shore Rd lines",
                                  "parallel Valley Stream-Stewart Ave lines"],
        "LONG_MTN-CRICKVLY_345": ["Dunwoodie-Shore Rd"],
        "SPRNBRK_-TREMONT__345": ["Dunwoodie-Shore Rd"],
        "SHERMCRK-ACADEMY__138": ["Dunwoodie-Sprainbrook"],
        "STONBROK-PORTJEFF_69": ["Deposit-Indian Head", "Elwood-Pulaski", "Elwood-Northport"],
        "DUNWODIE-DUNWOODS_345": ["East 13th St-West 49th St", "Goethals-Linden", "Lake Success-Shore Rd",
                                  "Dunwoodie-Shore Rd"],
        "PILGRIM_-HAUPPAUG_138": ["parallel Elwood-Northport lines", "Pilgrim XFs", "Deposit-Indian Head",
                                  "Elwood-Pulaski", "Newbridge-Ruland"],
        "BAGATLRD-PILGRIM__138": ["Northport-Pilgrim", "Northport XF", "Elwood-Greenlawn", "Newbridge-Ruland Rd",
                                  "Pilgrim-Ruland Rd"],
        "VALLYSTR-BARRETT__138": ["Barrett-Valley Stream"],
        "JAMAICA_-VALLYSTR_138": ["Hudson Ave-Jamaica", "Mott Haven-Rainey", "Lake Success-Shore Rd",
                                  "Gowanus-Farragut", "Goethals-Gowanus", "East 13th St-West 49th St"],
        "MILLERPL-HOLBROOK_138": ["Holbrook-Sills Road", "West Bus-Sills Road"],
        "HOLBROOK-NSHORBCH_138": ["Miller Place-Shoreham"],

        # --- Bearish Zone D ---
        "MOSES___-ADIRNDCK_230": ["Adirondack-Moses"],
        "MOSES___-WILLIS___230": ["Malone-Willis"],

        # --- Downstate Congestion ---
        "MARCY___-N.SCTLND_345": ["Central East VC", "Gordon Road-Rotterdam"],
        "VOLNEY__-MARCY____345": ["Clay-Independence", "Clay-Nine Nile"],
        "MASSENA_-MARCY____765": ["Goethals-Linden"],
        "ROTTRDAM-BURDECK__115": ["North Troy-Sycaway"],
        "KNICRBKR-PLSNTVLY_345": ["parallel Leeds-New Scotland lines", "Van Wagner-Leeds",
                                  "parallel Pleasant Valley-Van Wagner lines"],
        "OSWEGO__-VOLNEY___345": ["the parallel Oswego-Volney line", "parallel Scriba-Volney line"],
        "N.TROY__-HOOSICK__115": ["parallel Pleasant Valley-Van Wagner lines", "Van Wagner-Leeds",
                                  "parallel Leeds-New Scotland lines"],
        "N.SCTLND-LEEDS____345": ["Leeds-New Scotland line"],
        "MILLWOOD-EASTVIEW_345": ["Eastview-Sprainbrook", "Dunwoodie-Sprainbrook"],
        "CHESTROR-SUGRLOAF_138": ["Van Wagner-Leeds", "New Scotland-Leed", "Pleasant Valley-Van Wagner"],
        "PLSNTVLY-WOOD_ST__345": ["Rock Tavern-Roseton", "Northport XF", "Northport-Pilgrim"],
        "PLSNTVLE-DUNWODIE_345": ["Pleasant Valley-Wood St", "Rock Tavern-Roseton"],
        "LEEDS___-ATHENS___345": ["Rock Tavern-Roseton"],
        "RAMAPO__-BUCHAN_N_345": ["Buchanan South-Lovett"],
        "WOOD_ST_-PLSNTVLE_345": ["Buchanan South-Lovett"],

        # --- Upstate Congestion ---
        "BORDRCTY-GUARDIAN_115": ["Meyer XF", "Hillside-E. Towanda"],
        "SENECA__-GARDNVLB_230": ["Elm St-Senneca"],
        "SCRIBA__-VOLNEY___345": ["Clay-Independence", "Clay-Nine Mile Point 1", "Scriba-Volney"],
        "CLAY____-EDIC_____345": ["Scriba-Volney"],
        "MEYER___-CANANDGA_230": ["Meyer XF"],
        "E.SAYRE_-NWAVERLY_115": ["Chemung-N. Waverly, Hillside-E.Towanda"],
        "CODINGTN-E.ITHACA_115": ["Codington-Montor Falls"],
        "OSWEGO__-VOLNEY___345": ["Scriba-Volney"],
    }
    outage_sched_url = "https://mis.nyiso.com/public/csv/os/outage-schedule.csv"

    def _load_outage_schedule():
        try:
            df = pd.read_csv(outage_sched_url)
        except:
            s = requests.get(outage_sched_url).content
            df = pd.read_csv(io.StringIO(s.decode("utf-8")))

        df["Date Out_dt"] = pd.to_datetime(df["Date Out"] + " " + df["Time Out"], errors="coerce")
        df["Date In_dt"] = pd.to_datetime(df["Date In"] + " " + df["Time In"], errors="coerce")
        return df

    def _create_impact_sentence(row):
        element = str(row["Equipment Name"])

        for key in impact_lookup:
            if key in element:
                constraints = impact_lookup[key]
                constraints_str = ", ".join(constraints)

                start = row["Date Out_dt"]
                end = row["Date In_dt"]

                if pd.isna(start) or pd.isna(end):
                    return f"An outage on {element} adds pressure to {constraints_str}."

                s_date = f"{start.month}/{start.day}"
                s_time = start.strftime("%H:%M")
                e_date = f"{end.month}/{end.day}"
                e_time = end.strftime("%H:%M")

                if start.date() == end.date():
                    time_str = f"on {s_date} from {s_time} to {e_time}"
                else:
                    time_str = f"from {s_date} {s_time} to {e_date} {e_time}"

                return f"An outage on {element} {time_str} adds pressure to {constraints_str}."
        return None

    def _congestion_block(start_day, end_day, prefix=""):
        df = _load_outage_schedule()

        start_dt = pd.to_datetime(start_day)
        end_dt = pd.to_datetime(end_day)

        # Overlapping logic
        df = df[(df["Date Out_dt"] < end_dt) & (df["Date In_dt"] > start_dt)].copy()

        if df.empty:
            if prefix:
                return f"{prefix}No specific congestion risks found active between {start_dt.date()} and {end_dt.date()}."
            return f"No specific congestion risks found active between {start_dt.date()} and {end_dt.date()}."

        df["impact_statement"] = df.apply(_create_impact_sentence, axis=1)
        results = df.dropna(subset=["impact_statement"]).copy()

        if results.empty:
            if prefix:
                return f"{prefix}No specific mapped congestion risks found active between {start_dt.date()} and {end_dt.date()}."
            return f"No specific mapped congestion risks found active between {start_dt.date()} and {end_dt.date()}."

        # Deduplicate repeated statements while preserving order
        statements = list(dict.fromkeys(results["impact_statement"].tolist()))

        if prefix:
            statements = [f"{prefix}{s}" for s in statements]

        return "\n\n".join(statements)

    today = date.today()

    if report_type == "Final":
        # Today window
        d1 = today
        d2 = today + timedelta(days=1)
        return _congestion_block(d1, d2)

    elif report_type == "Prelim":
        # Tomorrow window
        d1 = today + timedelta(days=1)
        d2 = today + timedelta(days=2)
        return _congestion_block(d1, d2)

    elif report_type == "Weekend Prelim":
        # Saturday + Sunday blocks
        days_to_friday = (4 - today.weekday()) % 7
        friday = today + timedelta(days=days_to_friday)
        saturday = friday + timedelta(days=1)
        sunday = saturday + timedelta(days=1)
        monday = sunday + timedelta(days=1)

        sat_block = _congestion_block(saturday, sunday, prefix="On Saturday, ")
        sun_block = _congestion_block(sunday, monday, prefix="On Sunday, ")

        return sat_block + "\n\n" + sun_block

    elif report_type == "Mon Final":
        # Monday delivery window
        monday = today - timedelta(days=(today.weekday() - 0) % 7)
        tuesday = monday + timedelta(days=1)
        return _congestion_block(monday, tuesday, prefix="On Monday, ")

    elif report_type == "Tue Prelim":
        # Tuesday delivery window
        monday = today - timedelta(days=(today.weekday() - 0) % 7)
        tuesday = monday + timedelta(days=1)
        wednesday = tuesday + timedelta(days=1)
        return _congestion_block(tuesday, wednesday, prefix="On Tuesday, ")

    elif report_type == "14-Day Outlook":
        start_day = today
        end_day = today + timedelta(days=14)

        # One combined 14-day window (simple)
        return _congestion_block(start_day, end_day, prefix="Over the next 14 days, ")

    return ""


def blast_maker(api_key):
    import io, time, requests
    import pandas as pd
    import streamlit as st
    from datetime import date, datetime, timedelta
    from zoneinfo import ZoneInfo

    API_URL = "https://api.genscape.com/power/epcalc/v1/getepcalcsiddata"
    API_KEY = api_key

    FINAL_REPORT_TEXT = ""
    PRELIM_REPORT_TEXT = ""
    WEEKEND_REPORT_TEXT = ""

    def next_weekday(start, weekday):
        delta = (weekday - start.weekday()) % 7
        if delta == 0:
            delta = 7
        return start + timedelta(days=delta)

    def is_dst_active(d):
        tz = ZoneInfo("America/New_York")
        dt = datetime(d.year, d.month, d.day, 0, 0, 0, tzinfo=tz)
        return bool(dt.dst())

    def ep_calc_pull(start_date, end_date, sids_dict):
        if not API_KEY:
            st.error("Missing GEN_API_KEY environment variable.")
            return pd.DataFrame()

        params = {
            "sids": ",".join([str(x) for x in sids_dict.values()]),
            "start_date": start_date.strftime("%Y-%m-%d"),
            "end_date": end_date.strftime("%Y-%m-%d"),
            "interval": "H",
            "standard_time": 0 if is_dst_active(start_date) else 1,
            "fill_type": 2,
            "orientation": "records",
        }
        headers = {"Accept": "application/json", "Gen-Api-Key": API_KEY}

        for attempt in range(3):
            try:
                r = requests.get(API_URL, params=params, headers=headers, timeout=60)
                r.raise_for_status()
                df = pd.DataFrame(r.json())
                if df.empty:
                    return pd.DataFrame()

                df["Date"] = pd.to_datetime(df["date"]).dt.date
                df["Hour"] = pd.to_datetime(df["date"]).dt.hour

                pivoted = (
                    df.pivot_table(index=["Date", "Hour"], columns="SensorID", values="Value")
                    .reset_index()
                )
                id_map = {v: k for k, v in sids_dict.items()}
                pivoted.rename(columns=id_map, inplace=True)
                return pivoted

            except Exception as e:
                if attempt < 2:
                    time.sleep(3)
                else:
                    st.error(f"API request failed after 3 tries: {e}")
                    return pd.DataFrame()

    def extract_section_content(report_text, section_title, next_titles):
        if not report_text:
            return ""
        start = report_text.find(section_title)
        if start == -1:
            return ""
        start = start + len(section_title)

        while start < len(report_text) and report_text[start] in [" ", "\t", "\n", "\r", ":"]:
            start += 1

        end_candidates = []
        for t in next_titles:
            idx = report_text.find("\n" + t, start)
            if idx != -1:
                end_candidates.append(idx)
        end = min(end_candidates) if end_candidates else len(report_text)

        return report_text[start:end].strip()

    def format_gas_block(gas_raw):
        if not gas_raw:
            return ""
        lines = [ln.strip() for ln in gas_raw.splitlines() if ln.strip()]
        return "\n".join(lines)

    def strip_demand_risk_header(demand_raw):
        if not demand_raw:
            return ""
        out_lines = []
        for line in demand_raw.splitlines():
            if not line.strip():
                out_lines.append(line)
                continue

            s = line.strip()
            s_low = s.lower()

            if s_low.startswith("demand risk"):
                if ":" in s:
                    remainder = s.split(":", 1)[1].strip()
                    if remainder:
                        out_lines.append(remainder)
                continue

            out_lines.append(line)
        return "\n".join(out_lines).strip()

    # --- DOCX removed: keep lightweight header builders only ---
    def create_daily_blast_header(report_string, api_data_df, target_date, report_type):
        on_peak = {"A": "N/A", "G": "N/A", "J": "N/A", "K": "N/A"}

        if not api_data_df.empty:
            day_data = api_data_df[api_data_df["Date"] == target_date]
            on_peak_hours = day_data[(day_data["Hour"] >= 7) & (day_data["Hour"] <= 22)]
            if not on_peak_hours.empty:
                for z in ["A", "G", "J", "K"]:
                    col = f"Zone {z} Price"
                    if col in on_peak_hours.columns and not on_peak_hours[col].dropna().empty:
                        on_peak[z] = f"{on_peak_hours[col].mean():.0f}"

        header = (
            f"WoodMac's {report_type} DA Forecast for {target_date.month}/{target_date.day} "
            f"is {on_peak['A']}, {on_peak['G']}, {on_peak['J']}, {on_peak['K']} (A, G, J, K)."
        )
        return header

    def create_weekend_blast_header(report_string, api_data_df):
        today = datetime.now().date()
        days_to_sat = (5 - today.weekday()) % 7
        if days_to_sat == 0 and datetime.now().hour > 17:
            days_to_sat = 7

        sat = today + timedelta(days=days_to_sat)
        sun = today + timedelta(days=days_to_sat + 1)

        sat_prices = {"A": None, "G": None, "J": None, "K": None}
        sun_prices = {"A": None, "G": None, "J": None, "K": None}
        wknd = {"A": "N/A", "G": "N/A", "J": "N/A", "K": "N/A"}

        if not api_data_df.empty:
            sat_data = api_data_df[api_data_df["Date"] == sat]
            sun_data = api_data_df[api_data_df["Date"] == sun]

            if not sat_data.empty:
                sat_on = sat_data[(sat_data["Hour"] >= 7) & (sat_data["Hour"] <= 22)]
                for z in ["A", "G", "J", "K"]:
                    col = f"Zone {z} Price"
                    if col in sat_on.columns and not sat_on[col].dropna().empty:
                        sat_prices[z] = sat_on[col].mean()

            if not sun_data.empty:
                sun_on = sun_data[(sun_data["Hour"] >= 7) & (sun_data["Hour"] <= 22)]
                for z in ["A", "G", "J", "K"]:
                    col = f"Zone {z} Price"
                    if col in sun_on.columns and not sun_on[col].dropna().empty:
                        sun_prices[z] = sun_on[col].mean()

            for z in ["A", "G", "J", "K"]:
                if sat_prices[z] is not None and sun_prices[z] is not None:
                    wknd[z] = f"{(sat_prices[z] + sun_prices[z]) / 2:.0f}"

        header = (
            "WoodMac's Preliminary NYISO DA Weekend 2x16 Forecast is "
            f"{wknd['A']}, {wknd['G']}, {wknd['J']}, {wknd['K']} (A, G, J, K)"
        )
        return header, sat, sun

    st.subheader("Blast Maker")
    st.markdown("Generate blasts for Final, Preliminary, or Weekend reports.")

    blast_type = st.radio(
        "Select Blast Type",
        ["Final Report", "Preliminary Report", "Weekend Report"],
        horizontal=True,
        key="blast_radio",
    )

    today = date.today()
    date_choice = None

    if blast_type == "Preliminary Report":
        date_choice = st.radio(
            "Target",
            ["D3 (two days out)", "Tue Prelim (upcoming Tuesday)"],
            horizontal=True,
            key="prelim_target",
        )
        d3 = today + timedelta(days=2)
        tue = next_weekday(today, 1)
        st.caption(f"D3 date: {d3:%a %b %d, %Y}  •  Tue Prelim: {tue:%a %b %d, %Y}")

    elif blast_type == "Final Report":
        date_choice = st.radio(
            "Target",
            ["DA Final (tomorrow)", "Mon Final (upcoming Monday)"],
            horizontal=True,
            key="final_target",
        )
        da = today + timedelta(days=1)
        mon = next_weekday(today, 0)
        st.caption(f"DA Final date: {da:%a %b %d, %Y}  •  Mon Final: {mon:%a %b %d, %Y}")

    report_templates = {
        "Final Report": FINAL_REPORT_TEXT,
        "Preliminary Report": PRELIM_REPORT_TEXT,
        "Weekend Report": WEEKEND_REPORT_TEXT,
    }

    report_string = st.text_area(
        "Report Content (Editable)",
        report_templates[blast_type],
        height=300,
        key="blast_report_text",
    )

    if "blast_output_text" not in st.session_state:
        st.session_state.blast_output_text = ""

    if st.button("Generate Blast", type="primary", key="blast_generate"):
        header = ""
        report_name = ""
        output_text = ""

        next_sections = ["Summary:", "Demand:", "Imports:", "Generation:", "Congestion:"]

        if blast_type == "Final Report":
            sids = {"Zone A Price": 6198, "Zone G Price": 6201, "Zone J Price": 30866, "Zone K Price": 30869}
            report_name = "Final"

            if date_choice == "Mon Final (upcoming Monday)":
                target_date = next_weekday(today, 0)
            else:
                target_date = today + timedelta(days=1)

            api_data = ep_calc_pull(target_date, target_date, sids)
            header = create_daily_blast_header(report_string, api_data, target_date, report_name)

        elif blast_type == "Preliminary Report":
            sids = {"Zone A Price": 6184, "Zone G Price": 6187, "Zone J Price": 31210, "Zone K Price": 31213}
            report_name = "Preliminary"

            if date_choice == "Tue Prelim (upcoming Tuesday)":
                target_date = next_weekday(today, 1)
            else:
                target_date = today + timedelta(days=2)

            api_data = ep_calc_pull(target_date, target_date, sids)
            header = create_daily_blast_header(report_string, api_data, target_date, report_name)

        else:
            sids = {"Zone A Price": 6184, "Zone G Price": 6187, "Zone J Price": 31210, "Zone K Price": 31213}
            report_name = "Weekend"

            days_to_sat = (5 - today.weekday()) % 7
            if days_to_sat == 0 and datetime.now().hour > 17:
                days_to_sat = 7
            sat = today + timedelta(days=days_to_sat)
            sun = today + timedelta(days=days_to_sat + 1)

            api_data = ep_calc_pull(sat, sun, sids)
            header, sat_d, sun_d = create_weekend_blast_header(report_string, api_data)

        gas_raw = extract_section_content(report_string, "Gas Assumptions", next_sections)
        gas_fmt = format_gas_block(gas_raw)

        summary = extract_section_content(report_string, "Summary:", next_sections)
        demand = extract_section_content(report_string, "Demand:", next_sections)
        congestion = extract_section_content(report_string, "Congestion:", next_sections)

        output_text = (
            header
            + "\n\n"
            + (gas_fmt or "")
            + "\n\nSummary:\n\n"
            + (summary or "")
            + "\n\nDemand:\n\n"
            + (demand or "")
            + "\n\nCongestion:\n\n"
            + (congestion or "")
        )

        st.session_state.blast_output_text = output_text
        st.success(f"{report_name} blast generated.")

    if st.session_state.blast_output_text:
        st.subheader("Copy / Paste Output")
        st.text_area(
            "Blast Text",
            value=st.session_state.blast_output_text,
            height=260,
            key="blast_copy_textarea",
        )


def powerbuyer():
    import os
    import sys
    import subprocess
    import streamlit as st

    def open_file_or_path(path):
        try:
            if not path or not os.path.exists(path):
                return False, f"Not found: {path}"

            if sys.platform.startswith("win"):
                os.startfile(path)
                return True, f"Opened: {path}"

            if sys.platform == "darwin":
                subprocess.run(["open", path], check=False)
                return True, f"Opened: {path}"

            subprocess.run(["xdg-open", path], check=False)
            return True, f"Opened: {path}"
        except Exception as e:
            return False, f"Could not open: {path}\n{e}"

    def execute_pb_script(script_name, docs_dir):
        pb_dir = os.path.join(docs_dir, "PowerBuyer")
        script_path = os.path.join(pb_dir, script_name)

        if not os.path.exists(script_path):
            return False, f"Script not found: {script_path}"

        try:
            r = subprocess.run(
                [sys.executable, script_path],
                cwd=pb_dir,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="ignore",
                check=True,
            )
            out = f"✅ Successfully executed {script_name}."
            if r.stdout and r.stdout.strip():
                out += f"\n\n--- stdout ---\n{r.stdout.strip()}"
            if r.stderr and r.stderr.strip():
                out += f"\n\n--- stderr ---\n{r.stderr.strip()}"
            return True, out
        except subprocess.CalledProcessError as e:
            msg = f"❌ Error executing {script_name}."
            if e.stdout and e.stdout.strip():
                msg += f"\n\n--- stdout ---\n{e.stdout.strip()}"
            if e.stderr and e.stderr.strip():
                msg += f"\n\n--- stderr ---\n{e.stderr.strip()}"
            return False, msg
        except Exception as e:
            return False, f"❌ Error executing {script_name}: {e}"

    def run_mon_thu(docs_dir):
        ok, msg = execute_pb_script("pullDailyEPCalcV1.py", docs_dir)
        if not ok:
            return msg
        xlsm = os.path.join(docs_dir, "PowerBuyer", "NYISO PowerBuyer 2019_Fix - Download & Upload Test.xlsm")
        ok2, msg2 = open_file_or_path(xlsm)
        return msg + ("\n\n" + msg2)

    def run_fri_step1(docs_dir):
        xlsm = os.path.join(docs_dir, "PowerBuyer", "PB SID Transfer for Mon-Tue Fix 3-24-2023.xlsm")
        ok, msg = open_file_or_path(xlsm)
        return ("✅ " if ok else "❌ ") + msg

    def run_fri_step2(docs_dir):
        ok, msg = execute_pb_script("pullDailyEPCalcV1.py", docs_dir)
        if not ok:
            return msg
        xlsm = os.path.join(docs_dir, "PowerBuyer", "NYISO PowerBuyer Mon-Tue Uploader Fix.xlsm")
        ok2, msg2 = open_file_or_path(xlsm)
        return msg + ("\n\n" + msg2)

    def pull_sids_only(docs_dir):
        ok, msg = execute_pb_script("pullDailyEPCalcV1.py", docs_dir)
        return msg

    st.subheader("PowerBuyer Automation")
    st.warning("These actions run local scripts and open local Excel files. This works only on your machine.")

    default_docs = os.path.join(os.getcwd(), "src/analyst_tool/utils/docs")
    docs_dir = st.text_input("Docs directory", value=default_docs, key="pb_docs_dir")

    if "pb_last_output" not in st.session_state:
        st.session_state.pb_last_output = ""

    st.subheader("Standard Process (Mon–Thu)")
    if st.button("Run Mon–Thu Process", type="primary", key="pb_mon_thu"):
        with st.spinner("Running..."):
            st.session_state.pb_last_output = run_mon_thu(docs_dir)

    st.subheader("Friday Process")
    c1, c2 = st.columns(2)
    with c1:
        if st.button("Run Step 1: Open SID Transfer", type="primary", key="pb_fri_step1"):
            st.session_state.pb_last_output = run_fri_step1(docs_dir)
    with c2:
        if st.button("Run Step 2: Pull Data & Open Uploader", type="primary", key="pb_fri_step2"):
            with st.spinner("Running..."):
                st.session_state.pb_last_output = run_fri_step2(docs_dir)

    st.subheader("Manual Data Pull")
    if st.button("Pull SIDs Only", type="primary", key="pb_sids_only"):
        with st.spinner("Running..."):
            st.session_state.pb_last_output = pull_sids_only(docs_dir)

    if st.session_state.pb_last_output:
        st.subheader("Output")
        st.text_area("Copy/Paste", value=st.session_state.pb_last_output, height=260, key="pb_out_area")


def coned_email_maker(api_key, final_report_text="", prelim_report_text="", weekend_report_text="", key_prefix="coned"):
    import streamlit as st
    import pandas as pd
    import requests
    import re
    import html as html_lib
    import pytz
    from datetime import date, datetime, timedelta

    API_URL = "https://api.genscape.com/power/epcalc/v1/getepcalcsiddata"
    API_KEY = api_key

    CONED_TO = (
        "PalevicL@coned.com; IMBURGIOF@coned.com; PHILIPST@coned.com; "
        "YONGJ@coned.com; MORGANK@coned.com; koselh@coned.com"
    )
    CONED_CC = (
        "arunika.chandra@woodmac.com; kate.abraimova@woodmac.com; max.mcdermott@woodmac.com; "
        "anmol.kud@woodmac.com; chaitanya.rawal@woodmac.com; rebekah.crouch@woodmac.com"
    )

    def is_dst_active(d):
        eastern = pytz.timezone("US/Eastern")
        dt = datetime.combine(d, datetime.min.time())
        return bool(eastern.localize(dt, is_dst=None).dst())

    def ep_calc_pull(start_d, end_d, sids_dict):
        if not API_KEY:
            st.error("Missing GEN_API_KEY (Streamlit secrets or env var).")
            return pd.DataFrame()

        params = {
            "sids": ",".join(str(v) for v in sids_dict.values()),
            "start_date": start_d.strftime("%Y-%m-%d"),
            "end_date": end_d.strftime("%Y-%m-%d"),
            "interval": "H",
            "standard_time": 0 if is_dst_active(start_d) else 1,
            "fill_type": 2,
            "orientation": "records",
        }
        headers = {"Accept": "application/json", "Gen-Api-Key": API_KEY}

        try:
            r = requests.get(API_URL, params=params, headers=headers, timeout=60)
            r.raise_for_status()
            df = pd.DataFrame(r.json())
            if df.empty:
                return pd.DataFrame()

            df["Date"] = pd.to_datetime(df["date"]).dt.date
            df["Hour"] = pd.to_datetime(df["date"]).dt.hour
            piv = df.pivot_table(index=["Date", "Hour"], columns="SensorID", values="Value").reset_index()
            id_map = {v: k for k, v in sids_dict.items()}
            piv.rename(columns=id_map, inplace=True)
            return piv
        except Exception as e:
            st.error(f"API pull failed: {e}")
            return pd.DataFrame()

    def extract_section(report_text, section_title, next_titles):
        try:
            m0 = re.search(rf"^{re.escape(section_title)}", report_text, re.MULTILINE | re.IGNORECASE)
            if not m0:
                return f"[{section_title} content not found]"
            start = m0.end()
            end = len(report_text)
            for nt in next_titles:
                m1 = re.search(rf"^{re.escape(nt)}", report_text[start:], re.MULTILINE | re.IGNORECASE)
                if m1:
                    end = min(end, start + m1.start())
            return report_text[start:end].strip()
        except Exception as e:
            return f"[Error extracting {section_title}: {e}]"

    def escape_html_content(text):
        if text is None or "[Not Found]" in str(text):
            return str(text)
        return html_lib.escape(str(text)).replace("\n", "<br>\n")

    def format_mw_gw(v):
        if v is None or (hasattr(pd, "isna") and pd.isna(v)):
            return "N/A"
        return f"{v / 1000.0:.1f} GW" if abs(v) >= 1000 else f"{v:.0f} MW"

    def create_regular_forecast_email(report_string, api_df):
        today = date.today()
        d1 = today + timedelta(days=1)
        d2 = today + timedelta(days=2)

        demand_opa = {"G": {"d1": None, "d2": None}, "J": {"d1": None, "d2": None}}
        prices = {"G": {}, "J": {}}

        if not api_df.empty:
            for day_obj, day_key in [(d1, "d1"), (d2, "d2")]:
                dd = api_df[api_df["Date"] == day_obj]
                if dd.empty:
                    continue
                onp = dd[(dd["Hour"] >= 7) & (dd["Hour"] <= 22)]
                for z in ["G", "J"]:
                    col = f"Zone {z} Demand Forecast"
                    if col in onp.columns and not onp[col].dropna().empty:
                        demand_opa[z][day_key] = round(onp[col].mean())

            dd2 = api_df[api_df["Date"] == d2]
            if not dd2.empty:
                onp2 = dd2[(dd2["Hour"] >= 7) & (dd2["Hour"] <= 22)]
                off2 = dd2[~dd2["Hour"].between(7, 22)]
                for z in ["G", "J"]:
                    pcol = f"Zone {z} Price Forecast"
                    if pcol in onp2.columns and not onp2[pcol].dropna().empty:
                        prices[z]["On"] = f"{onp2[pcol].mean():.2f}"
                    if pcol in off2.columns and not off2[pcol].dropna().empty:
                        prices[z]["Off"] = f"{off2[pcol].mean():.2f}"

        demand_parts = []
        for z in ["G", "J"]:
            d2v = demand_opa[z]["d2"]
            d1v = demand_opa[z]["d1"]
            if d2v is None or d1v is None:
                continue
            chg = d2v - d1v
            direction = "increase" if chg > 0 else "decrease"
            demand_parts.append(
                f"Zone {z} demand to {direction} by {format_mw_gw(abs(chg))} d/d to an OPA of {format_mw_gw(d2v)}"
            )
        demand_sentence = ("The ISO is forecasting " + " and ".join(demand_parts) + ".") if demand_parts else ""

        next_sections = ["Demand:", "Imports:", "Generation:", "Congestion:"]
        summary = escape_html_content(extract_section(report_string, "Summary:", next_sections))
        imports = escape_html_content(extract_section(report_string, "Imports:", next_sections))
        generation = escape_html_content(extract_section(report_string, "Generation:", next_sections))
        congestion = escape_html_content(extract_section(report_string, "Congestion:", next_sections))

        gas_prices = {
            name: price
            for name, price in re.findall(
                r"(Iroquois-Z2|Transco-Z6|TETCO M3|TGP-Z5):\s*\$(\d+\.\d+)", report_string
            )
        }

        subject = f"Forecast for {d2.month}/{d2.day}"
        body = f"""<p>Hello team,</p><p>Here is our forecast for {d2.month}/{d2.day}:</p>
<p><b>Summary:</b><br><br>{summary} {demand_sentence}</p>
<p><b>Imports:</b><br><br>{imports}</p>
<p><b>Generation:</b><br><br>{generation}</p>
<p><b>Congestion:</b><br><br>{congestion}</p>
<p><b>Gas Prices:</b><br><br>
<b>Iroquois-Z2:</b> ${gas_prices.get('Iroquois-Z2', 'N/A')}<br>
<b>Transco-Z6:</b> ${gas_prices.get('Transco-Z6', 'N/A')}<br>
<b>TETCO M3:</b> ${gas_prices.get('TETCO M3', 'N/A')}<br>
<b>TGP-Z5:</b> ${gas_prices.get('TGP-Z5', 'N/A')}</p>
<p><b>G/J Prices:</b><br><br>
<b>Zone G On-Peak:</b> $ {prices.get('G', {}).get('On', 'N/A')}<br>
<b>Zone G Off-Peak:</b> $ {prices.get('G', {}).get('Off', 'N/A')}<br>
<b>Zone J On-Peak:</b> $ {prices.get('J', {}).get('On', 'N/A')}<br>
<b>Zone J Off-Peak:</b> $ {prices.get('J', {}).get('Off', 'N/A')}</p>
<p>Best,</p><p>Devang</p>"""
        return f'<div style="font-family: Calibri, sans-serif; font-size: 11pt;">{body}</div>', subject

    def create_weekend_forecast_email(report_string, api_df, fri_d, sat_d, sun_d):
        demand_opa = {"G": {"Fri": None, "Sat": None, "Sun": None}, "J": {"Fri": None, "Sat": None, "Sun": None}}
        prices = {"G": {}, "J": {}}

        if not api_df.empty:
            for day_obj, day_str in [(fri_d, "Fri"), (sat_d, "Sat"), (sun_d, "Sun")]:
                dd = api_df[api_df["Date"] == day_obj]
                if dd.empty:
                    continue
                onp = dd[(dd["Hour"] >= 7) & (dd["Hour"] <= 22)]
                for z in ["G", "J"]:
                    dcol = f"Zone {z} Demand Forecast"
                    if dcol in onp.columns and not onp[dcol].dropna().empty:
                        demand_opa[z][day_str] = round(onp[dcol].mean())

                if day_str in ["Sat", "Sun"]:
                    offp = dd[~dd["Hour"].between(7, 22)]
                    for z in ["G", "J"]:
                        pcol = f"Zone {z} Price Forecast"
                        if pcol in onp.columns and not onp[pcol].dropna().empty:
                            prices[z][f"{day_str}_On"] = f"{onp[pcol].mean():.2f}"
                        if pcol in offp.columns and not offp[pcol].dropna().empty:
                            prices[z][f"{day_str}_Off"] = f"{offp[pcol].mean():.2f}"

        def demand_line(day_name, g_now, g_prev, j_now, j_prev):
            if g_now is None or g_prev is None or j_now is None or j_prev is None:
                return f"On {day_name}, Zone G and Zone J demand deltas were unavailable."
            g_chg = g_now - g_prev
            j_chg = j_now - j_prev
            g_dir = "increase" if g_chg > 0 else "decrease"
            j_dir = "increase" if j_chg > 0 else "decrease"
            return (
                f"On {day_name}, Zone G OPA demand is forecast to {g_dir} by {format_mw_gw(abs(g_chg))} d/d, "
                f"while Zone J is forecast to {j_dir} by {format_mw_gw(abs(j_chg))} d/d."
            )

        sat_str = demand_line("Saturday", demand_opa["G"]["Sat"], demand_opa["G"]["Fri"], demand_opa["J"]["Sat"],
                              demand_opa["J"]["Fri"])
        sun_str = demand_line("Sunday", demand_opa["G"]["Sun"], demand_opa["G"]["Sat"], demand_opa["J"]["Sun"],
                              demand_opa["J"]["Sat"])

        next_sections = ["Demand:", "Imports:", "Generation:", "Congestion:"]
        summary = escape_html_content(extract_section(report_string, "Summary:", next_sections))
        imports = escape_html_content(extract_section(report_string, "Imports:", next_sections))
        generation = escape_html_content(extract_section(report_string, "Generation:", next_sections))
        congestion = escape_html_content(extract_section(report_string, "Congestion:", next_sections))

        gas_prices = {
            name: price
            for name, price in re.findall(
                r"(Iroquois-Z2|Transco-Z6|TETCO M3|TGP-Z5):\s*\$(\d+\.\d+)", report_string
            )
        }

        subject = "Weekend Forecast"
        body = f"""<p>Hey team!</p><p>Here is our forecast for the weekend:</p>
<p><b>Summary:</b><br><br>{summary} {sat_str} {sun_str}</p>
<p><b>Imports:</b><br><br>{imports}</p>
<p><b>Generation:</b><br><br>{generation}</p>
<p><b>Congestion:</b><br><br>{congestion}</p>
<p><b>Gas Prices:</b><br><br>
<b>Iroquois-Z2:</b> ${gas_prices.get('Iroquois-Z2', 'N/A')}<br>
<b>Transco-Z6:</b> ${gas_prices.get('Transco-Z6', 'N/A')}<br>
<b>TETCO-M3:</b> ${gas_prices.get('TETCO M3', 'N/A')}<br>
<b>TGP-Z5:</b> ${gas_prices.get('TGP-Z5', 'N/A')}</p>
<p><b>Saturday Prices:</b><br><br>
<b>Zone G On-Peak:</b> $ {prices.get('G', {}).get('Sat_On', 'N/A')}<br>
<b>Zone G Off-Peak:</b> $ {prices.get('G', {}).get('Sat_Off', 'N/A')}<br>
<b>Zone J On-Peak:</b> $ {prices.get('J', {}).get('Sat_On', 'N/A')}<br>
<b>Zone J Off-Peak:</b> $ {prices.get('J', {}).get('Sat_Off', 'N/A')}</p>
<p><b>Sunday Prices:</b><br><br>
<b>Zone G On-Peak:</b> $ {prices.get('G', {}).get('Sun_On', 'N/A')}<br>
<b>Zone G Off-Peak:</b> $ {prices.get('G', {}).get('Sun_Off', 'N/A')}<br>
<b>Zone J On-Peak:</b> $ {prices.get('J', {}).get('Sun_On', 'N/A')}<br>
<b>Zone J Off-Peak:</b> $ {prices.get('J', {}).get('Sun_Off', 'N/A')}</p>
<p>Best,</p><p>Devang</p>"""
        return f'<div style="font-family: Calibri, sans-serif; font-size: 11pt;">{body}</div>', subject

    def create_mon_tue_forecast_email(mon_report, tue_report, dem_sun_mon, price_mon, dem_mon_tue, price_tue):
        today = datetime.now().date()
        days_to_mon = (0 - today.weekday() + 7) % 7 or 7
        mon_date = today + timedelta(days=days_to_mon)
        tue_date = today + timedelta(days=days_to_mon + 1)
        sun_date = today + timedelta(days=days_to_mon - 1)

        demand = {"G": {}, "J": {}}
        prices = {"G": {}, "J": {}}

        for day_obj, day_str, df in [
            (sun_date, "Sun", dem_sun_mon),
            (mon_date, "Mon", dem_sun_mon),
            (mon_date, "Mon", dem_mon_tue),
            (tue_date, "Tue", dem_mon_tue),
        ]:
            if df is None or df.empty:
                continue
            dd = df[df["Date"] == day_obj]
            if dd.empty:
                continue
            onp = dd[(dd["Hour"] >= 7) & (dd["Hour"] <= 22)]
            for z in ["G", "J"]:
                col = f"Zone {z} Demand Forecast"
                if col in onp.columns and not onp[col].dropna().empty:
                    demand[z][day_str] = round(onp[col].mean())

        for day_obj, day_str, df in [(mon_date, "Mon", price_mon), (tue_date, "Tue", price_tue)]:
            if df is None or df.empty:
                continue
            dd = df[df["Date"] == day_obj]
            if dd.empty:
                continue
            onp = dd[(dd["Hour"] >= 7) & (dd["Hour"] <= 22)]
            offp = dd[~dd["Hour"].between(7, 22)]
            for z in ["G", "J"]:
                col = f"Zone {z} Price"
                if col in onp.columns and not onp[col].dropna().empty:
                    prices[z][f"{day_str}_On"] = f"{onp[col].mean():.2f}"
                if col in offp.columns and not offp[col].dropna().empty:
                    prices[z][f"{day_str}_Off"] = f"{offp[col].mean():.2f}"

        def demand_delta_str(now_v, prev_v):
            if now_v is None or prev_v is None:
                return "N/A"
            chg = now_v - prev_v
            direction = "increase" if chg > 0 else "decrease"
            return f"{direction} by {format_mw_gw(abs(chg))} to an OPA of {format_mw_gw(now_v)}"

        mon_g = demand_delta_str(demand["G"].get("Mon"), demand["G"].get("Sun"))
        mon_j = demand_delta_str(demand["J"].get("Mon"), demand["J"].get("Sun"))
        tue_g = demand_delta_str(demand["G"].get("Tue"), demand["G"].get("Mon"))
        tue_j = demand_delta_str(demand["J"].get("Tue"), demand["J"].get("Mon"))

        next_sections = ["Demand:", "Imports:", "Generation:", "Congestion:"]
        mon_summary = escape_html_content(extract_section(mon_report, "Summary:", next_sections))
        mon_imports = escape_html_content(extract_section(mon_report, "Imports:", next_sections))
        mon_gen = escape_html_content(extract_section(mon_report, "Generation:", next_sections))
        mon_cong = escape_html_content(extract_section(mon_report, "Congestion:", next_sections))
        mon_gas = {n: p for n, p in re.findall(r"(Iroquois-Z2|Transco-Z6|TETCO M3|TGP-Z5):\s*\$(\d+\.\d+)", mon_report)}

        tue_summary = escape_html_content(extract_section(tue_report, "Summary:", next_sections))
        tue_imports = escape_html_content(extract_section(tue_report, "Imports:", next_sections))
        tue_gen = escape_html_content(extract_section(tue_report, "Generation:", next_sections))
        tue_cong = escape_html_content(extract_section(tue_report, "Congestion:", next_sections))
        tue_gas = {n: p for n, p in re.findall(r"(Iroquois-Z2|Transco-Z6|TETCO M3|TGP-Z5):\s*\$(\d+\.\d+)", tue_report)}

        subject = f"Forecast for {mon_date.month}/{mon_date.day} & {tue_date.month}/{tue_date.day}"
        body = f"""<p>Hi team,</p><p>Here is our forecast for Monday {mon_date.month}/{mon_date.day} and Tuesday {tue_date.month}/{tue_date.day}:</p>
<p><b>Monday</b></p>
<p><b>Summary:</b><br><br>{mon_summary}</p>
<p><b>Demand:</b><br><br>Zone G OPA demand is forecast to {mon_g}, whereas Zone J is expected to {mon_j}.</p>
<p><b>Imports:</b><br><br>{mon_imports}</p>
<p><b>Generation:</b><br><br>{mon_gen}</p>
<p><b>Congestion:</b><br><br>{mon_cong}</p>
<p><b>Gas Prices:</b><br><br>
<b>Iroquois-Z2:</b> ${mon_gas.get('Iroquois-Z2', 'N/A')}<br>
<b>Transco-Z6:</b> ${mon_gas.get('Transco-Z6', 'N/A')}<br>
<b>TETCO-M3:</b> ${mon_gas.get('TETCO M3', 'N/A')}<br>
<b>TGP-Z5:</b> ${mon_gas.get('TGP-Z5', 'N/A')}</p>
<p><b>G/J Prices:</b><br><br>
<b>Zone G On-Peak:</b> $ {prices.get('G', {}).get('Mon_On', 'N/A')}<br>
<b>Zone G Off-Peak:</b> $ {prices.get('G', {}).get('Mon_Off', 'N/A')}<br>
<b>Zone J On-Peak:</b> $ {prices.get('J', {}).get('Mon_On', 'N/A')}<br>
<b>Zone J Off-Peak:</b> $ {prices.get('J', {}).get('Mon_Off', 'N/A')}</p>

<p><b>Tuesday</b></p>
<p><b>Summary:</b><br><br>{tue_summary}</p>
<p><b>Demand:</b><br><br>Zone G OPA demand is forecast to {tue_g}, whereas Zone J is expected to {tue_j}.</p>
<p><b>Imports:</b><br><br>{tue_imports}</p>
<p><b>Generation:</b><br><br>{tue_gen}</p>
<p><b>Congestion:</b><br><br>{tue_cong}</p>
<p><b>Gas Prices:</b><br><br>
<b>Iroquois-Z2:</b> ${tue_gas.get('Iroquois-Z2', 'N/A')}<br>
<b>Transco-Z6:</b> ${tue_gas.get('Transco-Z6', 'N/A')}<br>
<b>TETCO-M3:</b> ${tue_gas.get('TETCO M3', 'N/A')}<br>
<b>TGP-Z5:</b> ${tue_gas.get('TGP-Z5', 'N/A')}</p>
<p><b>G/J Prices:</b><br><br>
<b>Zone G On-Peak:</b> $ {prices.get('G', {}).get('Tue_On', 'N/A')}<br>
<b>Zone G Off-Peak:</b> $ {prices.get('G', {}).get('Tue_Off', 'N/A')}<br>
<b>Zone J On-Peak:</b> $ {prices.get('J', {}).get('Tue_On', 'N/A')}<br>
<b>Zone J Off-Peak:</b> $ {prices.get('J', {}).get('Tue_Off', 'N/A')}</p>
<p>Best,</p><p>Devang</p>"""
        return f'<div style="font-family: Calibri, sans-serif; font-size: 11pt;">{body}</div>', subject

    def process_request(email_type, report_strings):
        today = date.today()

        if email_type == "Regular Forecast (D3)":
            report_string = report_strings["prelim report.txt"]
            sids = {
                "Zone G Demand Forecast": 4318,
                "Zone J Demand Forecast": 4321,
                "Zone G Price Forecast": 6187,
                "Zone J Price Forecast": 31210,
            }
            api_df = ep_calc_pull(today + timedelta(days=1), today + timedelta(days=2), sids)
            body, subject = create_regular_forecast_email(report_string, api_df)

        elif email_type == "Weekend Forecast":
            report_string = report_strings["weekend report.txt"]
            sids = {
                "Zone G Demand Forecast": 4318,
                "Zone J Demand Forecast": 4321,
                "Zone G Price Forecast": 6187,
                "Zone J Price Forecast": 31210,
            }
            days_to_fri = (4 - today.weekday() + 7) % 7
            fri = today + timedelta(days=days_to_fri)
            sat = today + timedelta(days=days_to_fri + 1)
            sun = today + timedelta(days=days_to_fri + 2)
            api_df = ep_calc_pull(fri, sun, sids)
            body, subject = create_weekend_forecast_email(report_string, api_df, fri, sat, sun)

        else:
            mon_report = report_strings["final report.txt"]
            tue_report = report_strings["prelim report.txt"]

            days_to_mon = (0 - today.weekday() + 7) % 7 or 7
            mon = today + timedelta(days=days_to_mon)
            tue = today + timedelta(days=days_to_mon + 1)
            sun = today + timedelta(days=days_to_mon - 1)

            dem_sids = {"Zone G Demand Forecast": 4318, "Zone J Demand Forecast": 4321}
            mon_price_sids = {"Zone G Price": 6201, "Zone J Price": 30866}
            tue_price_sids = {"Zone G Price": 6187, "Zone J Price": 31210}

            dem_sun_mon = ep_calc_pull(sun, mon, dem_sids)
            price_mon_df = ep_calc_pull(mon, mon, mon_price_sids)
            dem_mon_tue = ep_calc_pull(mon, tue, dem_sids)
            price_tue_df = ep_calc_pull(tue, tue, tue_price_sids)

            body, subject = create_mon_tue_forecast_email(
                mon_report, tue_report, dem_sun_mon, price_mon_df, dem_mon_tue, price_tue_df
            )

        if body and subject:
            return {"subject": subject, "body": body, "to": CONED_TO, "cc": CONED_CC}
        return None

    st.subheader("ConEd Email Maker")
    st.markdown("Generate full email template for target report to send to ConED.")

    email_type = st.radio(
        "Select Email Type",
        ["Regular Forecast (D3)", "Weekend Forecast", "Mon/Tue Forecast"],
        horizontal=True,
        key=f"{key_prefix}_type",
    )

    report_map = {
        "Regular Forecast (D3)": {"prelim report.txt": prelim_report_text},
        "Weekend Forecast": {"weekend report.txt": weekend_report_text},
        "Mon/Tue Forecast": {"final report.txt": final_report_text, "prelim report.txt": prelim_report_text},
    }

    st.subheader("Report Content (Editable)")
    report_strings = {}
    for filename, content in report_map[email_type].items():
        report_strings[filename] = st.text_area(
            f"Content for {filename}",
            content or "",
            height=200,
            key=f"{key_prefix}_{email_type}_{filename}",
        )

    if st.button("Generate Email Content", type="primary", key=f"{key_prefix}_generate"):
        with st.spinner("Generating email..."):
            out = process_request(email_type, report_strings)
            if out:
                st.session_state[f"{key_prefix}_email"] = out
                st.success("Email generated.")
            else:
                st.session_state[f"{key_prefix}_email"] = None
                st.error("Email not generated.")

    out = st.session_state.get(f"{key_prefix}_email")
    st.divider()
    if out:
        st.text_input("To:", value=out["to"], key=f"{key_prefix}_to")
        st.text_input("CC:", value=out["cc"], key=f"{key_prefix}_cc")
        st.text_input("Subject:", value=out["subject"], key=f"{key_prefix}_subject")

        st.markdown("---")
        full_html = f"<html><head><title>{html_lib.escape(out['subject'])}</title></head><body>{out['body']}</body></html>"

        st.markdown(
            f"""
            <div style="background-color:white;color:black;border:1px solid #ddd;padding:15px;border-radius:5px;">
                {out['body']}
            </div>
            """,
            unsafe_allow_html=True,
        )

        st.markdown("---")
        st.download_button(
            label="Download Email as HTML",
            data=full_html,
            file_name=f"{out['subject'].replace(' ', '_')}.html",
            mime="text/html",
            key=f"{key_prefix}_dl_html",
        )

# </editor-fold>


# <editor-fold desc="Research Tools">
def render_constraint_impact_tool(embedded=False, key_prefix="cit"):
    import os, re, time, zipfile, warnings
    from datetime import date, datetime, timedelta

    import pandas as pd
    import requests
    import streamlit as st
    import urllib3

    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    warnings.filterwarnings("ignore", category=urllib3.exceptions.InsecureRequestWarning)

    URL_PATTERNS = {
        "da": {
            "constraints": "https://mis.nyiso.com/public/csv/DAMLimitingConstraints/",
            "prices": "https://mis.nyiso.com/public/csv/damlbmp/",
        },
        "rt": {
            "constraints": "https://mis.nyiso.com/public/csv/LimitingConstraints/",
            "prices": "https://mis.nyiso.com/public/csv/rtlbmp/",
        },
    }

    ZIP_NAME_PATTERNS = {
        "da": {
            "constraints": "DAMLimitingConstraints_csv.zip",
            "zonal": "damlbmp_zone_csv.zip",
            "generator": "damlbmp_gen_csv.zip",
        },
        "rt": {
            "constraints": "LimitingConstraints_csv.zip",
            "zonal": "rtlbmp_zone_csv.zip",
            "generator": "rtlbmp_gen_csv.zip",
        },
    }

    RENAME_MAP = {
        "Time Stamp": "time",
        "Limiting Facility": "monitoredElement",
        "Contingency": "contingency",
        "Constraint Cost($)": "constraintCost",
        "Name": "name",
        "LBMP ($/MWHr)": "lbmp",
        "Marginal Cost Losses ($/MWHr)": "mlc",
        "Marginal Cost Congestion ($/MWHr)": "mcc",
    }

    try:
        app_dir = os.path.dirname(os.path.abspath(__file__))
    except Exception:
        app_dir = os.getcwd()

    cache_dir = os.path.join(app_dir, "nyiso_data_cache")
    raw_zip_root = os.path.join(cache_dir, "raw")

    da_constraint_cache = os.path.join(cache_dir, "da_constraints.parquet")
    da_zonal_cache = os.path.join(cache_dir, "da_zonal_prices.parquet")
    da_gen_cache = os.path.join(cache_dir, "da_generator_prices.parquet")

    rt_constraint_cache = os.path.join(cache_dir, "rt_constraints.parquet")
    rt_zonal_cache = os.path.join(cache_dir, "rt_zonal_prices.parquet")
    rt_gen_cache = os.path.join(cache_dir, "rt_generator_prices.parquet")

    data_loaded_key = f"{key_prefix}_data_loaded"
    precomp_done_key = f"{key_prefix}_precomp_done"
    precomp_key = f"{key_prefix}_precomputed"

    if data_loaded_key not in st.session_state:
        st.session_state[data_loaded_key] = False
    if precomp_done_key not in st.session_state:
        st.session_state[precomp_done_key] = False
    if precomp_key not in st.session_state:
        st.session_state[precomp_key] = {}

    def ensure_dirs():
        os.makedirs(cache_dir, exist_ok=True)
        for m in ["da", "rt"]:
            for dt in ["constraints", "zonal", "generator"]:
                os.makedirs(os.path.join(raw_zip_root, m, dt), exist_ok=True)

    def month_keys(start_dt, end_dt):
        if start_dt > end_dt:
            return []
        cur = date(start_dt.year, start_dt.month, 1)
        out = []
        while cur <= end_dt:
            out.append(cur.strftime("%Y%m"))
            if cur.month == 12:
                cur = date(cur.year + 1, 1, 1)
            else:
                cur = date(cur.year, cur.month + 1, 1)
        return out

    def get_date_range(start_dt, end_dt):
        if start_dt > end_dt:
            return []
        return [(start_dt + timedelta(days=i)).strftime("%Y%m%d") for i in range((end_dt - start_dt).days + 1)]

    def raw_zip_path(market, data_type, yyyymm):
        return os.path.join(raw_zip_root, market, data_type, f"{yyyymm}.zip")

    def zip_url(market, data_type, yyyymm):
        base = URL_PATTERNS[market]["constraints"] if data_type == "constraints" else URL_PATTERNS[market]["prices"]
        zip_name = ZIP_NAME_PATTERNS[market][data_type]
        return f"{base}{yyyymm}01{zip_name}"

    def safe_read_csv_from_zip(zf, member):
        try:
            with zf.open(member) as f:
                return pd.read_csv(f, low_memory=False)
        except Exception:
            return None

    def fetch_data_from_nyiso(start_dt, end_dt, market, data_type, log):
        wanted_dates = set(get_date_range(start_dt, end_dt))
        if not wanted_dates:
            return pd.DataFrame()

        all_parts = []
        months = month_keys(start_dt, end_dt)

        for i, yyyymm in enumerate(months, start=1):
            zp = raw_zip_path(market, data_type, yyyymm)
            url = zip_url(market, data_type, yyyymm)
            label = f"({i}/{len(months)}) {market.upper()} {data_type} {yyyymm}"

            zf = None
            if os.path.isfile(zp) and os.path.getsize(zp) > 0:
                log(f"{label} - cached ZIP")
                try:
                    zf = zipfile.ZipFile(zp)
                except Exception:
                    zf = None

            if zf is None:
                log(f"{label} - downloading...")
                try:
                    r = requests.get(url, timeout=120, verify=False)
                    r.raise_for_status()
                    with open(zp, "wb") as out:
                        out.write(r.content)
                    zf = zipfile.ZipFile(zp)
                except requests.exceptions.HTTPError as e:
                    code = None
                    try:
                        code = e.response.status_code
                    except Exception:
                        pass
                    log(f"  - not posted / HTTP {code}")
                    continue
                except Exception as e:
                    log(f"  - download error: {e}")
                    continue

            try:
                for member in zf.namelist():
                    m = re.search(r"(\d{8})", member)
                    if not m:
                        continue
                    if m.group(1) not in wanted_dates:
                        continue
                    part = safe_read_csv_from_zip(zf, member)
                    if part is not None and not part.empty:
                        all_parts.append(part)
                zf.close()
            except Exception as e:
                log(f"  - ZIP read error: {e}")

            time.sleep(0.03)

        if not all_parts:
            return pd.DataFrame()

        return pd.concat(all_parts, ignore_index=True)

    def standardize_and_clean(df, newly_fetched=False):
        if df is None or df.empty:
            return pd.DataFrame()

        if newly_fetched:
            df = df.rename(columns=RENAME_MAP)

            for col in ["constraintCost", "lbmp", "mcl", "mcc"]:
                if col in df.columns:
                    df[col] = df[col].astype(str)
                    df[col] = pd.to_numeric(df[col].str.replace(",", "", regex=False), errors="coerce")

            if "time" in df.columns:
                df["time"] = pd.to_datetime(df["time"], errors="coerce")

        if "time" in df.columns:
            df = df.dropna(subset=["time"])

        if "name" in df.columns:
            dedupe_cols = ["time", "name"]
        else:
            dedupe_cols = ["time", "monitoredElement", "contingency"]

        dedupe_cols = [c for c in dedupe_cols if c in df.columns]
        if dedupe_cols:
            df = (
                df.dropna(subset=dedupe_cols)
                .drop_duplicates(subset=dedupe_cols, keep="last")
                .sort_values("time")
                .reset_index(drop=True)
            )

        return df

    def update_cache_parquet(cache_file, market, data_type, start_dt, end_dt, log):
        ensure_dirs()

        existing = pd.DataFrame()
        last_cached = None

        if os.path.exists(cache_file):
            log(f"Loading cache: {os.path.basename(cache_file)}")
            try:
                existing = pd.read_parquet(cache_file)
                if not existing.empty and "time" in existing.columns:
                    last_cached = existing["time"].max().date()
                    log(f"  - last cached date: {last_cached}")
            except Exception as e:
                log(f"  - could not read Parquet (need pyarrow): {e}")
                existing = pd.DataFrame()

        fetch_start = (last_cached + timedelta(days=1)) if last_cached else start_dt

        if fetch_start <= end_dt:
            log(f"Fetching: {fetch_start} -> {end_dt}")
            new_df = fetch_data_from_nyiso(fetch_start, end_dt, market, data_type, log)
            if new_df is not None and not new_df.empty:
                new_df = standardize_and_clean(new_df, newly_fetched=True)
                combined = pd.concat([existing, new_df], ignore_index=True) if not existing.empty else new_df

                if "name" in combined.columns:
                    combined = combined.drop_duplicates(subset=["time", "name"], keep="last")
                else:
                    combined = combined.drop_duplicates(subset=["time", "monitoredElement", "contingency"], keep="last")

                try:
                    combined.to_parquet(cache_file, index=False)
                    log(f"Saved: {os.path.basename(cache_file)} (+{len(new_df):,} rows)")
                except Exception as e:
                    log(f"  - could not write Parquet (need pyarrow): {e}")

                return combined

        log(f"Up to date: {os.path.basename(cache_file)}")
        return existing

    @st.cache_data(show_spinner=False)
    def precompute_all_impacts(constraints_df, zonal_prices_df, gen_prices_df):
        if constraints_df is None or zonal_prices_df is None or gen_prices_df is None:
            return None
        if constraints_df.empty or zonal_prices_df.empty or gen_prices_df.empty:
            return None
        if "time" not in constraints_df.columns or "constraintCost" not in constraints_df.columns:
            return None

        counts = constraints_df["time"].value_counts()
        isolated_ts = counts[counts == 1].index
        isolated = constraints_df[constraints_df["time"].isin(isolated_ts)].copy()

        isolated = isolated.dropna(subset=["constraintCost"])
        isolated = isolated[isolated["constraintCost"].abs() > 0.01]
        if isolated.empty:
            return None

        all_prices = pd.concat([zonal_prices_df, gen_prices_df], ignore_index=True)
        merged = pd.merge(all_prices, isolated[["time", "constraintCost"]], on="time", how="inner")
        if merged.empty or "mcc" not in merged.columns:
            return None

        merged["shiftFactor"] = -merged["mcc"] / merged["constraintCost"]

        zonal_names = set(zonal_prices_df["name"].dropna().unique()) if "name" in zonal_prices_df.columns else set()
        if "name" in merged.columns:
            zonal_mask = merged["name"].isin(zonal_names)
        else:
            zonal_mask = pd.Series([False] * len(merged))

        zonal_impacts = {ts: df for ts, df in merged[zonal_mask].groupby("time")}
        gen_impacts = {ts: df for ts, df in merged[~zonal_mask].groupby("time")}

        return {
            "isolated_constraints": isolated[isolated["time"].isin(merged["time"].unique())].copy(),
            "zonal_impacts": zonal_impacts,
            "generator_impacts": gen_impacts,
        }

    def style_results_table(df, shift_col="Shift Factor", mcc_col="MCC", lmp_col="LMP"):
        if df is None or df.empty:
            return df

        formats = {}
        if shift_col in df.columns:
            formats[shift_col] = "{:.4f}"
        if mcc_col in df.columns:
            formats[mcc_col] = "{:.2f}"
        if lmp_col in df.columns:
            formats[lmp_col] = "{:.2f}"

        styler = df.style.format(formats)

        try:
            if shift_col in df.columns and pd.api.types.is_numeric_dtype(df[shift_col]):
                v = df[shift_col].abs().max()
                v = v if pd.notna(v) and v > 0 else 1.0
                styler = styler.background_gradient(cmap="RdYlGn", subset=[shift_col], vmin=-v, vmax=v)

            if mcc_col in df.columns and pd.api.types.is_numeric_dtype(df[mcc_col]):
                v = df[mcc_col].abs().max()
                v = v if pd.notna(v) and v > 0 else 1.0
                styler = styler.background_gradient(cmap="RdYlGn", subset=[mcc_col], vmin=-v, vmax=v)

            if lmp_col in df.columns and pd.api.types.is_numeric_dtype(df[lmp_col]):
                styler = styler.background_gradient(cmap="viridis", subset=[lmp_col])
        except Exception:
            pass

        return styler

    def do_precompute():
        da = precompute_all_impacts(
            st.session_state.get(f"{key_prefix}_da_constraints_df"),
            st.session_state.get(f"{key_prefix}_da_zonal_df"),
            st.session_state.get(f"{key_prefix}_da_gen_df"),
        )
        rt = precompute_all_impacts(
            st.session_state.get(f"{key_prefix}_rt_constraints_df"),
            st.session_state.get(f"{key_prefix}_rt_zonal_df"),
            st.session_state.get(f"{key_prefix}_rt_gen_df"),
        )
        st.session_state[precomp_key] = {"da": da, "rt": rt}
        st.session_state[precomp_done_key] = True

    if not embedded:
        st.set_page_config(page_title="Constraint Impact Tool", layout="wide")
        st.title("Constraint Impact Tool")

    left, right = st.columns(2, gap="large")

    with left:
        st.subheader("Refresh data")

        if st.button("Load / Update Data Cache", type="primary", key=f"{key_prefix}_load"):
            with st.status("Updating caches...", expanded=True) as status:
                def log(msg):
                    st.write(msg)
                    status.update(label=msg)

                end_dt = date.today()
                start_dt = end_dt - timedelta(days=365 * 5)

                st.session_state[f"{key_prefix}_da_constraints_df"] = update_cache_parquet(
                    da_constraint_cache, "da", "constraints", start_dt, end_dt, log
                )
                st.session_state[f"{key_prefix}_da_zonal_df"] = update_cache_parquet(
                    da_zonal_cache, "da", "zonal", start_dt, end_dt, log
                )
                st.session_state[f"{key_prefix}_da_gen_df"] = update_cache_parquet(
                    da_gen_cache, "da", "generator", start_dt, end_dt, log
                )

                st.session_state[f"{key_prefix}_rt_constraints_df"] = update_cache_parquet(
                    rt_constraint_cache, "rt", "constraints", start_dt, end_dt, log
                )
                st.session_state[f"{key_prefix}_rt_zonal_df"] = update_cache_parquet(
                    rt_zonal_cache, "rt", "zonal", start_dt, end_dt, log
                )
                st.session_state[f"{key_prefix}_rt_gen_df"] = update_cache_parquet(
                    rt_gen_cache, "rt", "generator", start_dt, end_dt, log
                )

                st.session_state[data_loaded_key] = True
                st.session_state[precomp_done_key] = False
                st.session_state[precomp_key] = {}
                status.update(label="Caches updated", state="complete", expanded=False)

            with st.spinner("Pre-computing impacts..."):
                do_precompute()

        if st.session_state.get(data_loaded_key) and not st.session_state.get(precomp_done_key):
            with st.spinner("Pre-computing impacts..."):
                do_precompute()

        if st.session_state.get(precomp_done_key):
            st.caption("Ready.")

    with right:
        st.subheader("Constraint impact")

        if not st.session_state.get(precomp_done_key):
            st.info("Load / update cache to begin.")
            return

        market_choice = st.radio(
            "Market",
            ["Day-Ahead (DA)", "Real-Time (RT)"],
            horizontal=True,
            key=f"{key_prefix}_market",
        )
        market = "da" if market_choice.startswith("Day-Ahead") else "rt"

        market_data = st.session_state[precomp_key].get(market)
        if not market_data or market_data.get("isolated_constraints") is None or market_data[
            "isolated_constraints"].empty:
            st.warning("No isolated constraint prints available for this market.")
            return

        isolated = market_data["isolated_constraints"]
        elems = sorted(isolated["monitoredElement"].dropna().unique()) if "monitoredElement" in isolated.columns else []
        if not elems:
            st.warning("No monitored elements found.")
            return

        c1, c2, c3 = st.columns(3)
        with c1:
            selected_element = st.selectbox("Monitored element", elems, key=f"{key_prefix}_elem")

        conts = []
        if selected_element and "contingency" in isolated.columns:
            conts = sorted(isolated[isolated["monitoredElement"] == selected_element]["contingency"].dropna().unique())

        with c2:
            selected_cont = st.selectbox("Contingency", conts, key=f"{key_prefix}_cont") if conts else None

        ts_list = []
        if selected_element and selected_cont:
            m = (isolated["monitoredElement"] == selected_element) & (isolated["contingency"] == selected_cont)
            ts_list = list(isolated.loc[m, "time"].sort_values(ascending=False).unique())

        with c3:
            selected_ts = None
            if ts_list:
                selected_ts = st.selectbox(
                    "Clean print (timestamp)",
                    ts_list,
                    format_func=lambda x: x.strftime("%Y-%m-%d %H:%M:%S") if hasattr(x, "strftime") else str(x),
                    key=f"{key_prefix}_ts",
                )

    if not st.session_state.get(precomp_done_key):
        return

    market_choice = st.session_state.get(f"{key_prefix}_market", "Day-Ahead (DA)")
    market = "da" if str(market_choice).startswith("Day-Ahead") else "rt"
    market_data = st.session_state[precomp_key].get(market)

    selected_ts = st.session_state.get(f"{key_prefix}_ts")
    if not market_data or selected_ts is None:
        return

    zonal_data = market_data["zonal_impacts"].get(selected_ts)
    gen_data = market_data["generator_impacts"].get(selected_ts)

    st.subheader("Results")

    t1, t2 = st.tabs(["Zonal impacts", "Generator impacts"])

    with t1:
        if zonal_data is None or zonal_data.empty:
            st.info("No zonal price rows for this timestamp.")
        else:
            df = zonal_data.rename(
                columns={"name": "Zone", "lbmp": "LMP", "mcc": "MCC", "shiftFactor": "Shift Factor"}
            ).copy()
            if "MCC" in df.columns:
                df["Signal"] = df["MCC"].apply(lambda v: "Bullish" if v < 0 else "Bearish" if v > 0 else "Neutral")
            show_cols = [c for c in ["Zone", "LMP", "Shift Factor", "MCC", "Signal"] if c in df.columns]
            df = df[show_cols].sort_values("Zone")
            st.dataframe(style_results_table(df))

    with t2:
        if gen_data is None or gen_data.empty:
            st.info("No generator price rows for this timestamp.")
        else:
            df = gen_data.rename(
                columns={"name": "Generator", "lbmp": "LMP", "mcc": "MCC", "shiftFactor": "Shift Factor"}
            ).copy()
            if "MCC" in df.columns:
                df["Source/Sink"] = df["MCC"].apply(lambda v: "Sink" if v < 0 else "Source" if v > 0 else "Neutral")
            show_cols = [c for c in ["Generator", "LMP", "Shift Factor", "MCC", "Source/Sink"] if c in df.columns]
            df = df[show_cols].sort_values("LMP", ascending=False) if "LMP" in df.columns else df[show_cols]
            st.dataframe(style_results_table(df))


def render_market_analysis_tool(embedded=False, key_prefix="mat"):
    import os
    import re
    import time
    import zipfile
    import warnings
    from datetime import date, timedelta

    import pandas as pd
    import requests
    import streamlit as st
    import urllib3
    import plotly.express as px

    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    warnings.filterwarnings("ignore", category=urllib3.exceptions.InsecureRequestWarning)

    URL_PATTERNS = {
        "da": {
            "constraints": "https://mis.nyiso.com/public/csv/DAMLimitingConstraints/",
            "prices": "https://mis.nyiso.com/public/csv/damlbmp/",
        },
        "rt": {
            "constraints": "https://mis.nyiso.com/public/csv/LimitingConstraints/",
            "prices": "https://mis.nyiso.com/public/csv/rtlbmp/",
        },
    }

    ZIP_NAME_PATTERNS = {
        "da": {
            "constraints": "DAMLimitingConstraints_csv.zip",
            "generator": "damlbmp_gen_csv.zip",
        },
        "rt": {
            "constraints": "LimitingConstraints_csv.zip",
            "generator": "rtlbmp_gen_csv.zip",
        },
    }

    RENAME_MAP = {
        "Time Stamp": "time",
        "Limiting Facility": "monitoredElement",
        "Contingency": "contingency",
        "Constraint Cost($)": "constraintCost",
        "Name": "name",
        "LBMP ($/MWHr)": "lbmp",
        "Marginal Cost Losses ($/MWHr)": "mlc",
        "Marginal Cost Congestion ($/MWHr)": "mcc",
    }

    try:
        app_dir = os.path.dirname(os.path.abspath(__file__))
    except Exception:
        app_dir = os.getcwd()

    cache_dir = os.path.join(app_dir, "nyiso_data_cache")
    raw_zip_root = os.path.join(cache_dir, "raw")

    da_constraint_cache = os.path.join(cache_dir, "da_constraints.parquet")
    da_gen_cache = os.path.join(cache_dir, "da_generator_prices.parquet")

    rt_constraint_cache = os.path.join(cache_dir, "rt_constraints.parquet")
    rt_gen_cache = os.path.join(cache_dir, "rt_generator_prices.parquet")

    data_loaded_key = f"{key_prefix}_data_loaded"

    if data_loaded_key not in st.session_state:
        st.session_state[data_loaded_key] = False

    def ensure_dirs():
        os.makedirs(cache_dir, exist_ok=True)
        for m in ["da", "rt"]:
            for dt in ["constraints", "generator"]:
                os.makedirs(os.path.join(raw_zip_root, m, dt), exist_ok=True)

    def month_keys(start_dt, end_dt):
        if start_dt > end_dt:
            return []
        cur = date(start_dt.year, start_dt.month, 1)
        out = []
        while cur <= end_dt:
            out.append(cur.strftime("%Y%m"))
            if cur.month == 12:
                cur = date(cur.year + 1, 1, 1)
            else:
                cur = date(cur.year, cur.month + 1, 1)
        return out

    def get_date_range(start_dt, end_dt):
        if start_dt > end_dt:
            return []
        return [(start_dt + timedelta(days=i)).strftime("%Y%m%d") for i in range((end_dt - start_dt).days + 1)]

    def raw_zip_path(market, data_type, yyyymm):
        return os.path.join(raw_zip_root, market, data_type, f"{yyyymm}.zip")

    def zip_url(market, data_type, yyyymm):
        base = URL_PATTERNS[market]["constraints"] if data_type == "constraints" else URL_PATTERNS[market]["prices"]
        zip_name = ZIP_NAME_PATTERNS[market][data_type]
        return f"{base}{yyyymm}01{zip_name}"

    def safe_read_csv_from_zip(zf, member):
        try:
            with zf.open(member) as f:
                return pd.read_csv(f, low_memory=False)
        except Exception:
            return None

    def fetch_data_from_nyiso(start_dt, end_dt, market, data_type, log):
        wanted_dates = set(get_date_range(start_dt, end_dt))
        if not wanted_dates:
            return pd.DataFrame()

        all_parts = []
        months = month_keys(start_dt, end_dt)

        for i, yyyymm in enumerate(months, start=1):
            zp = raw_zip_path(market, data_type, yyyymm)
            url = zip_url(market, data_type, yyyymm)
            label = f"({i}/{len(months)}) {market.upper()} {data_type} {yyyymm}"

            zf = None
            if os.path.isfile(zp) and os.path.getsize(zp) > 0:
                log(f"{label} - cached ZIP")
                try:
                    zf = zipfile.ZipFile(zp)
                except Exception:
                    zf = None

            if zf is None:
                log(f"{label} - downloading...")
                try:
                    r = requests.get(url, timeout=120, verify=False)
                    r.raise_for_status()
                    with open(zp, "wb") as out:
                        out.write(r.content)
                    zf = zipfile.ZipFile(zp)
                except requests.exceptions.HTTPError as e:
                    pass
                    continue
                except Exception as e:
                    log(f"  - download error: {e}")
                    continue

            try:
                for member in zf.namelist():
                    m = re.search(r"(\d{8})", member)
                    if not m:
                        continue
                    if m.group(1) not in wanted_dates:
                        continue
                    part = safe_read_csv_from_zip(zf, member)
                    if part is not None and not part.empty:
                        all_parts.append(part)
                zf.close()
            except Exception as e:
                log(f"  - ZIP read error: {e}")

            time.sleep(0.03)

        if not all_parts:
            return pd.DataFrame()

        return pd.concat(all_parts, ignore_index=True)

    def standardize_and_clean(df, newly_fetched=False):
        if df is None or df.empty:
            return pd.DataFrame()

        if newly_fetched:
            df = df.rename(columns=RENAME_MAP)

            for col in ["constraintCost", "lbmp", "mlc", "mcc"]:
                if col in df.columns:
                    df[col] = df[col].astype(str)
                    df[col] = pd.to_numeric(df[col].str.replace(",", "", regex=False), errors="coerce")

            if "time" in df.columns:
                df["time"] = pd.to_datetime(df["time"], errors="coerce")

        if "time" in df.columns:
            df = df.dropna(subset=["time"])

        if "name" in df.columns:
            dedupe_cols = ["time", "name"]
        else:
            dedupe_cols = ["time", "monitoredElement", "contingency"]

        dedupe_cols = [c for c in dedupe_cols if c in df.columns]
        if dedupe_cols:
            df = (
                df.dropna(subset=dedupe_cols)
                .drop_duplicates(subset=dedupe_cols, keep="last")
                .sort_values("time")
                .reset_index(drop=True)
            )

        return df

    def update_cache_parquet(cache_file, market, data_type, start_dt, end_dt, log):
        ensure_dirs()
        existing = pd.DataFrame()

        if os.path.exists(cache_file):
            log(f"Checking cache: {os.path.basename(cache_file)}")
            try:
                existing = pd.read_parquet(cache_file)
            except Exception as e:
                log(f"  - could not read Parquet: {e}")
                existing = pd.DataFrame()

        missing_ranges = []
        if existing.empty or "time" not in existing.columns:
            missing_ranges.append((start_dt, end_dt))
        else:
            first_cached = existing["time"].min().date()
            last_cached = existing["time"].max().date()

            # Check if we need to backfill older data
            if start_dt < first_cached:
                missing_ranges.append((start_dt, first_cached - timedelta(days=1)))

            # Check if we need to fetch newer data
            if end_dt > last_cached:
                missing_ranges.append((last_cached + timedelta(days=1), end_dt))

        new_data_fetched = False
        for m_start, m_end in missing_ranges:
            if m_start <= m_end:
                log(f"Fetching: {m_start} to {m_end}")
                new_df = fetch_data_from_nyiso(m_start, m_end, market, data_type, log)
                if new_df is not None and not new_df.empty:
                    new_df = standardize_and_clean(new_df, newly_fetched=True)
                    existing = pd.concat([existing, new_df], ignore_index=True) if not existing.empty else new_df
                    new_data_fetched = True

        if new_data_fetched:
            if "name" in existing.columns:
                existing = existing.drop_duplicates(subset=["time", "name"], keep="last")
            else:
                existing = existing.drop_duplicates(subset=["time", "monitoredElement", "contingency"], keep="last")

            existing = existing.sort_values("time").reset_index(drop=True)

            try:
                existing.to_parquet(cache_file, index=False)
                log(f"Saved updated cache: {os.path.basename(cache_file)}")
            except Exception as e:
                log(f"  - could not write Parquet: {e}")
        else:
            if not missing_ranges:
                log(f"Up to date. No new fetch needed.")

        return existing

    # --- UI Setup ---
    if not embedded:
        st.set_page_config(page_title="Market Data Tool", layout="wide")
        st.title("NYISO Market Analysis Tool")

    st.divider()

    if not st.session_state.get(data_loaded_key):
        st.info("Please select a date range and click 'Fetch Data' to begin.")
        return

    tab1, tab2, tab3 = st.tabs(["Constraint Analysis", "Generator Analysis", "CIT"])

    # --- TAB 1: CONSTRAINT ANALYSIS ---
    with tab1:
        st.subheader("Constraint & Contingency Costs")

        today = date.today()
        left, right = st.columns(2)
        with left:
            start = st.date_input("Enter a start date", value=today - timedelta(days=7), key=9335)
        with right:
            end = st.date_input("Enter an end date", value=today, key=3843)
        if st.button("Fetch Data", type="primary", key=f"{key_prefix}_load"):
            with st.status("Updating caches...", expanded=True) as status:
                def log(msg):
                    st.write(msg)
                    status.update(label=msg)

                st.session_state[f"{key_prefix}_da_constraints_df"] = update_cache_parquet(
                    da_constraint_cache, "da", "constraints", start, end, log
                )
                st.session_state[f"{key_prefix}_da_gen_df"] = update_cache_parquet(
                    da_gen_cache, "da", "generator", start, end, log
                )
                st.session_state[f"{key_prefix}_rt_constraints_df"] = update_cache_parquet(
                    rt_constraint_cache, "rt", "constraints", start, end, log
                )
                st.session_state[f"{key_prefix}_rt_gen_df"] = update_cache_parquet(
                    rt_gen_cache, "rt", "generator", start, end, log
                )

                st.session_state[data_loaded_key] = True
                status.update(label="Data loaded successfully", state="complete", expanded=False)

        c_market = st.radio("Select Market:", ["DA", "RT"], horizontal=True, key=f"{key_prefix}_c_market").lower()
        raw_const = st.session_state.get(f"{key_prefix}_{c_market}_constraints_df")

        if raw_const is not None and not raw_const.empty:
            df_const = raw_const[(raw_const['time'].dt.date >= start) & (raw_const['time'].dt.date <= end)]

            elems = sorted(df_const["monitoredElement"].dropna().unique())
            col1, col2 = st.columns(2)

            with col1:
                selected_elem = st.selectbox("Monitored Element", elems, key=f"{key_prefix}_c_elem")

            conts = sorted(df_const[df_const["monitoredElement"] == selected_elem][
                               "contingency"].dropna().unique()) if selected_elem else []

            with col2:
                selected_cont = st.selectbox("Contingency", conts, key=f"{key_prefix}_c_cont")

            if selected_elem and selected_cont:
                filtered_const = df_const[
                    (df_const["monitoredElement"] == selected_elem) & (df_const["contingency"] == selected_cont)]
                filtered_const = filtered_const.sort_values("time")

                if not filtered_const.empty:
                    fig_const = px.bar(
                        filtered_const,
                        x="time",
                        y="constraintCost",
                        title=f"Constraint Cost for {selected_elem} / {selected_cont} ({c_market.upper()})",
                        labels={"time": "Time", "constraintCost": "Constraint Cost ($)"}
                    )
                    st.plotly_chart(fig_const, use_container_width=True)

                    st.dataframe(
                        filtered_const[["time", "monitoredElement", "contingency", "constraintCost"]].style.format(
                            {"constraintCost": "${:.2f}"}),
                        use_container_width=True,
                        hide_index=True
                    )
                else:
                    st.warning("No data found for the selected combination and date range.")
        else:
            st.warning(f"No constraint data available for the {c_market.upper()} market.")

    # --- TAB 2: GENERATOR ANALYSIS ---
    with tab2:
        st.subheader("Generator LMP, MCC, and MLC")

        today = date.today()
        left, right = st.columns(2)
        with left:
            start = st.date_input("Enter a start date", value=today - timedelta(days=7), key=1335)
        with right:
            end = st.date_input("Enter an end date", value=today, key=2883)
        if st.button("Fetch Data", type="primary", key=f"{key_prefix}_load_1"):
            with st.status("Updating caches...", expanded=True) as status:
                def log(msg):
                    st.write(msg)
                    status.update(label=msg)

                st.session_state[f"{key_prefix}_da_constraints_df"] = update_cache_parquet(
                    da_constraint_cache, "da", "constraints", start, end, log
                )
                st.session_state[f"{key_prefix}_da_gen_df"] = update_cache_parquet(
                    da_gen_cache, "da", "generator", start, end, log
                )
                st.session_state[f"{key_prefix}_rt_constraints_df"] = update_cache_parquet(
                    rt_constraint_cache, "rt", "constraints", start, end, log
                )
                st.session_state[f"{key_prefix}_rt_gen_df"] = update_cache_parquet(
                    rt_gen_cache, "rt", "generator", start, end, log
                )

                st.session_state[data_loaded_key] = True
                status.update(label="Data loaded successfully", state="complete", expanded=False)

        g_market = st.radio("Select Market:", ["DA", "RT"], horizontal=True, key=f"{key_prefix}_g_market").lower()
        raw_gen = st.session_state.get(f"{key_prefix}_{g_market}_gen_df")

        if raw_gen is not None and not raw_gen.empty:
            df_gen = raw_gen[(raw_gen['time'].dt.date >= start) & (raw_gen['time'].dt.date <= end)]

            generators = sorted(df_gen["name"].dropna().unique())
            selected_gen = st.selectbox("Select Generator", generators, key=f"{key_prefix}_g_name")

            if selected_gen:
                filtered_gen = df_gen[df_gen["name"] == selected_gen].sort_values("time")

                if not filtered_gen.empty:
                    fig_gen = px.line(
                        filtered_gen,
                        x="time",
                        y=["lbmp", "mcc", "mlc"],
                        title=f"Pricing Components for {selected_gen} ({g_market.upper()})",
                        labels={"time": "Time", "value": "Cost ($/MWHr)", "variable": "Pricing Component"}
                    )
                    st.plotly_chart(fig_gen, use_container_width=True)

                    st.dataframe(
                        filtered_gen[["time", "name", "lbmp", "mcc", "mlc"]].style.format({
                            "lbmp": "${:.2f}",
                            "mcc": "${:.2f}",
                            "mlc": "${:.2f}"
                        }),
                        use_container_width=True,
                        hide_index=True
                    )
                else:
                    st.warning("No data found for the selected generator and date range.")
        else:
            st.warning(f"No generator data available for the {g_market.upper()} market.")

    # --- TAB 3: CIT ---
    with tab3:
        render_constraint_impact_tool(embedded=True)

# </editor-fold>


# <editor-fold desc="Price SIDs">
# NYISO Price SIDs
nyiso_da_lmp_sids = {
    # NYISO DA LMPs
    "Zone A DA LMP": 4363,
    "Zone B DA LMP": 4364,
    "Zone C DA LMP": 4365,
    "Zone D DA LMP": 4366,
    "Zone E DA LMP": 4367,
    "Zone F DA LMP": 4368,
    "Zone G DA LMP": 4369,
    "Zone H DA LMP": 4370,
    "Zone I DA LMP": 4371,
    "Zone J DA LMP": 4372,
    "Zone K DA LMP": 4373,
    "MH DA LMP": 4398,
    "OH DA LMP": 4361,
    "HQ DA LMP": 3973,
    "PJM DA LMP": 4362,
    "NYISO DA LMP": 4360,
}
nyiso_da_lmp_names = list(nyiso_da_lmp_sids.keys())

nyiso_rt_lmp_sids = {
    # NYISO RT LMPs
    "Zone A RT LMP": 4296,
    "Zone B RT LMP": 4297,
    "Zone C RT LMP": 4298,
    "Zone D RT LMP": 4299,
    "Zone E RT LMP": 4300,
    "Zone F RT LMP": 4301,
    "Zone G RT LMP": 4302,
    "Zone H RT LMP": 4303,
    "Zone I RT LMP": 4304,
    "Zone J RT LMP": 4305,
    "Zone K RT LMP": 4306,
    "NE RT LMP": 4108,
    "OH RT LMP": 4309,
    "HQ RT LMP": 4311,
    "PJM RT LMP": 4310,
    "NYISO RT LMP": 4307,
}
nyiso_rt_lmp_names = list(nyiso_rt_lmp_sids.keys())

nyiso_da_mcc_sids = {
    # DA MCC
    "DA MCC A": 4752,
    "DA MCC B": 4753,
    "DA MCC C": 4754,
    "DA MCC D": 4755,
    "DA MCC E": 4756,
    "DA MCC F": 4757,
    "DA MCC G": 4758,
    "DA MCC H": 4759,
    "DA MCC HQ": 4764,
    "DA MCC I": 4760,
    "DA MCC J": 4761,
    "DA MCC K": 4762,
    "DA MCC NE": 4749,
    "DA MCC OH": 4750,
    "DA MCC PJM": 4751,
    "DA MCC REF": 4748,
}
nyiso_da_mcc_names = list(nyiso_da_mcc_sids.keys())

nyiso_rt_mcc_sids = {
    # RT MCC
    "RT MCC A": 5727,
    "RT MCC B": 5728,
    "RT MCC C": 5729,
    "RT MCC D": 5730,
    "RT MCC E": 5731,
    "RT MCC F": 5732,
    "RT MCC G": 5733,
    "RT MCC H": 5734,
    "RT MCC HQ": 5742,
    "RT MCC I": 5735,
    "RT MCC J": 5736,
    "RT MCC K": 5737,
    "RT MCC NE": 5739,
    "RT MCC OH": 5740,
    "RT MCC PJM": 5741,
    "RT MCC REF": 5738,
}
nyiso_rt_mcc_names = list(nyiso_rt_mcc_sids.keys())

nyiso_da_mcl_sids = {
    # DA MCL
    "DA MCL A": 4737,
    "DA MCL B": 4738,
    "DA MCL C": 4739,
    "DA MCL D": 4740,
    "DA MCL E": 4741,
    "DA MCL F": 4742,
    "DA MCL G": 4743,
    "DA MCL H": 4744,
    "DA MCL I": 4745,
    "DA MCL J": 4746,
    "DA MCL K": 4747,
}
nyiso_da_mcl_names = list(nyiso_da_mcl_sids.keys())

nyiso_rt_mcl_sids = {
    # RT MCL
    "RT MCL A": 5743,
    "RT MCL B": 5744,
    "RT MCL C": 5745,
    "RT MCL D": 5746,
    "RT MCL E": 5747,
    "RT MCL F": 5748,
    "RT MCL G": 5749,
    "RT MCL H": 5750,
    "RT MCL I": 5751,
    "RT MCL J": 5752,
    "RT MCL K": 5753,
}
nyiso_rt_mcl_names = list(nyiso_rt_mcl_sids.keys())

# ISONE Price SIDs
isone_da_lmp_sids = {
    # Prices (Hub)
    "MassHub DA LMP": 4398,

    # Prices (Zonal DA LMPs)
    "Maine DA LMP": 4399,
    "New Hampshire DA LMP": 4400,
    "Vermont DA LMP": 4401,
    "Connecticut DA LMP": 4402,
    "Rhode Island DA LMP": 4403,
    "SE Mass DA LMP": 4404,
    "WC Mass DA LMP": 4405,
    "NEMASS/Boston DA LMP": 4406,
}
isone_da_lmp_names = list(isone_da_lmp_sids.keys())

isone_rt_lmp_sids = {
    # Prices (Hub)
    "MassHub RT LMP": 4107,
}
isone_rt_lmp_names = list(isone_rt_lmp_sids.keys())

isone_rt_mcc_sids = {
    # Congestion (RT MCC hourly)
    "MassHub RT MCC": 4718,
    "Maine RT MCC": 4719,
    "New Hampshire RT MCC": 4720,
    "Vermont RT MCC": 4721,
    "Connecticut RT MCC": 4722,
    "Rhode Island RT MCC": 4723,
    "SE Mass RT MCC": 4724,
    "WC Mass RT MCC": 4725,
    "NEMASS/Boston RT MCC": 4726,
}
isone_rt_mcc_names = list(isone_rt_mcc_sids.keys())

gas_price_sids = {
    "Iroquois-Z2 Gas Price": 17004,
    "Algonquin Gas Price": 16998,
    "Transco-Z6 NY Gas Price": 17008,
    "Tetco-M3 Gas Price": 4630,
}

# Demand SIDs
demand_sids = {
    "NYISO Wind Forecast": 105427,
    "WoodMac NYISO Demand Forecast": 64472,
    "NYISO Demand Forecast": 54132,
    "NYISO Cleared Demand": 55951,
    "NYISO RT Demand": 4276,
    "ISONE Wind Forecast": 105385,
    "WoodMac ISONE Demand Forecast": 64467,
    "ISONE Demand Forecast": 99,
    "ISONE Cleared Demand": 5297,
    "ISONE RT Demand": 75261,
}
nyiso_demand_names = [
    "WoodMac NYISO Demand Forecast",
    "NYISO Demand Forecast",
    "NYISO Cleared Demand",
    "NYISO RT Demand",
    "ISO Wind-Implied Net Load",
    "WoodMac Wind-Implied Net Load"
]
isone_demand_names = [
    "WoodMac ISONE Demand Forecast",
    "ISONE Demand Forecast",
    "ISONE Cleared Demand",
    "ISONE RT Demand",
    "ISO Wind-Implied Net Load",
    "WoodMac Wind-Implied Net Load"
]

# Imports SIDs
internal_interface_da_flows_sids = {
    "Central East DA Flows": 5196,
    "Dysinger East DA Flows": 5198,
    "Moses South DA Flows": 5200,
    "Total East DA Flows": 5202,
    "Dunwoodie DA Flows": 5204,
    "UPNY-ConED DA Flows": 5206,
    "West Central DA Flows": 5208,
}
internal_interface_rt_flows_sids = {
    "Central East RT Flows": 4325,
    "Dysinger East RT Flows": 4334,
    "Moses South RT Flows": 4331,
    "Total East RT Flows": 4326,
    "Dunwoodie RT Flows": 4332,
    "UPNY-ConED RT Flows": 4327,
    "West Central RT Flows": 4324,
}

internal_interface_da_ttc_sids = {
    "Central East DA TTC": 4567,
    "Dunwoodie DA TTC": 4568,
    "Dysinger East DA TTC": 4569,
    "Moses South DA TTC": 4570,
    "Total East DA TTC": 4571,
    "UPNY-ConED DA TTC": 4572,
    "West Central DA TTC": 4573,
}
internal_interface_rt_ttc_sids = {
    "Central East RT TTC": 4796,
    "Dunwoodie RT TTC": 4797,
    "Dysinger East RT TTC": 4798,
    "Moses South RT TTC": 4799,
    "Total East RT TTC": 4800,
    "UPNY-ConED RT TTC": 4801,
    "West Central RT TTC": 4802,
}

external_interface_da_flows_sids = {
    "NE AC DA Flows": 9554,
    "1385 DA Flows": 44420,
    "CSC DA Flows": 9555,
    "PJM AC DA Flows": 9558,
    "PJM HTP DA Flows": 65039,
    "PJM VFT DA Flows": 40623,
    "PJM Neptune DA Flows": 9557,
    "IMO AC DA Flows": 9556,
    "HQ AC DA Flows": 9553,
    "HQ Cedars DA Flows": 9552,
    "HQ Ex DA Flows": 51959,
}
external_interface_import_da_ttc_sids = {
    "HQ AC Import DA TTC": 4563,
    "HQ Cedars Import DA TTC": 40552,
    "IMO AC Import DA TTC": 4564,
    "NE AC Import DA TTC": 4565,
    "CSC Import DA TTC": 6026,
    "1385 Import DA TTC": 40558,
    "PJM AC Import DA TTC": 4566,
    "PJM NEP Import DA TTC": 40564,
    "PJM HTP Import DA TTC": 65028,
    "PJM VFT Import DA TTC": 40576,
}
external_interface_export_da_ttc_sids = {
    "HQ AC Export DA TTC": 4596,
    "HQ Cedars Export DA TTC": 40546,
    "IMO AC Export DA TTC": 4597,
    "NE AC Export DA TTC": 4598,
    "CSC Export DA TTC": 6032,
    "1385 Export DA TTC": 40540,
    "PJM AC Export DA TTC": 4599,
    "PJM VFT Export DA TTC": 54795,
}

external_interface_rt_flows_sids = {
    "NE AC RT Flows": 4330,
    "1385 RT Flows": 31160,
    "CSC RT Flows": 31162,
    "PJM AC RT Flows": 4328,
    "PJM HTP RT Flows": 65040,
    "PJM VFT RT Flows": 52443,
    "PJM Neptune RT Flows": 31159,
    "IMO AC RT Flows": 4329,
    "HQ AC RT Flows": 31158,
    "HQ Cedars RT Flows": 31161,
    "HQ Chateaugay RT Flows": 4333,
}
external_interface_import_rt_ttc_sids = {
    "HQ AC Import RT TTC": 4792,
    "HQ Cedars Import RT TTC": 31166,
    "IMO AC Import RT TTC": 4794,
    "NE AC Import RT TTC": 4793,
    "CSC Import RT TTC": 31167,
    "1385 Import RT TTC": 31165,
    "PJM AC Import RT TTC": 4795,
    "PJM HTP Import RT TTC": 65034,
    "PJM VFT Import RT TTC": 40577,
    "PJM NEP Import RT TTC": 31164,
}
external_interface_export_rt_ttc_sids = {
    "HQ AC Export RT TTC": 4803,
    "HQ Cedars Export RT TTC": 31182,
    "IMO AC Export RT TTC": 4805,
    "NE AC Export RT TTC": 4804,
    "CSC Export RT TTC": 31183,
    "1385 Export RT TTC": 31181,
    "PJM AC Export RT TTC": 4806,
    "PJM HTP Export RT TTC": 65029,
    "PJM VFT Export RT TTC": 54796,
    "PJM NEP Export RT TTC": 31180,
}

# </editor-fold>


# <editor-fold desc="Generation SIDs">

# Generation on Maintenance for PJM, NYISO, ISONE
gom_sids = {
    "NYISO Generation on Maintenance": 62896,
    "ISONE 7D Capacity on Outage": 3581,
    "PJM Total Outages": 77945,
    "PJM Planned Outages": 77946,
    "PJM Maintenance Outages": 77947,
    "PJM Forced Outages": 77948,
    "Ontario Total Capability": 56596,
}

# RT Fuel Mix for PJM, NYISO, ISONE, IESO
nyiso_generation_sids = {
    "NYISO Nuke Output": 78762,
    "NYISO Hydro Output": 78760,
    "NYISO Nat Gas Output": 78761,
    "NYISO Dual Fuel Output": 78759,
    "NYISO Wind Output": 78765,
    "NYISO Oil Output": 78763,
}
nyiso_generation_names = list(nyiso_generation_sids.keys())

isone_generation_sids = {
    "ISONE Nuke Output": 64732,
    "ISONE Hydro Output": 64730,
    "ISONE Nat Gas Output": 64731,
    "ISONE Wind Output": 64736,
    "ISONE Oil Output": 64733,
    "ISONE Coal Output": 64729,
}
isone_generation_names = list(isone_generation_sids.keys())

ieso_generation_sids = {
    "Ontario Nuke Output": 5495,
    "Ontario Hydro Output": 5499,
    "Ontario Nat Gas Output": 56591,
    "Ontario Wind Output": 56592,
    "Ontario Total Output": 56595,
}
ieso_generation_names = list(ieso_generation_sids.keys())

pjm_generation_sids = {
    "PJM Nuke Output": 78831,
    "PJM Hydro Output": 78829,
    "PJM Nat Gas Output": 78828,
    "PJM Wind Output": 78835,
    "PJM Oil Output": 78832,
    "PJM Coal Output": 78827,
    "PJM Solar Output": 78836,
    "PJM Multiple Fuels Output": 78830,
    "PJM Renewables Output": 78834,
}
pjm_generation_names = list(pjm_generation_sids.keys())

wind_generation_sids = {
    # Wind Generation Forecasts
    "PJM Wind Forecast": 75720,
    "ISONE Wind Forecast": 105385,
    "NYISO Wind Forecast": 105427,
}
wind_generation_names = list(wind_generation_sids.keys())

# </editor-fold>


st.set_page_config(page_title="NYISONE Analyst Tool", layout="wide")
st.title("NYISONE Analyst Tool")

today = date.today()

internal, automation, modeling, prices, demand, imports, generation, congestion = st.tabs(
    ["Internal", "Automation", "Modeling", "Prices", "Demand", "Imports", "Generation", "Congestion"])

with internal:
    st.subheader("Links")

    with st.container(border=True):
        col1, col2, col3 = st.columns(3)

        with col1:
            st.link_button("PowerIQ", "https://pta.woodmac.com/", type="primary")
            st.link_button("Report Gen", "https://apps.genscape.com/reportgenerator/web/Login.aspx?msgid=1", type="primary")
            st.link_button("SEER", "https://seer.genscape.com/", type="primary")
            st.link_button("GenRT", "https://pta-powerrt.woodmac.com/", type="primary")
            st.link_button("NatGasAnalyst", "https://apps2.genscape.com/Analyst/#/dashboard", type="primary")
            st.link_button("NatGasRT", "https://apps2.genscape.com/NatGasRT/#/app", type="primary")
            st.link_button("Bid Data Tool & API", "https://pta-biddata.woodmac.com/ExternalBids/", type="primary")
            st.link_button("API Portal", "https://developer.genscape.com/", type="primary")
        with col2:
            st.link_button("NRC Nuclear Status",
                           "https://www.nrc.gov/reading-rm/doc-collections/event-status/reactor-status/index", type="primary")
            st.link_button("Nuke Outage Calendar", "https://outagecalendar.com/", type="primary")
            st.link_button("Ventusky", "https://www.ventusky.com/?p=42.35;-75.06;6&l=satellite&t=20230217/2110", type="primary")
            st.link_button("Okta", "https://woodmackenzie.okta.com/app", type="primary")
            st.link_button("IESO SBG", "https://www.ieso.ca/power-data/data-directory", type="primary")
            st.link_button("Generator Wiki", "https://www.gem.wiki/Main_Page", type="primary")
            st.link_button("LensPower", "https://lens.woodmac.com/app?state_id=1835998074", type="primary")
        with col3:
            st.link_button("Iroquois Gas Notices", "https://ioly.iroquois.com/infopost/", type="primary")
            st.link_button("Algonquin Gas Notices", "https://infopost.enbridge.com/infopost/AGHome.asp?Pipe=AG", type="primary")
            st.link_button("Tetco Gas Notices", "https://infopost.enbridge.com/infopost/TEHome.asp?Pipe=TE", type="primary")
            st.link_button("Transco Gas Notices", "https://www.1line.williams.com/Transco/index.html", type="primary")
            st.link_button("TGP Gas Notices", "https://pipeline2.kindermorgan.com/Notices/Notices.aspx?type=C&code=TGP", type="primary")

    left, right = st.columns(2)

    with left:
        st.subheader("NYISO")
        st.link_button("NYISO OASIS Page", "https://mis.nyiso.com/public/", type="primary")
    with right:
        st.subheader("ISONE")
        st.link_button("ISONE Market Data", "https://www.iso-ne.com/isoexpress/web/reports/grid", type="primary")

    st.subheader("Gas Notices")
    natgas_notice_tables = render_natgas_notices_dashboard(api_key)

with automation:
    iso_choice = st.selectbox("Select ISO", ("NYISO", "ISONE"), key=242)
    report_choice = st.selectbox("Select a report type",
                                 ("Final", "Prelim", "Weekend Prelim", "Mon Final", "Tue Prelim", "14-Day Outlook"))

    if iso_choice == "NYISO":
        st.subheader("Summary Section")
        ny_summary_block = report_summary_section_writer(report_choice)
        st.text_area("Copy Summary Section Template", ny_summary_block, width="stretch")

        st.subheader("Imports Section")
        ny_imports_block = report_imports_section_writer(report_choice)
        st.text_area("Copy Imports Section Template", ny_imports_block, height=525, width="stretch")

        st.subheader("Generation Section")
        ny_generation_block = report_generation_section_writer(report_choice, api_key)
        st.text_area("Copy Generation Section", ny_generation_block, width="stretch")

        st.subheader("Congestion Section")
        ny_congestion_block = report_congestion_section_writer(report_choice)
        st.text_area("Copy Congestion Section", ny_congestion_block, height=400)

        st.divider()

        left, right = st.columns(2)
        with left:
            blast_maker(api_key)
        with right:
            powerbuyer()

        coned_email_maker(api_key)
    else:
        st.write("Coming Soon")

with modeling:
    # Date Selection
    left, right = st.columns(2)
    with left:
        start = st.date_input("Enter a start date", value=today, key=862)
    with right:
        end = st.date_input("Enter an end date", value=today, key=947)

    # DA LMP Modelling
    da_lmp_sids = {
        "Zone A": 4363,
        "Zone G": 4369,
        "Zone J": 4372,
        "Zone K": 4373,
    }
    da_lmp_data = pull_data(api_key, da_lmp_sids, start, end, "H")
    da_forecast_plot = plotly_line_chart(da_lmp_data, x="Timestamp", y=list(da_lmp_sids.keys()))

    left, right = st.columns(2)
    with left:
        st.plotly_chart(da_forecast_plot)
    with right:
        start_he, end_he = st.slider(
            "HE range (inclusive)",
            min_value=0,
            max_value=23,
            value=(7, 22),
            step=1,
        )
        st.write(start_he, end_he)
    da_lmp_data = da_lmp_data[da_lmp_data["HE"] == start_he]
    st.dataframe(da_lmp_data)

    # RT LMP Modelling

with prices:
    # Date Selection
    left, right = st.columns(2)
    with left:
        start = st.date_input("Enter a start date", value=today, key=123)
    with right:
        end = st.date_input("Enter an end date", value=today, key=321)

    iso_choice = st.selectbox("Select ISO", ("NYISO", "ISONE", "Spreads"))

    if iso_choice == "NYISO":
        nyiso_metric_choice = st.selectbox(
            "Select NYISO Metric",
            ("DA LMP", "RT LMP", "DA MCC", "RT MCC", "DA MCL", "RT MCL", "Hourly Pivot (DA/RT LMP-MCC-MLC)"),
        )

        if nyiso_metric_choice == "Hourly Pivot (DA/RT LMP-MCC-MLC)":
            zone_choice = st.selectbox("Select Zone", ("A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"))

            # Pre-processing
            hourly_pivot_sids = {
                f"Zone {zone_choice} DA LMP": nyiso_da_lmp_sids[f"Zone {zone_choice} DA LMP"],
                f"DA MCC {zone_choice}": nyiso_da_mcc_sids[f"DA MCC {zone_choice}"],
                f"DA MCL {zone_choice}": nyiso_da_mcl_sids[f"DA MCL {zone_choice}"],
                f"Zone {zone_choice} RT LMP": nyiso_rt_lmp_sids[f"Zone {zone_choice} RT LMP"],
                f"RT MCC {zone_choice}": nyiso_rt_mcc_sids[f"RT MCC {zone_choice}"],
                f"RT MCL {zone_choice}": nyiso_rt_mcl_sids[f"RT MCL {zone_choice}"],
            }

            hourly_df = pull_data(api_key, hourly_pivot_sids, start, end, "H")

            long_df = hourly_df.melt(
                id_vars=["Date", "HE"],
                value_vars=list(hourly_pivot_sids.keys()),
                var_name="Series",
                value_name="Value",
            )

            row_map = {
                f"Zone {zone_choice} DA LMP": ("DA", "LMP"),
                f"DA MCC {zone_choice}": ("DA", "MCC"),
                f"DA MCL {zone_choice}": ("DA", "MLC"),
                f"Zone {zone_choice} RT LMP": ("RT", "LMP"),
                f"RT MCC {zone_choice}": ("RT", "MCC"),
                f"RT MCL {zone_choice}": ("RT", "MLC"),
            }

            long_df["Market"] = long_df["Series"].map(lambda x: row_map[x][0])
            long_df["Metric"] = long_df["Series"].map(lambda x: row_map[x][1])

            long_df["Market"] = pd.Categorical(long_df["Market"], categories=["DA", "RT"], ordered=True)
            long_df["Metric"] = pd.Categorical(long_df["Metric"], categories=["LMP", "MCC", "MLC"], ordered=True)

            hourly_pivot_df = long_df.pivot_table(
                index=["Date", "Market", "Metric"],
                columns="HE",
                values="Value",
                aggfunc="mean",
            ).round(2)

            # Create Table
            st.dataframe(hourly_pivot_df)

            dod_row_choice = st.selectbox(
                "Choose a row for DoD chart",
                ("DA LMP", "DA MCC", "DA MLC", "RT LMP", "RT MCC", "RT MLC"),
            )

            if dod_row_choice.startswith("DA"):
                dod_market = "DA"
                dod_metric = dod_row_choice.replace("DA ", "")
            else:
                dod_market = "RT"
                dod_metric = dod_row_choice.replace("RT ", "")

            dod_plot_df = long_df[
                (long_df["Market"] == dod_market) &
                (long_df["Metric"] == dod_metric)
                ].copy()

            # Plot Line Chart
            fig_dod = px.line(
                dod_plot_df,
                x="HE",
                y="Value",
                color="Date",
                markers=True,
            )
            st.plotly_chart(fig_dod)

        else:
            # Pre-processing
            if nyiso_metric_choice == "DA LMP":
                price_sids = nyiso_da_lmp_sids
                price_names = nyiso_da_lmp_names
                opa_drop_cols = ["HE", "MH DA LMP", "OH DA LMP", "HQ DA LMP", "PJM DA LMP", "NYISO DA LMP"]

            elif nyiso_metric_choice == "RT LMP":
                price_sids = nyiso_rt_lmp_sids
                price_names = nyiso_rt_lmp_names
                opa_drop_cols = ["HE", "NE RT LMP", "OH RT LMP", "HQ RT LMP", "PJM RT LMP", "NYISO RT LMP"]

            elif nyiso_metric_choice == "DA MCC":
                price_sids = nyiso_da_mcc_sids
                price_names = nyiso_da_mcc_names
                opa_drop_cols = ["HE"]

            elif nyiso_metric_choice == "RT MCC":
                price_sids = nyiso_rt_mcc_sids
                price_names = nyiso_rt_mcc_names
                opa_drop_cols = ["HE"]

            elif nyiso_metric_choice == "DA MCL":
                price_sids = nyiso_da_mcl_sids
                price_names = nyiso_da_mcl_names
                opa_drop_cols = ["HE"]

            else:
                price_sids = nyiso_rt_mcl_sids
                price_names = nyiso_rt_mcl_names
                opa_drop_cols = ["HE"]

            prices_df = pull_data(api_key, price_sids, start, end, "H")
            opa_prices_df = calculate_opa(prices_df)
            opa_prices_df = opa_prices_df.drop(columns=opa_drop_cols)

            # Create Table
            st.dataframe(opa_prices_df)

            # Plot Line Chart
            fig = plotly_line_chart(df=prices_df, x="Timestamp", y=price_names)
            st.plotly_chart(fig)

    elif iso_choice == "ISONE":
        isone_metric_choice = st.selectbox("Select ISONE Metric", ("DA LMP", "RT LMP", "RT MCC"))

        # Pre-processing
        if isone_metric_choice == "DA LMP":
            price_sids = isone_da_lmp_sids
            price_names = isone_da_lmp_names
            opa_drop_cols = ["HE"]

        elif isone_metric_choice == "RT LMP":
            price_sids = isone_rt_lmp_sids
            price_names = isone_rt_lmp_names
            opa_drop_cols = ["HE"]

        else:
            price_sids = isone_rt_mcc_sids
            price_names = isone_rt_mcc_names
            opa_drop_cols = ["HE"]

        prices_df = pull_data(api_key, price_sids, start, end, "H")
        opa_prices_df = calculate_opa(prices_df)
        opa_prices_df = opa_prices_df.drop(columns=opa_drop_cols)

        # Create Table
        st.dataframe(opa_prices_df)

        # Plot Line Chart
        fig = plotly_line_chart(df=prices_df, x="Timestamp", y=price_names)
        st.plotly_chart(fig)

    elif iso_choice == "Spreads":
        prices_df = pull_data(api_key, nyiso_da_lmp_sids, start, end, "H")
        opa_prices_df = calculate_opa(prices_df)

        # LMP Spreads
        spread_df = pd.DataFrame()
        spread_df["Date"] = opa_prices_df["Date"]
        spread_df["HE"] = opa_prices_df["HE"]
        spread_df["G/A Spread"] = opa_prices_df["Zone G DA LMP"] - opa_prices_df["Zone A DA LMP"]
        spread_df["J/G Spread"] = opa_prices_df["Zone J DA LMP"] - opa_prices_df["Zone G DA LMP"]
        spread_df["K/J Spread"] = opa_prices_df["Zone K DA LMP"] - opa_prices_df["Zone J DA LMP"]
        spread_df["F/G Spread"] = opa_prices_df["Zone F DA LMP"] - opa_prices_df["Zone G DA LMP"]
        spread_df["C/A Spread"] = opa_prices_df["Zone C DA LMP"] - opa_prices_df["Zone A DA LMP"]
        spread_df["MH/G Spread"] = opa_prices_df["MH DA LMP"] - opa_prices_df["Zone G DA LMP"]
        spread_df["OH/A Spread"] = opa_prices_df["OH DA LMP"] - opa_prices_df["Zone A DA LMP"]
        spread_df["PJM/A-C Spread"] = opa_prices_df["PJM DA LMP"] - (
                (
                        opa_prices_df["Zone A DA LMP"]
                        + opa_prices_df["Zone B DA LMP"]
                        + opa_prices_df["Zone C DA LMP"]
                )
                / 3
        )
        spread_df["HQ/D Spread"] = opa_prices_df["HQ DA LMP"] - opa_prices_df["Zone D DA LMP"]

        # Gas Price Spreads
        gas_price_df = pull_data(api_key, gas_price_sids, start, end, "D")
        gas_price_df = gas_price_df.bfill()
        spread_df["IRQ-Z2/AGT Spread"] = (
                gas_price_df["Iroquois-Z2 Gas Price"] - gas_price_df["Algonquin Gas Price"]
        )
        spread_df["Transco-Z6/Tetco-M3 Spread"] = (
                gas_price_df["Transco-Z6 NY Gas Price"] - gas_price_df["Tetco-M3 Gas Price"]
        )

        # Create Table
        spread_df = spread_df.round(2)
        st.dataframe(spread_df)

        # Plot Line Chart
        spread_names = [
            "G/A Spread",
            "J/G Spread",
            "K/J Spread",
            "F/G Spread",
            "C/A Spread",
            "MH/G Spread",
            "OH/A Spread",
            "PJM/A-C Spread",
            "HQ/D Spread",
            "IRQ-Z2/AGT Spread",
            "Transco-Z6/Tetco-M3 Spread",
        ]
        fig = plotly_line_chart(df=spread_df, x="Date", y=spread_names)
        st.plotly_chart(fig)

with demand:
    # Date Selection
    left, right = st.columns(2)
    with left:
        start = st.date_input("Enter a start date", value=today, key=324)
    with right:
        end = st.date_input("Enter an end date", value=today, key=234)

    iso_choice = st.selectbox("Select ISO", ("NYISO", "ISONE"))
    metric_choice = st.selectbox("Select Metric", ("Raw", "Wind-Implied Net Load", "WM vs ISO", "ISO Error"))

    demand_df = pull_data(api_key, demand_sids, start, end, "H")
    opa_demand_df = calculate_opa(demand_df).round()
    opa_demand_df = opa_demand_df.drop(columns=["HE"])

    metric_df = pd.DataFrame()
    metric_df["Date"] = demand_df["Date"]
    metric_df["HE"] = demand_df["HE"]

    opa_metric_df = pd.DataFrame()
    opa_metric_df["Date"] = opa_demand_df["Date"]

    if iso_choice == "NYISO":
        demand_forecast_col = "NYISO Demand Forecast"
        wind_forecast_col = "NYISO Wind Forecast"
        woodmac_demand_forecast_col = "WoodMac NYISO Demand Forecast"
        cleared_demand_col = "NYISO Cleared Demand"
        rt_demand_col = "NYISO RT Demand"
        line_plot_cols = [
            "NYISO RT Demand",
            "NYISO Cleared Demand",
            "ISO Wind-Implied Net Load",
            "WoodMac Wind-Implied Net Load",
            "WoodMac NYISO Demand Forecast",
            "NYISO Demand Forecast",
        ]
    else:
        demand_forecast_col = "ISONE Demand Forecast"
        wind_forecast_col = "ISONE Wind Forecast"
        woodmac_demand_forecast_col = "WoodMac ISONE Demand Forecast"
        cleared_demand_col = "ISONE Cleared Demand"
        rt_demand_col = "ISONE RT Demand"
        line_plot_cols = [
            "ISONE RT Demand",
            "ISONE Cleared Demand",
            "ISO Wind-Implied Net Load",
            "WoodMac Wind-Implied Net Load",
            "WoodMac ISONE Demand Forecast",
            "ISONE Demand Forecast",
        ]

    if metric_choice == "Raw":
        # Create Table
        st.dataframe(opa_demand_df)

    elif metric_choice == "Wind-Implied Net Load":
        # Pre-processing
        opa_metric_df["ISO Wind-Implied Net Load"] = (
                opa_demand_df[demand_forecast_col] - opa_demand_df[wind_forecast_col]
        )
        opa_metric_df["WoodMac Wind-Implied Net Load"] = (
                opa_demand_df[woodmac_demand_forecast_col] - opa_demand_df[wind_forecast_col]
        )

        # Create Table
        st.dataframe(opa_metric_df)

    elif metric_choice == "WM vs ISO":
        # Pre-processing
        opa_metric_df["WM vs ISO"] = opa_demand_df[woodmac_demand_forecast_col] - opa_demand_df[wind_forecast_col]

        # Create Table
        st.dataframe(opa_metric_df)

    else:
        # Pre-processing
        opa_metric_df["WoodMac Error"] = opa_demand_df[woodmac_demand_forecast_col] - opa_demand_df[rt_demand_col]
        opa_metric_df["ISO Error"] = opa_demand_df[demand_forecast_col] - opa_demand_df[rt_demand_col]
        opa_metric_df["Cleared Demand Error"] = opa_demand_df[cleared_demand_col] - opa_demand_df[rt_demand_col]

        # Create Table
        st.dataframe(opa_metric_df)

    metric_df["ISO Wind-Implied Net Load"] = demand_df[demand_forecast_col] - demand_df[wind_forecast_col]
    metric_df["WoodMac Wind-Implied Net Load"] = (
            demand_df[woodmac_demand_forecast_col] - demand_df[wind_forecast_col]
    )
    metric_df[woodmac_demand_forecast_col] = demand_df[woodmac_demand_forecast_col]
    metric_df[demand_forecast_col] = demand_df[demand_forecast_col]
    metric_df[cleared_demand_col] = demand_df[cleared_demand_col]
    metric_df[rt_demand_col] = demand_df[rt_demand_col]

    fig = plotly_line_chart(metric_df, x="Timestamp", y=line_plot_cols)
    st.plotly_chart(fig)

    if iso_choice == "NYISO":
        var_choice = st.selectbox("Choose a variable", nyiso_demand_names)
        fig_dod = px.line(
            metric_df,
            x="HE",
            y=var_choice,
            color="Date",
            markers=True,
        )
        st.plotly_chart(fig_dod)
    else:
        var_choice = st.selectbox("Choose a variable", isone_demand_names)
        fig_dod = px.line(
            metric_df,
            x="HE",
            y=var_choice,
            color="Date",
            markers=True,
        )
        st.plotly_chart(fig_dod)

with imports:
    # Date Selection
    left, right = st.columns(2)
    with left:
        start = st.date_input("Enter a start date", value=today, key=547)
    with right:
        end = st.date_input("Enter an end date", value=today, key=873)

    imports_area_choice = st.selectbox("Select Area", ("Internal Interface", "External Interface"))
    imports_market_choice = st.selectbox("Select Market", ("DA", "RT"))

    if imports_area_choice == "Internal Interface":
        imports_metric_choice = st.selectbox("Select Metric", ("Flows", "TTC", "Flows vs TTC"))

        # Pre-processing
        if imports_market_choice == "DA":
            internal_flows_sids = internal_interface_da_flows_sids
            internal_ttc_sids = internal_interface_da_ttc_sids
        else:
            internal_flows_sids = internal_interface_rt_flows_sids
            internal_ttc_sids = internal_interface_rt_ttc_sids

        if imports_metric_choice == "Flows":
            selected_interface_sids = internal_flows_sids

        elif imports_metric_choice == "TTC":
            selected_interface_sids = internal_ttc_sids

        else:
            compare_pairs = {}
            for flow_name in internal_flows_sids.keys():
                ttc_name = flow_name.replace("Flows", "TTC")
                if ttc_name in internal_ttc_sids:
                    compare_pairs[flow_name] = ttc_name

            interface_choice = st.selectbox("Choose an interface", list(compare_pairs.keys()))
            flow_name = interface_choice
            ttc_name = compare_pairs[interface_choice]

            selected_interface_sids = {
                flow_name: internal_flows_sids[flow_name],
                ttc_name: internal_ttc_sids[ttc_name],
            }

    else:
        imports_metric_choice = st.selectbox(
            "Select Metric",
            ("Flows", "Import TTC", "Export TTC", "Flows vs Import TTC", "Flows vs Export TTC"),
        )

        # Pre-processing
        if imports_market_choice == "DA":
            external_flows_sids = external_interface_da_flows_sids
            external_import_ttc_sids = external_interface_import_da_ttc_sids
            external_export_ttc_sids = external_interface_export_da_ttc_sids
        else:
            external_flows_sids = external_interface_rt_flows_sids
            external_import_ttc_sids = external_interface_import_rt_ttc_sids
            external_export_ttc_sids = external_interface_export_rt_ttc_sids

        if imports_metric_choice == "Flows":
            selected_interface_sids = external_flows_sids

        elif imports_metric_choice == "Import TTC":
            selected_interface_sids = external_import_ttc_sids

        elif imports_metric_choice == "Export TTC":
            selected_interface_sids = external_export_ttc_sids

        elif imports_metric_choice == "Flows vs Import TTC":
            compare_pairs = {}
            for flow_name in external_flows_sids.keys():
                ttc_name = flow_to_ttc_name(flow_name, "Import")
                if ttc_name in external_import_ttc_sids:
                    compare_pairs[flow_name] = ttc_name

            interface_choice = st.selectbox("Choose an interface", list(compare_pairs.keys()))
            flow_name = interface_choice
            ttc_name = compare_pairs[interface_choice]

            selected_interface_sids = {
                flow_name: external_flows_sids[flow_name],
                ttc_name: external_import_ttc_sids[ttc_name],
            }

        else:
            compare_pairs = {}
            for flow_name in external_flows_sids.keys():
                ttc_name = flow_to_ttc_name(flow_name, "Export")
                if ttc_name in external_export_ttc_sids:
                    compare_pairs[flow_name] = ttc_name

            interface_choice = st.selectbox("Choose an interface", list(compare_pairs.keys()))
            flow_name = interface_choice
            ttc_name = compare_pairs[interface_choice]

            selected_interface_sids = {
                flow_name: external_flows_sids[flow_name],
                ttc_name: external_export_ttc_sids[ttc_name],
            }

    interface_names = list(selected_interface_sids.keys())

    interface_df = pull_data(api_key, selected_interface_sids, start, end, "H")
    opa_interface_df = calculate_opa(interface_df).round()
    opa_interface_df = opa_interface_df.drop(columns=["HE"])

    # Create Table
    st.dataframe(opa_interface_df)

    # Plot Line Chart
    fig = plotly_line_chart(interface_df, x="Timestamp", y=interface_names)
    st.plotly_chart(fig)

    var_choice = st.selectbox("Choose a variable", interface_names)
    fig_dod = px.line(
        interface_df,
        x="HE",
        y=var_choice,
        color="Date",
        markers=True,
    )
    st.plotly_chart(fig_dod)

    # Derates Table
    selected_date = st.date_input("Select a date", value=today)

    ttc_df = ttcf_scrape(selected_date)

    external_interface_values = [
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
    internal_interface_values = [
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

    # Filters
    interface_group_choice = st.selectbox(
        "Select Interface Group",
        ("All", "External", "Internal"),
    )

    if interface_group_choice == "External":
        available_interfaces = external_interface_values
    elif interface_group_choice == "Internal":
        available_interfaces = internal_interface_values
    else:
        available_interfaces = external_interface_values + internal_interface_values

    selected_interfaces = st.multiselect(
        "Select Interface Name(s)",
        options=available_interfaces,
        default=available_interfaces,
    )

    # Pre-processing
    if ttc_df is None:
        st.warning("No TTCF Data Available")
    else:
        filtered_ttc_df = ttc_df.copy()

        if interface_group_choice == "External":
            filtered_ttc_df = filtered_ttc_df[
                filtered_ttc_df["Interface Name"].isin(external_interface_values)
            ]
        elif interface_group_choice == "Internal":
            filtered_ttc_df = filtered_ttc_df[
                filtered_ttc_df["Interface Name"].isin(internal_interface_values)
            ]

        if selected_interfaces:
            filtered_ttc_df = filtered_ttc_df[
                filtered_ttc_df["Interface Name"].isin(selected_interfaces)
            ]
        else:
            filtered_ttc_df = filtered_ttc_df.iloc[0:0]

        # Create Table
        st.dataframe(filtered_ttc_df)

with generation:
    # Date Selection
    left, right = st.columns(2)
    with left:
        start = st.date_input("Enter a start date", value=today, key=983)
    with right:
        end = st.date_input("Enter an end date", value=today, key=642)

    # RT Fuel Mix
    st.write("Same format but add in RT Fuel Mix for IESO, PJM, NYISO, ISONE")
    generation_df = pd.DataFrame()

    iso_choice = st.selectbox("Select ISO", ("NYISO", "ISONE", "PJM", "IESO"))
    if iso_choice == "NYISO":
        # NYISO OPA Generation Stacked Bar Chart
        generation_df = pull_data(api_key, nyiso_generation_sids, start, end, "H")
        opa_generation_df = calculate_opa(generation_df).round()

        dates = opa_generation_df["Date"]

        generation_stack_cols = nyiso_generation_names
        stacked_bar_chart = go.Figure()

        for col in generation_stack_cols:
            stacked_bar_chart.add_trace(
                go.Bar(
                    name=col,
                    x=dates,
                    y=opa_generation_df[col]
                )
            )
        stacked_bar_chart.update_layout(barmode="stack")

        st.plotly_chart(stacked_bar_chart)
    elif iso_choice == "ISONE":
        # ISONE OPA Generation Stacked Bar Chart
        generation_df = pull_data(api_key, isone_generation_sids, start, end, "H")
        opa_generation_df = calculate_opa(generation_df).round()
        dates = opa_generation_df["Date"]

        generation_stack_cols = isone_generation_names
        stacked_bar_chart = go.Figure()

        for col in generation_stack_cols:
            stacked_bar_chart.add_trace(
                go.Bar(
                    name=col,
                    x=dates,
                    y=opa_generation_df[col]
                )
            )
        stacked_bar_chart.update_layout(barmode="stack")

        st.plotly_chart(stacked_bar_chart)
    elif iso_choice == "PJM":
        # PJM OPA Generation Stacked Bar Chart
        generation_df = pull_data(api_key, pjm_generation_sids, start, end, "H")
        opa_generation_df = calculate_opa(generation_df).round()
        dates = opa_generation_df["Date"]

        generation_stack_cols = pjm_generation_names
        stacked_bar_chart = go.Figure()

        for col in generation_stack_cols:
            stacked_bar_chart.add_trace(
                go.Bar(
                    name=col,
                    x=dates,
                    y=opa_generation_df[col]
                )
            )
        stacked_bar_chart.update_layout(barmode="stack")

        st.plotly_chart(stacked_bar_chart)
    elif iso_choice == "IESO":
        # IESO OPA Generation Stacked Bar Chart
        generation_df = pull_data(api_key, ieso_generation_sids, start, end, "H")
        opa_generation_df = calculate_opa(generation_df).round()
        dates = opa_generation_df["Date"]

        generation_stack_cols = ieso_generation_names
        stacked_bar_chart = go.Figure()

        for col in generation_stack_cols:
            stacked_bar_chart.add_trace(
                go.Bar(
                    name=col,
                    x=dates,
                    y=opa_generation_df[col]
                )
            )
        stacked_bar_chart.update_layout(barmode="stack")

        st.plotly_chart(stacked_bar_chart)

    # Wind Generation
    st.write("Same format but add in Wind Generation Forecasts for IESO (StormVistra API code), PJM, NYISO, ISONE")

    ontario_wind_df = pull_ontario_wind_forecast_df(storm_vistra_api_key, start, end)

    wind_generation_df = pull_data(api_key, wind_generation_sids, start, end, "H")

    # Pre-processing
    if not ontario_wind_df.empty:
        ontario_wind_plot_df = ontario_wind_df[["Date", "HE", "Combined_Avg"]].copy()
        ontario_wind_plot_df = ontario_wind_plot_df.rename(
            columns={"Combined_Avg": "IESO Wind Forecast (StormVista Combined Avg)"}
        )

        wind_generation_df["Date"] = pd.to_datetime(wind_generation_df["Date"]).dt.date

        wind_generation_df = wind_generation_df.merge(
            ontario_wind_plot_df,
            on=["Date", "HE"],
            how="left"
        )

    # Plot Line Chart
    wind_generation_plot_names = list(wind_generation_names)
    if "IESO Wind Forecast (StormVista Combined Avg)" in wind_generation_df.columns:
        wind_generation_plot_names.append("IESO Wind Forecast (StormVista Combined Avg)")

    wind_generation_fig = plotly_line_chart(
        wind_generation_df,
        x="Timestamp",
        y=wind_generation_plot_names
    )
    st.plotly_chart(wind_generation_fig)

    # Generation on Maintenance for PJM, NYISO, ISONE
    gom_df = pull_data(api_key, gom_sids, start, end, "D")
    gom_fig = plotly_line_chart(gom_df, x="Date", y=list(gom_sids.keys()))
    st.plotly_chart(gom_fig)

    # Date Selection
    selected_date = st.date_input("Enter a date", value=today, key=315)
    oic_df = oic_scrape(selected_date)
    if oic_df.empty:
        st.write("No OIC Data Available")
    else:
        st.dataframe(oic_df)

    # <editor-fold desc="Heatmap Showing OPA NY Generators Output code">
        zone_j = {
            "Poletti 500 MW CC (Gas)": 31302,
            "Astoria Energy (Gas)": 31298,
            "Astoria Generating Station (Gas)": 31299,
            "Ravenswood (Gas)": 31303,
            "Bayonne Energy Center (Gas)": 64770,
            "Arthur Kill Generating Station (Gas)": 66081,
        }
        zone_k = {
            "E.F. Barrett (Gas)": 31301,
            "Port Jefferson (Gas)": 31304,
            "Caithness Long Island Energy Center (Gas)": 108433,
            "Northport (Gas)": 108443,
            "Pinelawn Power LLC (Gas)": 108444,
        }
        zone_g = {
            "Danskammer Generating Station (Gas)": 4171,
            "Bowline Point (Gas)": 4168,
            "Roseton Generating Station (Gas)": 4181,
            "CPV Valley Energy Center (Gas)": 108436,
            "Cricket Valley Energy (Gas)": 108437,
        }
        zone_f = {
            "Athens Generating Plant (Gas)": 4780,
            "Bethlehem Energy Center (Gas)": 54566,
            "Empire Generating Co LLC (Gas)": 47582,
            "Blenheim Gilboa (Pumped Storage)": 4167,
            "Indeck Corinth Energy Center (Gas)": 108439,
            "Rensselaer Cogen (Gas)": 108445,
            "Selkirk Cogen (Gas)": 108447,
        }
        zones_ab = {
            "R.E. Ginna Nuclear Power Plant (Nuclear)": 5648,
            "Arkwright Summit Wind Farm LLC (Wind)": 108431,
            "Ball Hill Wind Energy, LLC (Wind)": 108432,
            "High Sheldon Wind Farm (Wind)": 108438,
            "Indeck Olean Energy Center (Gas)": 108440,
            "Indeck Yerkes Energy Center (Gas)": 108441,
            "Lockport Energy Associates LP (Gas)": 108442,
        }
        zones_ced = {
            "Oswego Harbor Power (Oil)": 4179,
            "Nine Mile-Indep.-Fitz. (Nuclear/Gas)": 4177,
            "Maple Ridge Wind Farm (Wind)": 17203,
            "Zone D Wind (Wind)": 59440,
            "Carr Street Generating Station (Gas)": 108434,
            "Cohocton - Dutch Hill Wind (Wind)": 108435,
            "Saranac - Route 22 (Gas/Solar)": 108446,
        }

        zone_choice = st.selectbox("Select a zone", ("Zones AB", "Zones CED", "Zone F", "Zone G", "Zone J", "Zone K"),
                                   key=82035730)
        metric_choice = st.selectbox("Choose a metric", ("OPA Output", "OPA Output D/D"), key=7352370)

        left, right = st.columns(2)
        with left:
            start = st.date_input("Start", value=today, key="generation5")
        with right:
            end = st.date_input("End", value=today, key="generation6")

        if zone_choice == "Zones AB":
            if metric_choice == "OPA Output":
                df = pull_data(api_key, zones_ab, start, end, "H")
                opa_df = df[df["HE"].between(8, 23)].groupby("Date").mean().round(0).fillna(0).drop(columns="HE")
                fig = px.imshow(opa_df, text_auto=True, aspect="auto", color_continuous_scale="plasma")
                st.plotly_chart(fig, width="stretch")
            elif metric_choice == "OPA Output D/D":
                df = pull_data(api_key, zones_ab, start, end, "H")
                opa_df = df[df["HE"].between(8, 23)].groupby("Date").mean().round(0).fillna(0).drop(columns="HE")
                delta_df = opa_df.diff().round(0).fillna(0)
                fig = px.imshow(delta_df, text_auto=True, aspect="auto", color_continuous_scale="plasma")
                st.plotly_chart(fig, width="stretch")
        elif zone_choice == "Zones CED":
            if metric_choice == "OPA Output":
                df = pull_data(api_key, zones_ced, start, end, "H")
                opa_df = df[df["HE"].between(8, 23)].groupby("Date").mean().round(0).fillna(0).drop(columns="HE")
                fig = px.imshow(opa_df, text_auto=True, aspect="auto", color_continuous_scale="plasma")
                st.plotly_chart(fig, width="stretch")
            elif metric_choice == "OPA Output D/D":
                df = pull_data(api_key, zones_ced, start, end, "H")
                opa_df = df[df["HE"].between(8, 23)].groupby("Date").mean().round(0).fillna(0).drop(columns="HE")
                delta_df = opa_df.diff().round(0).fillna(0)
                fig = px.imshow(delta_df, text_auto=True, aspect="auto", color_continuous_scale="plasma")
                st.plotly_chart(fig, width="stretch")
        elif zone_choice == "Zone F":
            if metric_choice == "OPA Output":
                df = pull_data(api_key, zone_f, start, end, "H")
                opa_df = df[df["HE"].between(8, 23)].groupby("Date").mean().round(0).fillna(0).drop(columns="HE")
                fig = px.imshow(opa_df, text_auto=True, aspect="auto", color_continuous_scale="plasma")
                st.plotly_chart(fig, width="stretch")
            elif metric_choice == "OPA Output D/D":
                df = pull_data(api_key, zone_f, start, end, "H")
                opa_df = df[df["HE"].between(8, 23)].groupby("Date").mean().round(0).fillna(0).drop(columns="HE")
                delta_df = opa_df.diff().round(0).fillna(0)
                fig = px.imshow(delta_df, text_auto=True, aspect="auto", color_continuous_scale="plasma")
                st.plotly_chart(fig, width="stretch")
        elif zone_choice == "Zone G":
            if metric_choice == "OPA Output":
                df = pull_data(api_key, zone_g, start, end, "H")
                opa_df = df[df["HE"].between(8, 23)].groupby("Date").mean().round(0).fillna(0).drop(columns="HE")
                fig = px.imshow(opa_df, text_auto=True, aspect="auto", color_continuous_scale="plasma")
                st.plotly_chart(fig, width="stretch")
            elif metric_choice == "OPA Output D/D":
                df = pull_data(api_key, zone_g, start, end, "H")
                opa_df = df[df["HE"].between(8, 23)].groupby("Date").mean().round(0).fillna(0).drop(columns="HE")
                delta_df = opa_df.diff().round(0).fillna(0)
                fig = px.imshow(delta_df, text_auto=True, aspect="auto", color_continuous_scale="plasma")
                st.plotly_chart(fig, width="stretch")
        elif zone_choice == "Zone J":
            if metric_choice == "OPA Output":
                df = pull_data(api_key, zone_j, start, end, "H")
                opa_df = df[df["HE"].between(8, 23)].groupby("Date").mean().round(0).fillna(0).drop(columns="HE")
                fig = px.imshow(opa_df, text_auto=True, aspect="auto", color_continuous_scale="plasma")
                st.plotly_chart(fig, width="stretch")
            elif metric_choice == "OPA Output D/D":
                df = pull_data(api_key, zone_j, start, end, "H")
                opa_df = df[df["HE"].between(8, 23)].groupby("Date").mean().round(0).fillna(0).drop(columns="HE")
                delta_df = opa_df.diff().round(0).fillna(0)
                fig = px.imshow(delta_df, text_auto=True, aspect="auto", color_continuous_scale="plasma")
                st.plotly_chart(fig, width="stretch")
        elif zone_choice == "Zone K":
            if metric_choice == "OPA Output":
                df = pull_data(api_key, zone_k, start, end, "H")
                opa_df = df[df["HE"].between(8, 23)].groupby("Date").mean().round(0).fillna(0).drop(columns="HE")
                fig = px.imshow(opa_df, text_auto=True, aspect="auto", color_continuous_scale="plasma")
                st.plotly_chart(fig, width="stretch")
            elif metric_choice == "OPA Output D/D":
                df = pull_data(api_key, zone_k, start, end, "H")
                opa_df = df[df["HE"].between(8, 23)].groupby("Date").mean().round(0).fillna(0).drop(columns="HE")
                delta_df = opa_df.diff().round(0).fillna(0)
                fig = px.imshow(delta_df, text_auto=True, aspect="auto", color_continuous_scale="plasma")
                st.plotly_chart(fig, width="stretch")

        # </editor-fold>

    # <editor-fold desc="Generation Variables Comparison Plot Code">
        zone_j = {
            "Poletti 500 MW CC (Gas)": 31302,
            "Astoria Energy (Gas)": 31298,
            "Astoria Generating Station (Gas)": 31299,
            "Ravenswood (Gas)": 31303,
            "Bayonne Energy Center (Gas)": 64770,
            "Arthur Kill Generating Station (Gas)": 66081,
        }
        zone_k = {
            "E.F. Barrett (Gas)": 31301,
            "Port Jefferson (Gas)": 31304,
            "Caithness Long Island Energy Center (Gas)": 108433,
            "Northport (Gas)": 108443,
            "Pinelawn Power LLC (Gas)": 108444,
        }
        zone_g = {
            "Danskammer Generating Station (Gas)": 4171,
            "Bowline Point (Gas)": 4168,
            "Roseton Generating Station (Gas)": 4181,
            "CPV Valley Energy Center (Gas)": 108436,
            "Cricket Valley Energy (Gas)": 108437,
        }
        zone_f = {
            "Athens Generating Plant (Gas)": 4780,
            "Bethlehem Energy Center (Gas)": 54566,
            "Empire Generating Co LLC (Gas)": 47582,
            "Blenheim Gilboa (Pumped Storage)": 4167,
            "Indeck Corinth Energy Center (Gas)": 108439,
            "Rensselaer Cogen (Gas)": 108445,
            "Selkirk Cogen (Gas)": 108447,
        }
        zones_ab = {
            "R.E. Ginna Nuclear Power Plant (Nuclear)": 5648,
            "Arkwright Summit Wind Farm LLC (Wind)": 108431,
            "Ball Hill Wind Energy, LLC (Wind)": 108432,
            "High Sheldon Wind Farm (Wind)": 108438,
            "Indeck Olean Energy Center (Gas)": 108440,
            "Indeck Yerkes Energy Center (Gas)": 108441,
            "Lockport Energy Associates LP (Gas)": 108442,
        }
        zones_ced = {
            "Oswego Harbor Power (Oil)": 4179,
            "Nine Mile-Indep.-Fitz. (Nuclear/Gas)": 4177,
            "Maple Ridge Wind Farm (Wind)": 17203,
            "Zone D Wind (Wind)": 59440,
            "Carr Street Generating Station (Gas)": 108434,
            "Cohocton - Dutch Hill Wind (Wind)": 108435,
            "Saranac - Route 22 (Gas/Solar)": 108446,
        }

        zone_choice = st.selectbox("Select a zone", ("Zones AB", "Zones CED", "Zone F", "Zone G", "Zone J", "Zone K"),
                                   key=1412412)
        left, right = st.columns(2)
        with left:
            start = st.date_input("Start", value=today, key=849184)
        with right:
            end = st.date_input("End", value=today, key=925803958)

        if zone_choice == "Zones AB":
            df = pull_data(api_key, zones_ab, start, end, "H")
            df["Date"] = pd.to_datetime(df["Date"])
            df["Timeseries"] = df["Date"] + pd.to_timedelta(df["HE"] - 1, unit="h")
            df = df.sort_values("Timeseries")
            gen_fig = px.line(df, x="Timeseries", y=list(zones_ab.keys()), markers=True)
            st.plotly_chart(gen_fig, width="stretch", key="plot")
        elif zone_choice == "Zones CED":
            df = pull_data(api_key, zones_ced, start, end, "H")
            df["Date"] = pd.to_datetime(df["Date"])
            df["Timeseries"] = df["Date"] + pd.to_timedelta(df["HE"] - 1, unit="h")
            df = df.sort_values("Timeseries")
            gen_fig = px.line(df, x="Timeseries", y=list(zones_ced.keys()), markers=True)
            st.plotly_chart(gen_fig, width="stretch", key="plot")
        elif zone_choice == "Zone F":
            df = pull_data(api_key, zone_f, start, end, "H")
            df["Date"] = pd.to_datetime(df["Date"])
            df["Timeseries"] = df["Date"] + pd.to_timedelta(df["HE"] - 1, unit="h")
            df = df.sort_values("Timeseries")
            gen_fig = px.line(df, x="Timeseries", y=list(zone_f.keys()), markers=True)
            st.plotly_chart(gen_fig, width="stretch", key="plot")
        elif zone_choice == "Zone G":
            df = pull_data(api_key, zone_g, start, end, "H")
            df["Date"] = pd.to_datetime(df["Date"])
            df["Timeseries"] = df["Date"] + pd.to_timedelta(df["HE"] - 1, unit="h")
            df = df.sort_values("Timeseries")
            gen_fig = px.line(df, x="Timeseries", y=list(zone_g.keys()), markers=True)
            st.plotly_chart(gen_fig, width="stretch", key="plot")
        elif zone_choice == "Zone J":
            df = pull_data(api_key, zone_j, start, end, "H")
            df["Date"] = pd.to_datetime(df["Date"])
            df["Timeseries"] = df["Date"] + pd.to_timedelta(df["HE"] - 1, unit="h")
            df = df.sort_values("Timeseries")
            gen_fig = px.line(df, x="Timeseries", y=list(zone_j.keys()), markers=True)
            st.plotly_chart(gen_fig, width="stretch", key="plot")
        elif zone_choice == "Zone K":
            df = pull_data(api_key, zone_k, start, end, "H")
            df["Date"] = pd.to_datetime(df["Date"])
            df["Timeseries"] = df["Date"] + pd.to_timedelta(df["HE"] - 1, unit="h")
            df = df.sort_values("Timeseries")
            gen_fig = px.line(df, x="Timeseries", y=list(zone_k.keys()), markers=True)
            st.plotly_chart(gen_fig, width="stretch", key="plot")

        # </editor-fold>

with congestion:
    outage_schedule_df = outage_schedule_scrape()

    # Date Selection
    left, right = st.columns(2)
    with left:
        start = st.date_input("Enter a start date", value=today, key=935)
    with right:
        end = st.date_input("Enter an end date", value=today, key=843)

    # Equipment Type Selection
    equipment_type_choice = st.selectbox("Select Equipment Type", ("Line", "Transformer"))
    if equipment_type_choice == "Line":
        outage_schedule_df = outage_schedule_df[outage_schedule_df["Equipment Type"] == "LINE"]
    else:
        outage_schedule_df = outage_schedule_df[outage_schedule_df["Equipment Type"] == "TRANSFORMER"]

    # Filtering Outage DF
    outage_schedule_df = outage_schedule_df[
        (outage_schedule_df["Start Date"].dt.date <= end) &
        (outage_schedule_df["End Date"].dt.date >= start)
        ]
    st.dataframe(outage_schedule_df)

    left, right = st.columns(2)
    with left:
        # Date Selection
        selected_date = st.date_input("Enter a date", value=today, key=325)
        da_outage_df = da_outages_scrape(selected_date)
        st.dataframe(da_outage_df)

    with right:
        # Date Selection
        selected_date = st.date_input("Enter a date", value=today, key=335)
        rt_outage_df = rt_outages_scrape(selected_date)
        st.dataframe(rt_outage_df)


    congestion_choice = st.selectbox("Select Congestion", ("DAM", "RTM"))
    selected_date = st.date_input("Enter a date", value=today, key=258)

    if congestion_choice == "DAM":
        dam_congestion_df = dam_congestion_scrape(selected_date)
        dam_congestion_df, dam_congestion_pivoted_df, dam_fig = build_congestion_pivot_and_stacked_chart(
            dam_congestion_df)

        # Create Table
        st.dataframe(dam_congestion_pivoted_df)

        # Plot Stacked Bar Chart
        st.plotly_chart(dam_fig)

        # Short-Term DAM CIT Tool
        dam_clean_print_df = find_clean_prints(dam_congestion_pivoted_df)
        dam_zonal_lmps_df = dam_zonal_lmps_scrape(selected_date)
        dam_gen_lmps_df = dam_gen_lmps_scrape(selected_date)

        st.dataframe(dam_clean_print_df)

        if not dam_clean_print_df.empty:
            dam_clean_print_df = dam_clean_print_df.copy()
            dam_clean_print_df["Clean Print Label"] = (
                    "HE "
                    + dam_clean_print_df["HE"].astype(str)
                    + " | "
                    + dam_clean_print_df["Limiting Facility"].astype(str)
                    + " | "
                    + dam_clean_print_df["Contingency"].astype(str)
            )

            selected_clean_print = st.selectbox(
                "Select a clean print to examine",
                dam_clean_print_df["Clean Print Label"].tolist(),
                key=903
            )

            selected_row = dam_clean_print_df[
                dam_clean_print_df["Clean Print Label"] == selected_clean_print
                ].iloc[0]

            selected_he = selected_row["HE"]
            selected_cc = selected_row["Constraint Cost($)"]

            # Filter zonal MCCs at clean print hour
            zonal_hour_df = dam_zonal_lmps_df[dam_zonal_lmps_df["HE"] == selected_he].copy()
            zonal_hour_df["Shift Factor"] = ((zonal_hour_df["MCC"] / selected_cc) * 100).round(2)
            zonal_hour_df = zonal_hour_df[zonal_hour_df["Shift Factor"] != 0]

            # Filter gen MCCs at clean print hour
            gen_hour_df = dam_gen_lmps_df[dam_gen_lmps_df["HE"] == selected_he].copy()
            gen_hour_df["Shift Factor"] = ((gen_hour_df["MCC"] / selected_cc) * 100).round(2)
            gen_hour_df = gen_hour_df[gen_hour_df["Shift Factor"] != 0]

            st.write("Zonal DAM MCCs")
            st.dataframe(zonal_hour_df)

            st.write("Gen DAM MCCs")
            st.dataframe(gen_hour_df)

    else:
        rtm_congestion_df = rtm_congestion_scrape(selected_date)
        rtm_congestion_df, rtm_congestion_pivoted_df, rtm_fig = build_congestion_pivot_and_stacked_chart(
            rtm_congestion_df)

        # Create Table
        st.dataframe(rtm_congestion_pivoted_df)

        # Plot Stacked Bar Chart
        st.plotly_chart(rtm_fig)

        # Short-Term RTM CIT Tool
        rtm_clean_print_df = find_clean_prints(rtm_congestion_pivoted_df)
        st.dataframe(rtm_clean_print_df)

    # render_market_analysis_tool(embedded=True)

    render_constraint_impact_tool(embedded=True)