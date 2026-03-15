from pathlib import Path

import pandas as pd


def strip_whitespace(file_path):
    df = pd.read_csv(file_path)
    df.columns = df.columns.str.strip()

    for col in df.select_dtypes(include="object").columns:
        df[col] = df[col].astype("string").str.strip()

    return df


def add_time_cols(df, ts_col):
    df[ts_col] = pd.to_datetime(df[ts_col], errors="coerce")
    df["Date"] = df[ts_col].dt.date
    df["HE"] = df[ts_col].dt.hour
    df["Month"] = df[ts_col].dt.month
    df["Year"] = df[ts_col].dt.year
    return df


def add_date_parts(df, date_col):
    dt_series = pd.to_datetime(df[date_col], errors="coerce")
    df[date_col] = dt_series.dt.date
    df["Month"] = dt_series.dt.month
    df["Year"] = dt_series.dt.year
    return df


def clean_source_cols(df):
    if "source_date" in df.columns:
        df["source_date"] = pd.to_datetime(
            df["source_date"].astype(str),
            format="%Y%m%d",
            errors="coerce"
        )
    return df


def parse_datetime_if_exists(df, col, fmt=None):
    if col in df.columns:
        df[col] = pd.to_datetime(df[col], format=fmt, errors="coerce")
    return df


def add_time_cols_safe(df, col):
    if col in df.columns:
        df = add_time_cols(df, col)
    return df


def add_date_parts_safe(df, col):
    if col in df.columns:
        df = add_date_parts(df, col)
    return df


def sort_if_possible(df, sort_cols):
    sort_cols = [col for col in sort_cols if col in df.columns]
    if sort_cols:
        df = df.sort_values(sort_cols).reset_index(drop=True)
    else:
        df = df.reset_index(drop=True)
    return df


def process_active_transmission_nodes(df):
    df = df.rename(columns={
        "Node Name": "Node",
        "PTID": "PTID",
        "Subzone": "Subzone",
        "Zone": "Zone"
    })

    cols = ["Node", "PTID", "Subzone", "Zone"]
    cols = [col for col in cols if col in df.columns]
    df = df[cols]
    df = sort_if_possible(df, ["Zone", "Subzone", "Node"])
    return df


def process_atc_ttc(df):
    df = df.rename(columns={
        "Interface Name": "Interface",
        "Time Stamp": "Time Stamp",
        "TTC (DAM)": "DAM TTC",
        "ATC (DAM)": "DAM ATC",
        "TTC (HAM) xx:00": "HAM TTC 00",
        "ATC (HAM) xx:00": "HAM ATC 00",
        "TTC (HAM) xx:15": "HAM TTC 15",
        "ATC (HAM) xx:15": "HAM ATC 15",
        "TTC (HAM) xx:30": "HAM TTC 30",
        "ATC (HAM) xx:30": "HAM ATC 30",
        "TTC (HAM) xx:45": "HAM TTC 45",
        "ATC (HAM) xx:45": "HAM ATC 45"
    })

    df = add_time_cols(df, "Time Stamp")
    df = clean_source_cols(df)
    df = sort_if_possible(df, ["Time Stamp", "Interface"])
    return df


def process_btm_da_forecast(df):
    df = df.rename(columns={
        "Time Stamp": "Time Stamp",
        "Time Zone": "Time Zone",
        "Zone Name": "Zone",
        "MW Value": "BTM Solar Forecast MW"
    })

    df = add_time_cols(df, "Time Stamp")
    df = clean_source_cols(df)
    df = sort_if_possible(df, ["Time Stamp", "Zone"])
    return df


def process_btm_estimated_actual(df):
    df = df.rename(columns={
        "Time Stamp": "Time Stamp",
        "Time Zone": "Time Zone",
        "Zone Name": "Zone",
        "MW Value": "BTM Solar Actual MW"
    })

    df = add_time_cols(df, "Time Stamp")
    df = clean_source_cols(df)
    df = sort_if_possible(df, ["Time Stamp", "Zone"])
    return df


def process_da_lbmp_gen(df):
    df = df.rename(columns={
        "Time Stamp": "Time Stamp",
        "Name": "Generator",
        "LBMP ($/MWHr)": "LMP",
        "Marginal Cost Losses ($/MWHr)": "MLC",
        "Marginal Cost Congestion ($/MWHr)": "MCC"
    })

    df = add_time_cols(df, "Time Stamp")
    df = clean_source_cols(df)

    cols = [
        "Time Stamp", "Date", "HE", "Month", "Year",
        "Generator", "PTID", "LMP", "MLC", "MCC",
        "source_date", "source_file"
    ]
    cols = [col for col in cols if col in df.columns]
    df = df[cols]
    df = sort_if_possible(df, ["Time Stamp", "Generator"])
    return df


def process_da_lbmp_zone(df):
    df = df.rename(columns={
        "Time Stamp": "Time Stamp",
        "Name": "Zone",
        "LBMP ($/MWHr)": "LMP",
        "Marginal Cost Losses ($/MWHr)": "MLC",
        "Marginal Cost Congestion ($/MWHr)": "MCC"
    })

    df = add_time_cols(df, "Time Stamp")
    df = clean_source_cols(df)

    cols = [
        "Time Stamp", "Date", "HE", "Month", "Year",
        "Zone", "PTID", "LMP", "MLC", "MCC",
        "source_date", "source_file"
    ]
    cols = [col for col in cols if col in df.columns]
    df = df[cols]
    df = sort_if_possible(df, ["Time Stamp", "Zone"])
    return df


def process_dam_imer(df):
    df = df.rename(columns={
        "Timestamp": "Time Stamp",
        "Zone": "Zone",
        "LBMP - ($/MWh)": "LMP",
        "VOM - ($/MWh)": "VOM",
        "Tons of Carbon per mmBTU": "CO2 Tons per mmBTU",
        "Tons of NOx per mmBTU": "NOx Tons per mmBTU",
        "Implied Heat Rate - IHRi (mmBTU/MWh)": "IHR",
        "IMER - CO2 (tons/MWh)": "IMER CO2",
        "IMER - NOx (tons/MWh)": "IMER NOx"
    })

    df = add_time_cols(df, "Time Stamp")
    df = clean_source_cols(df)

    cols = [
        "Time Stamp", "Date", "HE", "Month", "Year",
        "Zone", "LMP", "VOM", "CO2 Tons per mmBTU", "NOx Tons per mmBTU",
        "IHR", "IMER CO2", "IMER NOx",
        "source_date", "source_file"
    ]
    cols = [col for col in cols if col in df.columns]
    df = df[cols]
    df = sort_if_possible(df, ["Time Stamp", "Zone"])
    return df


def process_dam_limiting_constraints(df):
    df = df.rename(columns={
        "Time Stamp": "Time Stamp",
        "Time Zone": "Time Zone",
        "Limiting Facility": "Limiting Facility",
        "Facility PTID": "PTID",
        "Contingency": "Contingency",
        "Constraint Cost($)": "Constraint Cost"
    })

    df = add_time_cols(df, "Time Stamp")
    df = clean_source_cols(df)

    if "Contingency" in df.columns:
        df["Contingency"] = df["Contingency"].astype("string").str.strip()

    cols = [
        "Time Stamp", "Date", "HE", "Month", "Year",
        "Time Zone", "Limiting Facility", "PTID", "Contingency", "Constraint Cost",
        "source_date", "source_file"
    ]
    cols = [col for col in cols if col in df.columns]
    df = df[cols]
    df = sort_if_possible(df, ["Time Stamp", "Limiting Facility"])
    return df


def process_damasp(df):
    df = df.rename(columns={
        "Time Stamp": "Time Stamp",
        "Time Zone": "Time Zone",
        "Name": "Zone",
        "10 Min Spinning Reserve ($/MWHr)": "10 Min Spin",
        "10 Min Non-Synchronous Reserve ($/MWHr)": "10 Min Non-Sync",
        "30 Min Operating Reserve ($/MWHr)": "30 Min OR",
        "NYCA Regulation Capacity ($/MWHr)": "Reg Cap"
    })

    df = add_time_cols(df, "Time Stamp")
    df = clean_source_cols(df)

    cols = [
        "Time Stamp", "Date", "HE", "Month", "Year",
        "Time Zone", "Zone", "PTID",
        "10 Min Spin", "10 Min Non-Sync", "30 Min OR", "Reg Cap",
        "source_date", "source_file"
    ]
    cols = [col for col in cols if col in df.columns]
    df = df[cols]
    df = sort_if_possible(df, ["Time Stamp", "Zone"])
    return df


def process_erie_circulation_da(df):
    df = df.rename(columns={
        "Timestamp": "Time Stamp",
        "Lake Erie Circulation (MWH)": "Lake Erie Circulation"
    })

    df = add_time_cols(df, "Time Stamp")
    df = clean_source_cols(df)

    cols = [
        "Time Stamp", "Date", "HE", "Month", "Year",
        "Lake Erie Circulation",
        "source_date", "source_file"
    ]
    cols = [col for col in cols if col in df.columns]
    df = df[cols]
    df = sort_if_possible(df, ["Time Stamp"])
    return df


def process_erie_circulation_rt(df):
    df = df.rename(columns={
        "Timestamp": "Time Stamp",
        "Lake Erie Circulation (MWH)": "Lake Erie Circulation"
    })

    df = add_time_cols(df, "Time Stamp")
    df = clean_source_cols(df)

    cols = [
        "Time Stamp", "Date", "HE", "Month", "Year",
        "Lake Erie Circulation",
        "source_date", "source_file"
    ]
    cols = [col for col in cols if col in df.columns]
    df = df[cols]
    df = sort_if_possible(df, ["Time Stamp"])
    return df


def process_ext_rto_cts_price(df):
    df = df.rename(columns={
        "RTC Execution Time": "RTC Execution Time",
        "RTC End Time Stamp": "RTC End Time Stamp",
        "RTC Timestep": "RTC Timestep",
        "Gen Name": "Generator",
        "Gen PTID": "PTID",
        "Gen LBMP": "Gen LMP",
        "External RTO CTS Price": "External CTS Price"
    })

    df["RTC Execution Time"] = pd.to_datetime(df["RTC Execution Time"], errors="coerce")
    df["RTC End Time Stamp"] = pd.to_datetime(df["RTC End Time Stamp"], errors="coerce")
    df["Date"] = df["RTC Execution Time"].dt.date
    df["HE"] = df["RTC Execution Time"].dt.hour
    df["Month"] = df["RTC Execution Time"].dt.month
    df["Year"] = df["RTC Execution Time"].dt.year

    df = clean_source_cols(df)

    if "Gen LMP" in df.columns and "External CTS Price" in df.columns:
        df["CTS Spread"] = df["Gen LMP"] - df["External CTS Price"]

    cols = [
        "RTC Execution Time", "RTC End Time Stamp", "Date", "HE", "Month", "Year",
        "RTC Timestep", "Generator", "PTID", "Gen LMP", "External CTS Price", "CTS Spread",
        "source_date", "source_file"
    ]
    cols = [col for col in cols if col in df.columns]
    df = df[cols]
    df = sort_if_possible(df, ["RTC Execution Time", "Generator", "RTC Timestep"])
    return df


def process_external_limits_flows(df):
    df = df.rename(columns={
        "Timestamp": "Time Stamp",
        "Interface Name": "Interface",
        "Point ID": "PTID",
        "Flow (MWH)": "Flow",
        "Positive Limit (MWH)": "Positive Limit",
        "Negative Limit (MWH)": "Negative Limit"
    })

    df = add_time_cols(df, "Time Stamp")
    df = clean_source_cols(df)

    cols = [
        "Time Stamp", "Date", "HE", "Month", "Year",
        "Interface", "PTID", "Flow", "Positive Limit", "Negative Limit",
        "source_date", "source_file"
    ]
    cols = [col for col in cols if col in df.columns]
    df = df[cols]
    df = sort_if_possible(df, ["Time Stamp", "Interface"])
    return df


def process_gen_maint_report(df):
    df = df.rename(columns={
        "Date": "Date",
        "Forecasted Generation Outage (MW)": "Forecasted Gen Outage MW"
    })

    df = add_date_parts(df, "Date")

    cols = ["Date", "Month", "Year", "Forecasted Gen Outage MW"]
    cols = [col for col in cols if col in df.columns]
    df = df[cols]
    df = sort_if_possible(df, ["Date"])
    return df


def process_generator_names(df):
    df = df.rename(columns={
        "Generator Name": "Generator",
        "Generator PTID": "PTID",
        "Aggregation PTID": "Aggregation PTID",
        "Subzone": "Subzone",
        "Zone": "Zone",
        "Latitude": "Latitude",
        "Longitude": "Longitude",
        "Active": "Active"
    })

    cols = [
        "Generator", "PTID", "Aggregation PTID",
        "Subzone", "Zone", "Latitude", "Longitude", "Active"
    ]
    cols = [col for col in cols if col in df.columns]
    df = df[cols]
    df = sort_if_possible(df, ["Zone", "Subzone", "Generator"])
    return df


def process_integrated_rt_lbmp_gen(df):
    df = df.rename(columns={
        "Time Stamp": "Time Stamp",
        "Name": "Generator",
        "LBMP ($/MWHr)": "LMP",
        "Marginal Cost Losses ($/MWHr)": "MLC",
        "Marginal Cost Congestion ($/MWHr)": "MCC"
    })

    df = add_time_cols(df, "Time Stamp")
    df = clean_source_cols(df)

    cols = [
        "Time Stamp", "Date", "HE", "Month", "Year",
        "Generator", "PTID", "LMP", "MLC", "MCC",
        "source_date", "source_file"
    ]
    cols = [col for col in cols if col in df.columns]
    df = df[cols]
    df = sort_if_possible(df, ["Time Stamp", "Generator"])
    return df


def process_integrated_rt_lbmp_zone(df):
    df = df.rename(columns={
        "Time Stamp": "Time Stamp",
        "Name": "Zone",
        "LBMP ($/MWHr)": "LMP",
        "Marginal Cost Losses ($/MWHr)": "MLC",
        "Marginal Cost Congestion ($/MWHr)": "MCC"
    })

    df = add_time_cols(df, "Time Stamp")
    df = clean_source_cols(df)

    cols = [
        "Time Stamp", "Date", "HE", "Month", "Year",
        "Zone", "PTID", "LMP", "MLC", "MCC",
        "source_date", "source_file"
    ]
    cols = [col for col in cols if col in df.columns]
    df = df[cols]
    df = sort_if_possible(df, ["Time Stamp", "Zone"])
    return df


def process_isolf(df):
    df = df.rename(columns={
        "Time Stamp": "Time Stamp",
        "Capitl": "CAPITL",
        "Centrl": "CENTRL",
        "Dunwod": "DUNWOD",
        "Genese": "GENESE",
        "Hud Vl": "HUD VL",
        "Longil": "LONGIL",
        "Mhk Vl": "MHK VL",
        "Millwd": "MILLWD",
        "N.Y.C.": "N.Y.C.",
        "North": "NORTH",
        "West": "WEST",
        "NYISO": "NYISO"
    })

    df = add_time_cols(df, "Time Stamp")
    df = clean_source_cols(df)

    cols = [
        "Time Stamp", "Date", "HE", "Month", "Year",
        "CAPITL", "CENTRL", "DUNWOD", "GENESE", "HUD VL",
        "LONGIL", "MHK VL", "MILLWD", "N.Y.C.", "NORTH", "WEST", "NYISO",
        "source_date", "source_file"
    ]
    cols = [col for col in cols if col in df.columns]
    df = df[cols]
    df = sort_if_possible(df, ["Time Stamp"])
    return df


def process_lfweather(df):
    df = df.rename(columns={
        "Forecast Date": "Forecast Date",
        "Vintage Date": "Vintage Date",
        "Vintage": "Vintage",
        "Station ID": "Station",
        "Max Temp": "Max Temp",
        "Min Temp": "Min Temp",
        "Max Wet Bulb": "Max Wet Bulb",
        "Min Wet Bulb": "Min Wet Bulb"
    })

    df["Forecast Date"] = pd.to_datetime(df["Forecast Date"], errors="coerce")
    df["Vintage Date"] = pd.to_datetime(df["Vintage Date"], errors="coerce")
    df["Month"] = df["Forecast Date"].dt.month
    df["Year"] = df["Forecast Date"].dt.year

    if "Max Temp" in df.columns and "Min Temp" in df.columns:
        df["Avg Temp"] = (df["Max Temp"] + df["Min Temp"]) / 2

    if "Max Wet Bulb" in df.columns and "Min Wet Bulb" in df.columns:
        df["Avg Wet Bulb"] = (df["Max Wet Bulb"] + df["Min Wet Bulb"]) / 2

    df = clean_source_cols(df)

    cols = [
        "Forecast Date", "Vintage Date", "Month", "Year",
        "Vintage", "Station",
        "Max Temp", "Min Temp", "Avg Temp",
        "Max Wet Bulb", "Min Wet Bulb", "Avg Wet Bulb",
        "source_date", "source_file"
    ]
    cols = [col for col in cols if col in df.columns]
    df = df[cols]
    df = sort_if_possible(df, ["Forecast Date", "Vintage Date", "Station"])
    return df


def process_load_names(df):
    df = df.rename(columns={
        "Load Name": "Load",
        "PTID": "PTID",
        "Subzone": "Subzone",
        "Zone": "Zone"
    })

    cols = ["Load", "PTID", "Subzone", "Zone"]
    cols = [col for col in cols if col in df.columns]
    df = df[cols]
    df = sort_if_possible(df, ["Zone", "Subzone", "Load"])
    return df


def process_op_in_commit(df):
    df = df.rename(columns={
        "Insert Time": "Insert Time",
        "Event Start Time": "Event Start Time",
        "Event End Time": "Event End Time",
        "PTID": "PTID",
        "Resource Name": "Resource",
        "Requestor (NYISO or TO)": "Requestor",
        "Commitment Type": "Commitment Type",
        "Load Zone of Resource": "Zone",
        "Commitment Reason": "Commitment Reason",
        "ARR": "ARR",
        "UOL (of committed resource)/USL(MWh)/POI INJ (MW)": "Upper Operating Limit / USL / POI Injection",
        "MW Committed/LSL(MWh)/POI WDL (MW)": "MW Committed / LSL / POI Withdrawal"
    })

    df["Insert Time"] = pd.to_datetime(df["Insert Time"], format="%d-%b-%Y %H:%M", errors="coerce")
    df["Event Start Time"] = pd.to_datetime(df["Event Start Time"], format="%d-%b-%Y %H:%M", errors="coerce")
    df["Event End Time"] = pd.to_datetime(df["Event End Time"], format="%d-%b-%Y %H:%M", errors="coerce")

    df["Date"] = df["Event Start Time"].dt.date
    df["HE"] = df["Event Start Time"].dt.hour
    df["Month"] = df["Event Start Time"].dt.month
    df["Year"] = df["Event Start Time"].dt.year

    df = clean_source_cols(df)

    cols = [
        "Insert Time", "Event Start Time", "Event End Time",
        "Date", "HE", "Month", "Year",
        "PTID", "Resource", "Requestor", "Commitment Type",
        "Zone", "Commitment Reason", "ARR",
        "Upper Operating Limit / USL / POI Injection",
        "MW Committed / LSL / POI Withdrawal",
        "source_date", "source_file"
    ]
    cols = [col for col in cols if col in df.columns]
    df = df[cols]
    df = sort_if_possible(df, ["Event Start Time", "Resource"])
    return df


def process_oper_messages(df):
    df = df.rename(columns={
        "Insert Time": "Message Type",
        "Message": "Message"
    })

    if "Message Type" in df.columns:
        df["Message Type"] = df["Message Type"].astype("string").str.strip()

    if "Message" in df.columns:
        df["Message"] = df["Message"].astype("string").str.strip()
        df["Message"] = (
            df["Message"]
            .str.replace('""', '"', regex=False)
            .str.replace(r"\s+", " ", regex=True)
        )

    df = clean_source_cols(df)

    if "Message" in df.columns:
        df = df.dropna(subset=["Message"])
        df = df[df["Message"] != ""]

    cols = ["Message Type", "Message", "source_date", "source_file"]
    cols = [col for col in cols if col in df.columns]
    df = df[cols]
    df = sort_if_possible(df, ["source_date", "Message Type"])
    return df


def process_out_sched(df):
    df = df.rename(columns={
        "Timestamp": "Time Stamp",
        "PTID": "PTID",
        "Equipment Name": "Equipment",
        "Scheduled Out Date/Time": "Scheduled Out",
        "Scheduled In Date/Time": "Scheduled In"
    })

    df["Time Stamp"] = pd.to_datetime(df["Time Stamp"], errors="coerce")
    df["Scheduled Out"] = pd.to_datetime(df["Scheduled Out"], errors="coerce")
    df["Scheduled In"] = pd.to_datetime(df["Scheduled In"], errors="coerce")

    df["Date"] = df["Time Stamp"].dt.date
    df["HE"] = df["Time Stamp"].dt.hour
    df["Month"] = df["Time Stamp"].dt.month
    df["Year"] = df["Time Stamp"].dt.year

    if "Scheduled Out" in df.columns and "Scheduled In" in df.columns:
        df["Outage Duration Hours"] = (df["Scheduled In"] - df["Scheduled Out"]).dt.total_seconds() / 3600

    df = clean_source_cols(df)

    cols = [
        "Time Stamp", "Date", "HE", "Month", "Year",
        "PTID", "Equipment", "Scheduled Out", "Scheduled In", "Outage Duration Hours",
        "source_date", "source_file"
    ]
    cols = [col for col in cols if col in df.columns]
    df = df[cols]
    df = sort_if_possible(df, ["Time Stamp", "Equipment"])
    return df


def process_outage_schedule(df):
    df = df.rename(columns={
        "PTID": "PTID",
        "Outage ID": "Outage ID",
        "Equipment Name": "Equipment",
        "Equipment Type": "Equipment Type",
        "Date Out": "Date Out",
        "Time Out": "Time Out",
        "Date In": "Date In",
        "Time In": "Time In",
        "Called In": "Called In By",
        "Status": "Status",
        "Status Date": "Status Time",
        "Message": "Message",
        "ARR": "ARR"
    })

    df["Date Out"] = pd.to_datetime(df["Date Out"], errors="coerce")
    df["Date In"] = pd.to_datetime(df["Date In"], errors="coerce")
    df["Status Time"] = pd.to_datetime(df["Status Time"], errors="coerce")

    if "Date Out" in df.columns and "Time Out" in df.columns:
        df["Out Start"] = pd.to_datetime(
            df["Date Out"].dt.strftime("%Y-%m-%d") + " " + df["Time Out"].astype(str),
            errors="coerce"
        )

    if "Date In" in df.columns and "Time In" in df.columns:
        df["Out End"] = pd.to_datetime(
            df["Date In"].dt.strftime("%Y-%m-%d") + " " + df["Time In"].astype(str),
            errors="coerce"
        )

    if "Out Start" in df.columns and "Out End" in df.columns:
        df["Outage Duration Hours"] = (df["Out End"] - df["Out Start"]).dt.total_seconds() / 3600

    df["Month"] = df["Date Out"].dt.month
    df["Year"] = df["Date Out"].dt.year

    cols = [
        "PTID", "Outage ID", "Equipment", "Equipment Type",
        "Date Out", "Time Out", "Date In", "Time In",
        "Out Start", "Out End", "Outage Duration Hours",
        "Called In By", "Status", "Status Time", "Message", "ARR",
        "Month", "Year"
    ]
    cols = [col for col in cols if col in df.columns]
    df = df[cols]
    df = sort_if_possible(df, ["Out Start", "Equipment"])
    return df


def process_pal_integrated(df):
    df = df.rename(columns={
        "Time Stamp": "Time Stamp",
        "Time Zone": "Time Zone",
        "Name": "Zone",
        "PTID": "PTID",
        "Integrated Load": "Integrated Load"
    })

    df = add_time_cols(df, "Time Stamp")
    df = clean_source_cols(df)

    cols = [
        "Time Stamp", "Date", "HE", "Month", "Year",
        "Time Zone", "Zone", "PTID", "Integrated Load",
        "source_date", "source_file"
    ]
    cols = [col for col in cols if col in df.columns]
    df = df[cols]
    df = sort_if_possible(df, ["Time Stamp", "Zone"])
    return df


def process_pal(df):
    df = df.rename(columns={
        "Time Stamp": "Time Stamp",
        "Time Zone": "Time Zone",
        "Name": "Zone",
        "PTID": "PTID",
        "Load": "Load"
    })

    df = add_time_cols(df, "Time Stamp")
    df = clean_source_cols(df)

    cols = [
        "Time Stamp", "Date", "HE", "Month", "Year",
        "Time Zone", "Zone", "PTID", "Load",
        "source_date", "source_file"
    ]
    cols = [col for col in cols if col in df.columns]
    df = df[cols]
    df = sort_if_possible(df, ["Time Stamp", "Zone"])
    return df


def process_par_flows(df):
    df = df.rename(columns={
        "Timestamp": "Time Stamp",
        "Point ID": "PTID",
        "Flow (MWH)": "PAR Flow"
    })

    df = add_time_cols(df, "Time Stamp")
    df = clean_source_cols(df)

    cols = [
        "Time Stamp", "Date", "HE", "Month", "Year",
        "PTID", "PAR Flow",
        "source_date", "source_file"
    ]
    cols = [col for col in cols if col in df.columns]
    df = df[cols]
    df = sort_if_possible(df, ["Time Stamp", "PTID"])
    return df


def process_reference_bus_lbmp(df):
    df = df.rename(columns={
        "Time Stamp": "Time Stamp",
        "Name": "Generator",
        "LBMP ($/MWHr)": "LMP",
        "Marginal Cost Losses ($/MWHr)": "MLC",
        "Marginal Cost Congestion ($/MWHr)": "MCC"
    })

    df = add_time_cols(df, "Time Stamp")
    df = clean_source_cols(df)

    cols = [
        "Time Stamp", "Date", "HE", "Month", "Year",
        "Generator", "PTID", "LMP", "MLC", "MCC",
        "source_date", "source_file"
    ]
    cols = [col for col in cols if col in df.columns]
    df = df[cols]
    df = sort_if_possible(df, ["Time Stamp", "Generator"])
    return df


def process_rt_events(df):
    df = df.rename(columns={
        "Timestamp": "Time Stamp",
        "Message": "Message"
    })

    df = add_time_cols(df, "Time Stamp")
    df = clean_source_cols(df)

    if "Message" in df.columns:
        df["Message"] = df["Message"].astype("string").str.strip()

    cols = [
        "Time Stamp", "Date", "HE", "Month", "Year",
        "Message", "source_date", "source_file"
    ]
    cols = [col for col in cols if col in df.columns]
    df = df[cols]

    if "Message" in df.columns:
        df = df.dropna(subset=["Message"])

    df = sort_if_possible(df, ["Time Stamp"])
    return df


def process_rt_imer(df):
    df = df.rename(columns={
        "Timestamp": "Time Stamp",
        "Zone": "Zone",
        "LBMP - ($/MWh)": "LMP",
        "VOM - ($/MWh)": "VOM",
        "Tons of Carbon per mmBTU": "CO2 Tons per mmBTU",
        "Tons of NOx per mmBTU": "NOx Tons per mmBTU",
        "Implied Heat Rate - IHRi (mmBTU/MWh)": "IHR",
        "IMER - CO2 (tons/MWh)": "IMER CO2",
        "IMER - NOx (tons/MWh)": "IMER NOx"
    })

    df = add_time_cols(df, "Time Stamp")
    df = clean_source_cols(df)

    cols = [
        "Time Stamp", "Date", "HE", "Month", "Year",
        "Zone", "LMP", "VOM", "CO2 Tons per mmBTU", "NOx Tons per mmBTU",
        "IHR", "IMER CO2", "IMER NOx",
        "source_date", "source_file"
    ]
    cols = [col for col in cols if col in df.columns]
    df = df[cols]
    df = sort_if_possible(df, ["Time Stamp", "Zone"])
    return df


def process_rt_lbmp_gen(df):
    df = df.rename(columns={
        "Time Stamp": "Time Stamp",
        "Name": "Generator",
        "LBMP ($/MWHr)": "LMP",
        "Marginal Cost Losses ($/MWHr)": "MLC",
        "Marginal Cost Congestion ($/MWHr)": "MCC"
    })

    df = add_time_cols(df, "Time Stamp")
    df = clean_source_cols(df)

    cols = [
        "Time Stamp", "Date", "HE", "Month", "Year",
        "Generator", "PTID", "LMP", "MLC", "MCC",
        "source_date", "source_file"
    ]
    cols = [col for col in cols if col in df.columns]
    df = df[cols]
    df = sort_if_possible(df, ["Time Stamp", "Generator"])
    return df


def process_rt_lbmp_zone(df):
    df = df.rename(columns={
        "Time Stamp": "Time Stamp",
        "Name": "Zone",
        "LBMP ($/MWHr)": "LMP",
        "Marginal Cost Losses ($/MWHr)": "MLC",
        "Marginal Cost Congestion ($/MWHr)": "MCC"
    })

    df = add_time_cols(df, "Time Stamp")
    df = clean_source_cols(df)

    cols = [
        "Time Stamp", "Date", "HE", "Month", "Year",
        "Zone", "PTID", "LMP", "MLC", "MCC",
        "source_date", "source_file"
    ]
    cols = [col for col in cols if col in df.columns]
    df = df[cols]
    df = sort_if_possible(df, ["Time Stamp", "Zone"])
    return df


def process_rtasp(df):
    df = df.rename(columns={
        "Time Stamp": "Time Stamp",
        "Time Zone": "Time Zone",
        "Name": "Zone",
        "10 Min Spinning Reserve ($/MWHr)": "10 Min Spin",
        "10 Min Non-Synchronous Reserve ($/MWHr)": "10 Min Non-Sync",
        "30 Min Operating Reserve ($/MWHr)": "30 Min OR",
        "NYCA Regulation Capacity ($/MWHr)": "Reg Cap"
    })

    df = add_time_cols(df, "Time Stamp")
    df = clean_source_cols(df)

    cols = [
        "Time Stamp", "Date", "HE", "Month", "Year",
        "Time Zone", "Zone", "PTID",
        "10 Min Spin", "10 Min Non-Sync", "30 Min OR", "Reg Cap",
        "source_date", "source_file"
    ]
    cols = [col for col in cols if col in df.columns]
    df = df[cols]
    df = sort_if_possible(df, ["Time Stamp", "Zone"])
    return df


def process_rtfuelmix(df):
    df = df.rename(columns={
        "Time Stamp": "Time Stamp",
        "Timestamp": "Time Stamp",
        "Time Zone": "Time Zone",
        "Fuel Category": "Fuel Type",
        "Fuel Type": "Fuel Type",
        "Gen MW": "Generation MW",
        "MW": "Generation MW",
        "Value": "Generation MW"
    })

    df = add_time_cols_safe(df, "Time Stamp")
    df = clean_source_cols(df)

    cols = [
        "Time Stamp", "Date", "HE", "Month", "Year",
        "Time Zone", "Fuel Type", "Generation MW",
        "source_date", "source_file"
    ]
    cols = [col for col in cols if col in df.columns]
    if cols:
        df = df[cols]

    df = sort_if_possible(df, ["Time Stamp", "Fuel Type"])
    return df


interface_name_mapping = {
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
    "STATEN ISLAND": "Staten Island",
}


def process_ttcf(df):
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
        "FWD - TTC ALL I/S": "Base Import TTC",
        "REV - Total Transfer Cap": "Revised Export TTC",
        "REV - TTC transfer impact": "Export TTC Impact",
        "REV - TTC ALL I/S": "Base Export TTC",
    })

    df = df.drop(columns=[
        "ATI",
        "PTID",
        "ARR",
    ], errors="ignore")

    if "Interface Name" in df.columns:
        df["Interface Name"] = (
            df["Interface Name"]
            .map(interface_name_mapping)
            .fillna(df["Interface Name"])
        )

    if "Date Out" in df.columns:
        df["Date Out"] = pd.to_datetime(df["Date Out"], errors="coerce")

    if "Date In" in df.columns:
        df["Date In"] = pd.to_datetime(df["Date In"], errors="coerce")

    if "Update Date" in df.columns:
        df["Update Date"] = pd.to_datetime(df["Update Date"], errors="coerce")

    if "Date Out" in df.columns:
        df["Month"] = df["Date Out"].dt.month
        df["Year"] = df["Date Out"].dt.year

    cols = [
        "Interface Name",
        "Derate Reason/Actual Limit",
        "Date Out",
        "Time Out",
        "Date In",
        "Time In",
        "Work Scheduled By",
        "Cancellation Type",
        "Updated By",
        "Update Date",
        "Base Import TTC",
        "Revised Import TTC",
        "Import TTC Impact",
        "Base Export TTC",
        "Revised Export TTC",
        "Export TTC Impact",
        "Month",
        "Year",
        "source_date",
        "source_file",
    ]
    cols = [col for col in cols if col in df.columns]
    df = df[cols]

    df = df.sort_values(["Date Out", "Interface Name"], na_position="last").reset_index(drop=True)

    return df


def process_rt_limiting_constraints(df):
    df = df.rename(columns={
        "Time Stamp": "Time Stamp",
        "Time Zone": "Time Zone",
        "Limiting Facility": "Limiting Facility",
        "Facility PTID": "PTID",
        "Contingency": "Contingency",
        "Constraint Cost($)": "Constraint Cost"
    })

    df = add_time_cols(df, "Time Stamp")
    df = clean_source_cols(df)

    cols = [
        "Time Stamp", "Date", "HE", "Month", "Year",
        "Time Zone", "Limiting Facility", "PTID", "Contingency", "Constraint Cost",
        "source_date", "source_file"
    ]
    cols = [col for col in cols if col in df.columns]
    df = df[cols]
    df = sort_if_possible(df, ["Time Stamp", "Limiting Facility"])
    return df


def process_sc_line_outages(df):
    df = df.rename(columns={
        "Timestamp": "Time Stamp",
        "Time Stamp": "Time Stamp",
        "PTID": "PTID",
        "Equipment Name": "Equipment",
        "Out Date/Time": "Out Start",
        "Scheduled Out Date/Time": "Out Start",
        "In Date/Time": "Out End",
        "Scheduled In Date/Time": "Out End",
        "Status": "Status"
    })

    df = parse_datetime_if_exists(df, "Time Stamp")
    df = parse_datetime_if_exists(df, "Out Start")
    df = parse_datetime_if_exists(df, "Out End")

    df = add_time_cols_safe(df, "Time Stamp")
    df = clean_source_cols(df)

    if "Out Start" in df.columns and "Out End" in df.columns:
        df["Outage Duration Hours"] = (df["Out End"] - df["Out Start"]).dt.total_seconds() / 3600

    cols = [
        "Time Stamp", "Date", "HE", "Month", "Year",
        "PTID", "Equipment", "Out Start", "Out End", "Outage Duration Hours", "Status",
        "source_date", "source_file"
    ]
    cols = [col for col in cols if col in df.columns]
    if cols:
        df = df[cols]

    df = sort_if_possible(df, ["Time Stamp", "Equipment"])
    return df


def process_rt_line_outages(df):
    df = df.rename(columns={
        "Timestamp": "Time Stamp",
        "Time Stamp": "Time Stamp",
        "PTID": "PTID",
        "Equipment Name": "Equipment",
        "Out Date/Time": "Out Start",
        "Actual Out Date/Time": "Out Start",
        "In Date/Time": "Out End",
        "Actual In Date/Time": "Out End",
        "Status": "Status"
    })

    df = parse_datetime_if_exists(df, "Time Stamp")
    df = parse_datetime_if_exists(df, "Out Start")
    df = parse_datetime_if_exists(df, "Out End")

    df = add_time_cols_safe(df, "Time Stamp")
    df = clean_source_cols(df)

    if "Out Start" in df.columns and "Out End" in df.columns:
        df["Outage Duration Hours"] = (df["Out End"] - df["Out Start"]).dt.total_seconds() / 3600

    cols = [
        "Time Stamp", "Date", "HE", "Month", "Year",
        "PTID", "Equipment", "Out Start", "Out End", "Outage Duration Hours", "Status",
        "source_date", "source_file"
    ]
    cols = [col for col in cols if col in df.columns]
    if cols:
        df = df[cols]

    df = sort_if_possible(df, ["Time Stamp", "Equipment"])
    return df


PROCESSOR_MAP = {
    "active_transmission_nodes_raw.csv": process_active_transmission_nodes,
    "atc_ttc_raw.csv": process_atc_ttc,
    "btm_da_forecast_raw.csv": process_btm_da_forecast,
    "btm_estimated_actual_raw.csv": process_btm_estimated_actual,
    "da_lbmp_gen_raw.csv": process_da_lbmp_gen,
    "da_lbmp_zone_raw.csv": process_da_lbmp_zone,
    "dam_imer_raw.csv": process_dam_imer,
    "dam_limiting_constraints_raw.csv": process_dam_limiting_constraints,
    "damasp_raw.csv": process_damasp,
    "erie_circulation_da_raw.csv": process_erie_circulation_da,
    "erie_circulation_rt_raw.csv": process_erie_circulation_rt,
    "ext_rto_cts_price_raw.csv": process_ext_rto_cts_price,
    "external_limits_flows_raw.csv": process_external_limits_flows,
    "gen_maint_report_raw.csv": process_gen_maint_report,
    "generator_names_raw.csv": process_generator_names,
    "integrated_rt_lbmp_gen_raw.csv": process_integrated_rt_lbmp_gen,
    "integrated_rt_lbmp_zone_raw.csv": process_integrated_rt_lbmp_zone,
    "isolf_raw.csv": process_isolf,
    "lfweather_raw.csv": process_lfweather,
    "load_names_raw.csv": process_load_names,
    "op_in_commit_raw.csv": process_op_in_commit,
    "oper_messages_raw.csv": process_oper_messages,
    "out_sched_raw.csv": process_out_sched,
    "outage_schedule_raw.csv": process_outage_schedule,
    "pal_integrated_raw.csv": process_pal_integrated,
    "pal_raw.csv": process_pal,
    "par_flows_raw.csv": process_par_flows,
    "reference_bus_lbmp_raw.csv": process_reference_bus_lbmp,
    "rt_events_raw.csv": process_rt_events,
    "rt_imer_raw.csv": process_rt_imer,
    "rt_lbmp_gen_raw.csv": process_rt_lbmp_gen,
    "rt_lbmp_zone_raw.csv": process_rt_lbmp_zone,
    "rtasp_raw.csv": process_rtasp,
    "rtfuelmix_raw.csv": process_rtfuelmix,
    "ttcf_raw.csv": process_ttcf,
    "rt_limiting_constraints_raw.csv": process_rt_limiting_constraints,
    "sc_line_outages_raw.csv": process_sc_line_outages,
    "rt_line_outages_raw.csv": process_rt_line_outages,
}


EXPECTED_RAW_FILES = [
    "active_transmission_nodes_raw.csv",
    "atc_ttc_raw.csv",
    "btm_da_forecast_raw.csv",
    "btm_estimated_actual_raw.csv",
    "da_lbmp_gen_raw.csv",
    "da_lbmp_zone_raw.csv",
    "dam_imer_raw.csv",
    "dam_limiting_constraints_raw.csv",
    "damasp_raw.csv",
    "erie_circulation_da_raw.csv",
    "erie_circulation_rt_raw.csv",
    "ext_rto_cts_price_raw.csv",
    "external_limits_flows_raw.csv",
    "gen_maint_report_raw.csv",
    "generator_names_raw.csv",
    "integrated_rt_lbmp_gen_raw.csv",
    "integrated_rt_lbmp_zone_raw.csv",
    "isolf_raw.csv",
    "lfweather_raw.csv",
    "load_names_raw.csv",
    "op_in_commit_raw.csv",
    "oper_messages_raw.csv",
    "out_sched_raw.csv",
    "outage_schedule_raw.csv",
    "pal_integrated_raw.csv",
    "pal_raw.csv",
    "par_flows_raw.csv",
    "reference_bus_lbmp_raw.csv",
    "rt_events_raw.csv",
    "rt_imer_raw.csv",
    "rt_lbmp_gen_raw.csv",
    "rt_lbmp_zone_raw.csv",
    "rt_limiting_constraints_raw.csv",
    "rt_line_outages_raw.csv",
    "rtasp_raw.csv",
    "rtfuelmix_raw.csv",
    "sc_line_outages_raw.csv",
    "ttcf_raw.csv",
]


def audit_fetch_vs_process(project_root):
    raw_dir = project_root / "data" / "raw"

    missing_processors = sorted(set(EXPECTED_RAW_FILES) - set(PROCESSOR_MAP.keys()))
    extra_processors = sorted(set(PROCESSOR_MAP.keys()) - set(EXPECTED_RAW_FILES))

    existing_raw_files = sorted([p.name for p in raw_dir.glob("*_raw.csv")])
    raw_without_processor = sorted(set(existing_raw_files) - set(PROCESSOR_MAP.keys()))
    processor_without_raw = sorted(set(PROCESSOR_MAP.keys()) - set(existing_raw_files))

    print("\n====================")
    print("AUDIT: FETCH VS PROCESS")
    print("====================")

    print("\nExpected raw files from fetch:")
    print(len(EXPECTED_RAW_FILES))

    print("\nProcessors currently defined:")
    print(len(PROCESSOR_MAP))

    print("\nMissing processors:")
    for f in missing_processors:
        print(f"  - {f}")

    print("\nExtra processors not in expected fetch list:")
    for f in extra_processors:
        print(f"  - {f}")

    print("\nRaw files present with no processor:")
    for f in raw_without_processor:
        print(f"  - {f}")

    print("\nProcessors with no raw file present:")
    for f in processor_without_raw:
        print(f"  - {f}")


def process_file(raw_file_name, project_root):
    raw_path = project_root / "data" / "raw" / raw_file_name
    processed_dir = project_root / "data" / "processed"
    processed_dir.mkdir(parents=True, exist_ok=True)

    if not raw_path.exists():
        print(f"Missing file: {raw_path}")
        return

    processor = PROCESSOR_MAP.get(raw_file_name)
    if processor is None:
        print(f"No processor set up for {raw_file_name}")
        return

    try:
        df = strip_whitespace(raw_path)
        df = processor(df)

        if df.empty:
            print(f"No data after processing {raw_file_name}")
            return

        output_name = raw_file_name.replace("_raw.csv", "_processed.csv")
        output_path = processed_dir / output_name
        df.to_csv(output_path, index=False)

        print(f"Saved: {output_path}")
    except Exception as e:
        print(f"Error processing {raw_file_name}: {e}")


project_root = Path(__file__).resolve().parent.parent

audit_fetch_vs_process(project_root)

files_to_process = [f for f in EXPECTED_RAW_FILES if f in PROCESSOR_MAP]

for raw_file_name in files_to_process:
    process_file(raw_file_name, project_root)