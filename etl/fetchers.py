import io
import time
import zipfile
import logging
from pathlib import Path
from datetime import date, timedelta

import pandas as pd
import requests

from etl.config import (
    RAW_DATA_DIR, REQUEST_TIMEOUT, MAX_RETRIES, RETRY_DELAY
)

logger = logging.getLogger("etl.fetchers")


def create_session():
    session = requests.Session()
    session.headers.update({"User-Agent": "GridScopeNY-ETL/1.0"})
    session.verify = False
    return session


def fetch_url(session, url, timeout=REQUEST_TIMEOUT):
    for attempt in range(MAX_RETRIES):
        try:
            resp = session.get(url, timeout=timeout)
            resp.raise_for_status()
            return resp
        except requests.exceptions.HTTPError as e:
            if resp.status_code == 404:
                return None
            logger.warning(f"HTTP {resp.status_code} for {url} (attempt {attempt+1})")
        except requests.exceptions.RequestException as e:
            logger.warning(f"Request error for {url}: {e} (attempt {attempt+1})")
        if attempt < MAX_RETRIES - 1:
            time.sleep(RETRY_DELAY * (attempt + 1))
    return None


def get_archive_url(meta, year_month_str):
    archive_dir = meta.get("archive_dir")
    archive_suffix = meta.get("archive_suffix")
    if not archive_dir or not archive_suffix:
        return None
    date_prefix = year_month_str.replace("-", "") + "01"
    base = meta["daily_url"].split("/public/")[0] + "/public/"
    ext_type = "txt" if meta["dataset_type"] == "dated_txt" else "csv"
    return f"{base}{ext_type}/{archive_dir}/{date_prefix}{archive_suffix}"


def fetch_monthly_archive(session, meta, year_month_str, dataset_name):
    url = get_archive_url(meta, year_month_str)
    if not url:
        return None, None

    resp = fetch_url(session, url)
    if resp is None:
        logger.info(f"No archive at {url}")
        return None, None

    zip_dir = RAW_DATA_DIR / dataset_name / "zip"
    zip_dir.mkdir(parents=True, exist_ok=True)
    zip_path = zip_dir / f"{year_month_str}.zip"
    zip_path.write_bytes(resp.content)
    logger.info(f"Downloaded archive: {zip_path.name}")

    extracted_files = []
    raw_subdir = RAW_DATA_DIR / dataset_name / ("txt" if meta["dataset_type"] == "dated_txt" else "csv")
    raw_subdir.mkdir(parents=True, exist_ok=True)

    try:
        with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
            for name in zf.namelist():
                if name.endswith("/"):
                    continue
                data = zf.read(name)
                out_path = raw_subdir / Path(name).name
                out_path.write_bytes(data)
                extracted_files.append(out_path)
    except zipfile.BadZipFile:
        logger.error(f"Bad zip file: {url}")
        return zip_path, []

    return zip_path, extracted_files


def fetch_daily_file(session, meta, date_str, dataset_name):
    url = meta["daily_url"].replace("{date}", date_str)
    resp = fetch_url(session, url)
    if resp is None:
        return None

    ext = "txt" if meta["dataset_type"] == "dated_txt" else "csv"
    raw_subdir = RAW_DATA_DIR / dataset_name / ext
    raw_subdir.mkdir(parents=True, exist_ok=True)

    filename = url.split("/")[-1]
    out_path = raw_subdir / filename
    out_path.write_bytes(resp.content)
    return out_path


def fetch_snapshot(session, meta, dataset_name):
    url = meta.get("snapshot_url", "")
    resp = fetch_url(session, url)
    if resp is None:
        return None

    if meta["dataset_type"] == "snapshot_xlsx":
        subdir = RAW_DATA_DIR / dataset_name / "xlsx"
        subdir.mkdir(parents=True, exist_ok=True)
        out_path = subdir / f"{dataset_name}.xlsx"
        out_path.write_bytes(resp.content)
    else:
        subdir = RAW_DATA_DIR / dataset_name / "csv"
        subdir.mkdir(parents=True, exist_ok=True)
        out_path = subdir / f"{dataset_name}.csv"
        out_path.write_bytes(resp.content)

    return out_path


def read_raw_file(path):
    suffix = path.suffix.lower()
    try:
        if suffix == ".csv":
            return pd.read_csv(path, encoding="utf-8-sig")
        elif suffix == ".txt":
            return pd.read_csv(path, sep="|", encoding="utf-8-sig")
        elif suffix == ".xlsx":
            return pd.read_excel(path, engine="openpyxl")
        else:
            return pd.read_csv(path, encoding="utf-8-sig")
    except Exception as e:
        logger.error(f"Failed to read {path}: {e}")
        return pd.DataFrame()


def get_date_range(start_date, end_date):
    dates = []
    current = start_date
    while current <= end_date:
        dates.append(current.strftime("%Y%m%d"))
        current += timedelta(days=1)
    return dates


def get_month_range(start_date, end_date):
    months = []
    current = start_date.replace(day=1)
    end_month = end_date.replace(day=1)
    while current <= end_month:
        months.append(current.strftime("%Y-%m"))
        if current.month == 12:
            current = current.replace(year=current.year + 1, month=1)
        else:
            current = current.replace(month=current.month + 1)
    return months
