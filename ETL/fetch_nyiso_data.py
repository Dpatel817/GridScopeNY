import requests
import pandas as pd
import io
from datetime import datetime, timedelta
from pathlib import Path


nyiso_url_dict = {
    "general": {
        "rt_events": "https://mis.nyiso.com/public/csv/RealTimeEvents/{date}RealTimeEvents.csv",
        "oper_messages": "https://mis.nyiso.com/public/csv/OperMessages/{date}OperMessages.csv",
        "generator_names": "https://mis.nyiso.com/public/csv/generator/generator.csv",
        "load_names": "https://mis.nyiso.com/public/csv/load/load.csv",
        "active_transmission_nodes": "https://mis.nyiso.com/public/csv/activetransmissionnodes/activetransmissionnodes.csv",
        "interconnection_queue": "https://www.nyiso.com/documents/20142/1407078/NYISO-Interconnection-Queue.xlsx/b91b6960-7a16-17a2-4b21-862991469bc6?t=1676069140232",
    },

    "prices": {
        "da_lbmp_zone": "https://mis.nyiso.com/public/csv/damlbmp/{date}damlbmp_zone.csv",
        "rt_lbmp_zone": "https://mis.nyiso.com/public/csv/realtime/{date}realtime_zone.csv",
        "da_lbmp_gen": "https://mis.nyiso.com/public/csv/damlbmp/{date}damlbmp_gen.csv",
        "rt_lbmp_gen": "https://mis.nyiso.com/public/csv/realtime/{date}realtime_gen.csv",
        "integrated_rt_lbmp_zone": "https://mis.nyiso.com/public/csv/rtlbmp/{date}rtlbmp_zone.csv",
        "integrated_rt_lbmp_gen": "https://mis.nyiso.com/public/csv/rtlbmp/{date}rtlbmp_gen.csv",
        "reference_bus_lbmp": "https://mis.nyiso.com/public/csv/rtlbmp/{date}rtlbmp_gen.csv",
        "ext_rto_cts_price": "https://mis.nyiso.com/public/csv/extrtoctsprice/{date}ext_rto_cts_price.csv",
        "damasp": "https://mis.nyiso.com/public/csv/damasp/{date}damasp.csv",
        "rtasp": "https://mis.nyiso.com/public/csv/rtasp/{date}rtasp.csv",
    },

    "demand": {
        "isolf": "https://mis.nyiso.com/public/csv/isolf/{date}isolf.csv",
        "lfweather": "https://mis.nyiso.com/public/csv/lfweather/{date}lfweather.csv",
        "pal": "https://mis.nyiso.com/public/csv/pal/{date}pal.csv",
        "pal_integrated": "https://mis.nyiso.com/public/csv/palIntegrated/{date}palIntegrated.csv",
    },

    "generation": {
        "rtfuelmix": "https://mis.nyiso.com/public/csv/rtfuelmix/{date}rtfuelmix.csv",
        "gen_maint_report": "https://mis.nyiso.com/public/csv/genmaint/gen_maint_report.csv",
        "op_in_commit": "https://mis.nyiso.com/public/csv/OpInCommit/{date}OpInCommit.csv",
        "dam_imer": "https://mis.nyiso.com/public/csv/damimer/{date}dam_imer.csv",
        "rt_imer": "https://mis.nyiso.com/public/csv/rtimer/{date}rt_imer.csv",
        "btm_da_forecast": "https://mis.nyiso.com/public/csv/btmdaforecast/{date}btmdaforecast.csv",
        "btm_estimated_actual": "https://mis.nyiso.com/public/csv/btmactualforecast/{date}BTMEstimatedActual.csv",
    },

    "interface_flows": {
        "external_limits_flows": "https://mis.nyiso.com/public/csv/ExternalLimitsFlows/{date}ExternalLimitsFlows.csv",
        "atc_ttc": "https://mis.nyiso.com/public/csv/atc_ttc/{date}atc_ttc.csv",
        "ttcf": "https://mis.nyiso.com/public/csv/ttcf/{date}ttcf.csv",
        "par_schedule": "https://mis.nyiso.com/public/txt/parSchedule/{date}parSchedule.txt",
        "par_flows": "https://mis.nyiso.com/public/csv/ParFlows/{date}ParFlows.csv",
        "erie_circulation_da": "https://mis.nyiso.com/public/csv/eriecirculationda/{date}ErieCirculationDA.csv",
        "erie_circulation_rt": "https://mis.nyiso.com/public/csv/eriecirculationrt/{date}ErieCirculationRT.csv",
    },

    "congestion": {
        "dam_limiting_constraints": "https://mis.nyiso.com/public/csv/DAMLimitingConstraints/{date}DAMLimitingConstraints.csv",
        "rt_limiting_constraints": "https://mis.nyiso.com/public/csv/LimitingConstraints/{date}LimitingConstraints.csv",
        "sc_line_outages": "https://mis.nyiso.com/public/csv/schedlineoutages/{date}SCLineOutages.csv",
        "rt_line_outages": "https://mis.nyiso.com/public/csv/realtimelineoutages/{date}RTLineOutages.csv",
        "out_sched": "https://mis.nyiso.com/public/csv/outSched/{date}outSched.csv",
        "outage_schedule": "https://mis.nyiso.com/public/csv/os/outage-schedule.csv",
    },

    "useful_links": {
        "modo_main": "https://modoenergy.com/",
        "modo_nyiso_research": "https://modoenergy.com/research?regions=nyiso",
        "nyiso_dashboard": "https://www.nyiso.com/real-time-dashboard",
        "isone_dashboard": "https://www.iso-ne.com/isoexpress/",
        "pjm_dataviewer": "https://dataviewer.pjm.com/dataviewer/pages/public/load.jsf",
        "iroquois_critical": "https://ioly.iroquois.com/infopost/#critical",
        "tetco_critical": "https://infopost.enbridge.com/infopost/TEHome.asp?Pipe=TE",
        "transco_critical": "https://www.1line.williams.com/Transco/info-postings/notices/critical-notices.html",
        "tgp_critical": "https://pipeline2.kindermorgan.com/Notices/Notices.aspx?type=C&code=TGP",
        "potomac_reports": "https://www.potomaceconomics.com/markets-monitored/new-york-iso/",
    }
}


def get_project_root():
    try:
        return Path(__file__).resolve().parent.parent
    except NameError:
        return Path.cwd()


def get_raw_dir():
    raw_dir = get_project_root() / "data" / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    return raw_dir


def get_date_list():
    today = datetime.now().date()
    start_date = today - timedelta(days=7)
    end_date = today + timedelta(days=1)

    dates = []
    current_date = start_date

    while current_date <= end_date:
        dates.append(current_date.strftime("%Y%m%d"))
        current_date += timedelta(days=1)

    return dates


def is_dated_url(url):
    return "{date}" in url


def is_csv_url(url):
    test_url = url.replace("{date}", "")
    return test_url.lower().endswith(".csv")


def read_csv_from_url(session, url):
    try:
        response = session.get(url, timeout=20)
        response.raise_for_status()
        return pd.read_csv(io.BytesIO(response.content))
    except requests.exceptions.HTTPError:
        print(f"Missing: {url}")
        return pd.DataFrame()
    except Exception as e:
        print(f"Error reading {url}: {e}")
        return pd.DataFrame()


def scrape_dated_endpoint(session, data_name, url_template, raw_dir, date_list):
    all_dfs = []

    for date_str in date_list:
        url = url_template.replace("{date}", date_str)
        print(f"Reading {data_name} | {date_str}")

        df = read_csv_from_url(session, url)

        if df.empty:
            continue

        df["source_date"] = date_str
        df["source_file"] = url.split("/")[-1]
        all_dfs.append(df)

    if not all_dfs:
        print(f"No data found for {data_name}")
        return

    final_df = pd.concat(all_dfs, ignore_index=True)
    output_path = raw_dir / f"{data_name}_raw.csv"
    final_df.to_csv(output_path, index=False)
    print(f"Saved: {output_path}")


def scrape_static_endpoint(session, data_name, url, raw_dir):
    print(f"Reading {data_name}")

    df = read_csv_from_url(session, url)

    if df.empty:
        print(f"No data found for {data_name}")
        return

    output_path = raw_dir / f"{data_name}_raw.csv"
    df.to_csv(output_path, index=False)
    print(f"Saved: {output_path}")


def scrape_all_nyiso():
    raw_dir = get_raw_dir()
    date_list = get_date_list()

    with requests.Session() as session:
        for category, endpoints in nyiso_url_dict.items():
            if category == "useful_links":
                continue

            print(f"\n====================")
            print(category.upper())
            print("====================")

            for data_name, url in endpoints.items():
                if not is_csv_url(url):
                    print(f"Skipping non-csv: {data_name}")
                    continue

                if "xlsx" in url.lower():
                    print(f"Skipping xlsx: {data_name}")
                    continue

                if is_dated_url(url):
                    scrape_dated_endpoint(
                        session=session,
                        data_name=data_name,
                        url_template=url,
                        raw_dir=raw_dir,
                        date_list=date_list
                    )
                else:
                    scrape_static_endpoint(
                        session=session,
                        data_name=data_name,
                        url=url,
                        raw_dir=raw_dir
                    )


scrape_all_nyiso()

print("\nDone")