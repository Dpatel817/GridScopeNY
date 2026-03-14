import pandas as pd

def standardize_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.columns = [str(c).strip().lower().replace(" ", "_") for c in df.columns]
    return df

def parse_datetime_column(df: pd.DataFrame, column: str) -> pd.DataFrame:
    df = df.copy()
    if column in df.columns:
        df[column] = pd.to_datetime(df[column], errors="coerce")
    return df
