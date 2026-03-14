from pathlib import Path
from dotenv import load_dotenv
import os

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"

APP_TITLE = "GridScope NY"
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
NYISO_API_KEY = os.getenv("NYISO_API_KEY", "")
