from pathlib import Path
import pandas as pd


COMMON_TIME_COLS = [
    "Time Stamp",
    "Timestamp",
    "RTC Execution Time",
    "RTC End Time Stamp",
    "Event Start Time",
    "Event End Time",
    "Forecast Date",
    "Vintage Date",
    "Date",
    "Out Start",
    "Out End",
]

COMMON_ENTITY_COLS = [
    "Zone",
    "Generator",
    "Resource",
    "Interface",
    "Interface Name",
    "Fuel Type",
    "Equipment",
    "Node",
    "Load",
    "Station",
]


def ensure_directory(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def first_existing_column(df: pd.DataFrame, candidates: list[str]):
    for col in candidates:
        if col in df.columns:
            return col
    return None


def get_time_col(df: pd.DataFrame):
    return first_existing_column(df, COMMON_TIME_COLS)


def get_entity_col(df: pd.DataFrame, preferred: str | None = None):
    if preferred and preferred in df.columns:
        return preferred
    return first_existing_column(df, COMMON_ENTITY_COLS)


def prepare_datetime_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    for col in COMMON_TIME_COLS:
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors="coerce")

    if "source_date" in df.columns:
        if not pd.api.types.is_datetime64_any_dtype(df["source_date"]):
            df["source_date"] = pd.to_datetime(df["source_date"], errors="coerce")

    return df


def get_numeric_columns(df: pd.DataFrame) -> list[str]:
    return df.select_dtypes(include="number").columns.tolist()


def format_number(value, decimals: int = 1):
    if pd.isna(value):
        return "-"
    return f"{value:,.{decimals}f}"


def safe_date_range(df: pd.DataFrame, time_col: str):
    if df.empty or time_col not in df.columns:
        return None, None

    series = pd.to_datetime(df[time_col], errors="coerce").dropna()
    if series.empty:
        return None, None

    return series.dt.date.min(), series.dt.date.max()


def apply_date_filter(df: pd.DataFrame, time_col: str, start_date, end_date) -> pd.DataFrame:
    if df.empty or time_col not in df.columns:
        return df

    ts = pd.to_datetime(df[time_col], errors="coerce")
    mask = (ts.dt.date >= start_date) & (ts.dt.date <= end_date)
    return df.loc[mask].copy()