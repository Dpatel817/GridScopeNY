"""Clear processed data caches and reprocess all raw data with current ETL logic.

Usage: python ETL/clear_cache_and_reprocess.py
"""
import shutil
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent
processed_dir = project_root / "data" / "processed"
daily_cache_dir = processed_dir / "_daily_cache"

print("Clearing daily cache...")
if daily_cache_dir.exists():
    shutil.rmtree(daily_cache_dir)
    daily_cache_dir.mkdir(parents=True, exist_ok=True)
    print(f"  Cleared {daily_cache_dir}")
else:
    print("  No daily cache directory found")

print("Removing processed CSV and Parquet files...")
removed = 0
for ext in ("*.csv", "*.parquet"):
    for f in processed_dir.glob(ext):
        f.unlink()
        removed += 1
print(f"  Removed {removed} files")

print("\nReprocessing all raw data...")
from process_nyiso_data import EXPECTED_RAW_FILES, PROCESSOR_MAP, process_file

files_to_process = [f for f in EXPECTED_RAW_FILES if f in PROCESSOR_MAP]
for raw_file_name in files_to_process:
    process_file(raw_file_name, project_root)

print("\nDone. All data reprocessed with HE 1-24 convention.")
