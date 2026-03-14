import pandas as pd
from src.config import PROCESSED_DIR

def load_processed_data(filename: str) -> pd.DataFrame:
    path = PROCESSED_DIR / filename
    if not path.exists():
        return pd.DataFrame()
    return pd.read_csv(path)
