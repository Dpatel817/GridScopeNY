from pathlib import Path
from dotenv import load_dotenv
import os

load_dotenv()

BACKEND_DIR = Path(__file__).resolve().parent.parent  # backend/
BASE_DIR = BACKEND_DIR.parent  # repo root
DATA_DIR = BASE_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"

APP_TITLE = "GridScope NY"
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")