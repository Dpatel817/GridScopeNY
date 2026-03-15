"""
Fetch and process the NYISO Interconnection Queue Excel workbook.
Downloads from NYISO, parses all sheets, normalizes columns,
performs snapshot comparison, and outputs processed CSVs.
"""
import json
import hashlib
import traceback
from datetime import datetime
from pathlib import Path

import pandas as pd
import requests


QUEUE_URL = "https://www.nyiso.com/documents/20142/1407078/NYISO-Interconnection-Queue.xlsx"

SHEET_MAP = {
    "interconnection queue": "active",
    "cluster projects": "cluster",
    "affected system studies": "affected_system",
    "affected system": "affected_system",
    "withdrawn": "withdrawn",
    "cluster projects-withdrawn": "cluster_withdrawn",
    "cluster projects - withdrawn": "cluster_withdrawn",
    "affected system- withdrawn": "affected_system_withdrawn",
    "affected system - withdrawn": "affected_system_withdrawn",
    "affected system-withdrawn": "affected_system_withdrawn",
    "in service": "in_service",
    "in-service": "in_service",
}

IN_SERVICE_COLUMNS = [
    "queue_pos", "developer", "project_name", "date_of_ir",
    "sp_mw", "wp_mw", "fuel_type", "county", "state", "zone",
    "point_of_interconnection", "utility", "status",
    "last_updated_date", "availability", "proposed_in_service_date", "proposed_cod",
]

COLUMN_MAP = {
    "queue pos.": "queue_pos",
    "queue pos": "queue_pos",
    "queue position": "queue_pos",
    "position": "queue_pos",
    "pos": "queue_pos",
    "queue #": "queue_pos",
    "queue id": "queue_id",
    "project name": "project_name",
    "name": "project_name",
    "developer/interconnection customer": "developer",
    "interconnection customer name": "developer",
    "interconnecting entity / developer": "developer",
    "owner/developer": "developer",
    "developer": "developer",
    "interconnecting entity": "developer",
    "type/ fuel": "fuel_type",
    "fuel / technology type": "fuel_type",
    "fuel type": "fuel_type",
    "technology": "fuel_type",
    "fuel/technology type": "fuel_type",
    "type/fuel": "fuel_type",
    "energy storage capability": "storage_capability",
    "storage capability": "storage_capability",
    "storage": "storage_capability",
    "minimum_duration full discharge": "discharge_duration",
    "discharge duration": "discharge_duration",
    "county": "county",
    "location": "county",
    "state": "state",
    "z": "zone",
    "zone": "zone",
    "nyiso zone": "zone",
    "utility": "utility",
    "availability of interconnection service": "availability",
    "availability": "availability",
    "availability of studies": "availability",
    "interconnection point": "point_of_interconnection",
    "point of interconnection": "point_of_interconnection",
    "interconnection": "point_of_interconnection",
    "poi": "point_of_interconnection",
    "s": "status",
    "status": "status",
    "type / status of interconnection service": "interconnection_type",
    "type/ status of ia": "interconnection_type",
    "sp (mw)": "sp_mw",
    "sp mw": "sp_mw",
    "sp": "sp_mw",
    "wp (mw)": "wp_mw",
    "wp mw": "wp_mw",
    "wp": "wp_mw",
    "date of ir": "date_of_ir",
    "ir date": "date_of_ir",
    "proposed cod": "proposed_cod",
    "cod": "proposed_cod",
    "proposed initial synchronization date": "proposed_sync_date",
    "proposed in-service date": "proposed_in_service_date",
    "proposed in service date": "proposed_in_service_date",
    "in-service date": "proposed_in_service_date",
    "proposed is date": "proposed_in_service_date",
    "ia tender date": "ia_tender_date",
    "tender date": "ia_tender_date",
    "ia effective date": "ia_effective_date",
    "fs complete date": "fs_complete_date",
    "fs date": "fs_complete_date",
    "sis complete date": "sis_complete_date",
    "last updated date": "last_updated_date",
    "last update": "last_updated_date",
    "date withdrawn": "date_withdrawn",
    "withdrawn date": "date_withdrawn",
    "optional interconnection study": "optional_study",
    "cluster study": "cluster_study",
}

STANDARD_COLS = [
    "queue_id", "queue_pos", "project_name", "developer", "fuel_type",
    "county", "state", "zone", "utility", "point_of_interconnection",
    "status", "interconnection_type", "availability",
    "sp_mw", "wp_mw", "storage_capability", "discharge_duration",
    "proposed_cod", "proposed_sync_date", "proposed_in_service_date",
    "date_of_ir", "ia_tender_date", "ia_effective_date",
    "fs_complete_date", "sis_complete_date", "last_updated_date",
    "date_withdrawn", "optional_study", "cluster_study",
    "source_sheet", "scrape_timestamp",
]

DATE_COLS = [
    "proposed_cod", "proposed_sync_date", "proposed_in_service_date",
    "date_of_ir", "ia_tender_date", "ia_effective_date",
    "fs_complete_date", "sis_complete_date", "last_updated_date",
    "date_withdrawn",
]


def get_project_root():
    try:
        return Path(__file__).resolve().parent.parent
    except NameError:
        return Path.cwd()


def download_workbook(url: str, timeout: int = 60) -> bytes | None:
    try:
        resp = requests.get(url, timeout=timeout, verify=False)
        resp.raise_for_status()
        return resp.content
    except Exception as e:
        print(f"[IQ] Download failed: {e}")
        return None


def identify_sheet(name: str) -> str | None:
    normalized = name.strip().lower()
    for pattern, label in SHEET_MAP.items():
        if normalized == pattern:
            return label
    for pattern, label in SHEET_MAP.items():
        if pattern in normalized:
            return label
    return None


def normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    rename = {}
    for col in df.columns:
        key = str(col).strip().lower()
        if key in COLUMN_MAP:
            rename[col] = COLUMN_MAP[key]
    df = df.rename(columns=rename)
    return df


def parse_standard_sheet(xls, sheet_name: str, sheet_label: str, timestamp: str) -> pd.DataFrame:
    df = pd.read_excel(xls, sheet_name=sheet_name)
    if df.empty:
        return pd.DataFrame()

    df.columns = [str(c).strip() for c in df.columns]
    df = normalize_columns(df)
    df = df.dropna(how="all")

    df["source_sheet"] = sheet_label
    df["scrape_timestamp"] = timestamp

    if "queue_id" not in df.columns and "queue_pos" in df.columns:
        df["queue_id"] = df["queue_pos"].astype(str)

    for col in DATE_COLS:
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors="coerce")
            df[col] = df[col].dt.strftime("%Y-%m-%d")

    for col in ["sp_mw", "wp_mw"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    for col in STANDARD_COLS:
        if col not in df.columns:
            df[col] = None

    keep = [c for c in STANDARD_COLS if c in df.columns]
    extra = [c for c in df.columns if c not in STANDARD_COLS]
    final = df[keep + extra].copy()
    final = final.dropna(subset=["queue_pos"], how="all")

    return final


def parse_in_service_sheet(xls, sheet_name: str, timestamp: str) -> pd.DataFrame:
    df = pd.read_excel(xls, sheet_name=sheet_name, header=None)
    if df.empty or len(df) < 3:
        return pd.DataFrame()

    data = df.iloc[2:].reset_index(drop=True)

    actual_cols = min(len(IN_SERVICE_COLUMNS), data.shape[1])
    col_names = IN_SERVICE_COLUMNS[:actual_cols]
    if data.shape[1] > actual_cols:
        col_names += [f"extra_{i}" for i in range(data.shape[1] - actual_cols)]
    data.columns = col_names

    data = data.dropna(how="all")
    data["source_sheet"] = "in_service"
    data["scrape_timestamp"] = timestamp

    if "queue_id" not in data.columns and "queue_pos" in data.columns:
        data["queue_id"] = data["queue_pos"].astype(str)

    for col in DATE_COLS:
        if col in data.columns:
            data[col] = pd.to_datetime(data[col], errors="coerce")
            data[col] = data[col].dt.strftime("%Y-%m-%d")

    for col in ["sp_mw", "wp_mw"]:
        if col in data.columns:
            data[col] = pd.to_numeric(data[col], errors="coerce")

    for col in STANDARD_COLS:
        if col not in data.columns:
            data[col] = None

    keep = [c for c in STANDARD_COLS if c in data.columns]
    final = data[keep].copy()
    final = final.dropna(subset=["queue_pos"], how="all")

    return final


def make_project_key(row: pd.Series) -> str:
    qid = str(row.get("queue_id", "") or "").strip()
    qpos = str(row.get("queue_pos", "") or "").strip()
    if qpos and qpos.lower() not in ("nan", "none", ""):
        return f"{qpos}|{row.get('source_sheet', '')}"
    if qid and qid.lower() not in ("nan", "none", ""):
        return f"{qid}|{row.get('source_sheet', '')}"
    name = str(row.get("project_name", "") or "").strip()
    dev = str(row.get("developer", "") or "").strip()
    sheet = str(row.get("source_sheet", "") or "").strip()
    return f"{name}|{dev}|{sheet}"


def compute_snapshot_hash(row: pd.Series) -> str:
    exclude = {"scrape_timestamp"}
    vals = []
    for k, v in sorted(row.items()):
        if k in exclude:
            continue
        vals.append(f"{k}={v}")
    return hashlib.md5("|".join(vals).encode()).hexdigest()


def detect_changes(current_df: pd.DataFrame, previous_df: pd.DataFrame, timestamp: str) -> pd.DataFrame:
    changes = []

    curr_keys = {}
    for _, row in current_df.iterrows():
        key = make_project_key(row)
        curr_keys[key] = row

    prev_keys = {}
    for _, row in previous_df.iterrows():
        key = make_project_key(row)
        prev_keys[key] = row

    for key, row in curr_keys.items():
        if key not in prev_keys:
            changes.append({
                "change_type": "new",
                "queue_id": row.get("queue_id"),
                "queue_pos": row.get("queue_pos"),
                "project_name": row.get("project_name"),
                "developer": row.get("developer"),
                "fuel_type": row.get("fuel_type"),
                "sp_mw": row.get("sp_mw"),
                "zone": row.get("zone"),
                "source_sheet": row.get("source_sheet"),
                "changed_fields": None,
                "previous_values": None,
                "current_values": None,
                "detected_at": timestamp,
            })
        else:
            prev_row = prev_keys[key]
            curr_hash = compute_snapshot_hash(row)
            prev_hash = compute_snapshot_hash(prev_row)
            if curr_hash != prev_hash:
                changed_fields = []
                prev_vals = {}
                curr_vals = {}
                compare_cols = [c for c in STANDARD_COLS if c not in ("scrape_timestamp",)]
                for col in compare_cols:
                    cv = str(row.get(col, ""))
                    pv = str(prev_row.get(col, ""))
                    if cv != pv:
                        changed_fields.append(col)
                        prev_vals[col] = pv
                        curr_vals[col] = cv
                if changed_fields:
                    changes.append({
                        "change_type": "updated",
                        "queue_id": row.get("queue_id"),
                        "queue_pos": row.get("queue_pos"),
                        "project_name": row.get("project_name"),
                        "developer": row.get("developer"),
                        "fuel_type": row.get("fuel_type"),
                        "sp_mw": row.get("sp_mw"),
                        "zone": row.get("zone"),
                        "source_sheet": row.get("source_sheet"),
                        "changed_fields": json.dumps(changed_fields),
                        "previous_values": json.dumps(prev_vals),
                        "current_values": json.dumps(curr_vals),
                        "detected_at": timestamp,
                    })

    for key, row in prev_keys.items():
        if key not in curr_keys:
            changes.append({
                "change_type": "removed",
                "queue_id": row.get("queue_id"),
                "queue_pos": row.get("queue_pos"),
                "project_name": row.get("project_name"),
                "developer": row.get("developer"),
                "fuel_type": row.get("fuel_type"),
                "sp_mw": row.get("sp_mw"),
                "zone": row.get("zone"),
                "source_sheet": row.get("source_sheet"),
                "changed_fields": None,
                "previous_values": None,
                "current_values": None,
                "detected_at": timestamp,
            })

    return pd.DataFrame(changes) if changes else pd.DataFrame(columns=[
        "change_type", "queue_id", "queue_pos", "project_name", "developer",
        "fuel_type", "sp_mw", "zone", "source_sheet",
        "changed_fields", "previous_values", "current_values", "detected_at",
    ])


def create_summary(all_data: pd.DataFrame, changes_df: pd.DataFrame, timestamp: str) -> pd.DataFrame:
    sheets = all_data["source_sheet"].value_counts().to_dict() if not all_data.empty else {}
    active_count = sheets.get("active", 0)
    cluster_count = sheets.get("cluster", 0)
    affected_count = sheets.get("affected_system", 0)
    in_service_count = sheets.get("in_service", 0)
    withdrawn_count = sum(v for k, v in sheets.items() if "withdrawn" in k)

    new_count = len(changes_df[changes_df["change_type"] == "new"]) if not changes_df.empty else 0
    removed_count = len(changes_df[changes_df["change_type"] == "removed"]) if not changes_df.empty else 0
    updated_count = len(changes_df[changes_df["change_type"] == "updated"]) if not changes_df.empty else 0

    total_sp = all_data["sp_mw"].sum() if "sp_mw" in all_data.columns else 0
    total_wp = all_data["wp_mw"].sum() if "wp_mw" in all_data.columns else 0

    fuel_breakdown = {}
    zone_breakdown = {}
    active_data = all_data[all_data["source_sheet"].isin(["active", "cluster"])]
    if not active_data.empty:
        if "fuel_type" in active_data.columns:
            for ft, grp in active_data.groupby("fuel_type"):
                if pd.notna(ft) and str(ft).strip():
                    fuel_breakdown[str(ft).strip()] = int(len(grp))
        if "zone" in active_data.columns:
            for z, grp in active_data.groupby("zone"):
                if pd.notna(z) and str(z).strip():
                    zone_breakdown[str(z).strip()] = int(len(grp))

    summary = {
        "metric": [
            "total_active", "total_cluster", "total_affected_system",
            "total_withdrawn", "total_in_service", "total_projects",
            "total_sp_mw", "total_wp_mw",
            "new_since_last", "removed_since_last", "updated_since_last",
            "fuel_breakdown", "zone_breakdown", "scrape_timestamp",
        ],
        "value": [
            active_count, cluster_count, affected_count,
            withdrawn_count, in_service_count, len(all_data),
            round(float(total_sp), 1) if pd.notna(total_sp) else 0,
            round(float(total_wp), 1) if pd.notna(total_wp) else 0,
            new_count, removed_count, updated_count,
            json.dumps(fuel_breakdown), json.dumps(zone_breakdown), timestamp,
        ],
    }
    return pd.DataFrame(summary)


def run():
    root = get_project_root()
    processed_dir = root / "data" / "processed"
    snapshot_dir = root / "data" / "snapshots"
    processed_dir.mkdir(parents=True, exist_ok=True)
    snapshot_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    print(f"[IQ] Starting scrape at {timestamp}")

    content = download_workbook(QUEUE_URL)
    if content is None:
        print("[IQ] Download failed. Preserving existing data.")
        return False

    try:
        import io
        xls = pd.ExcelFile(io.BytesIO(content), engine="openpyxl")
    except Exception as e:
        print(f"[IQ] Failed to parse Excel: {e}")
        return False

    print(f"[IQ] Found sheets: {xls.sheet_names}")

    all_frames = []

    for sheet_name in xls.sheet_names:
        label = identify_sheet(sheet_name)
        if label is None:
            print(f"[IQ] Skipping unknown sheet: {sheet_name}")
            continue

        try:
            if label == "in_service":
                parsed = parse_in_service_sheet(xls, sheet_name, timestamp)
            else:
                parsed = parse_standard_sheet(xls, sheet_name, label, timestamp)

            if not parsed.empty:
                all_frames.append(parsed)
                print(f"[IQ] Sheet '{sheet_name}' -> {label}: {len(parsed)} rows")
            else:
                print(f"[IQ] Sheet '{sheet_name}' -> {label}: empty")
        except Exception as e:
            print(f"[IQ] Error parsing sheet '{sheet_name}': {e}")
            traceback.print_exc()

    if not all_frames:
        print("[IQ] No data parsed from any sheet.")
        return False

    all_data = pd.concat(all_frames, ignore_index=True)
    print(f"[IQ] Total rows: {len(all_data)}")

    prev_snapshot_path = snapshot_dir / "interconnection_queue_latest.csv"
    previous_df = pd.DataFrame()
    if prev_snapshot_path.exists():
        try:
            previous_df = pd.read_csv(prev_snapshot_path, low_memory=False)
            print(f"[IQ] Loaded previous snapshot: {len(previous_df)} rows")
        except Exception:
            print("[IQ] Could not load previous snapshot")

    changes_df = detect_changes(all_data, previous_df, timestamp)
    summary_df = create_summary(all_data, changes_df, timestamp)

    all_data.to_csv(processed_dir / "interconnection_queue_processed.csv", index=False)
    all_data.to_csv(prev_snapshot_path, index=False)

    for label in ["active", "cluster", "affected_system", "in_service"]:
        subset = all_data[all_data["source_sheet"] == label]
        if not subset.empty:
            subset.to_csv(processed_dir / f"iq_{label}_processed.csv", index=False)

    withdrawn_all = all_data[all_data["source_sheet"].str.contains("withdrawn", case=False, na=False)]
    if not withdrawn_all.empty:
        withdrawn_all.to_csv(processed_dir / "iq_withdrawn_processed.csv", index=False)

    changes_df.to_csv(processed_dir / "iq_changes_processed.csv", index=False)
    summary_df.to_csv(processed_dir / "iq_summary_processed.csv", index=False)

    new_count = len(changes_df[changes_df["change_type"] == "new"]) if not changes_df.empty else 0
    removed_count = len(changes_df[changes_df["change_type"] == "removed"]) if not changes_df.empty else 0
    updated_count = len(changes_df[changes_df["change_type"] == "updated"]) if not changes_df.empty else 0
    print(f"[IQ] Changes: {new_count} new, {removed_count} removed, {updated_count} updated")
    print(f"[IQ] Scrape complete.")
    return True


if __name__ == "__main__":
    import sys
    success = run()
    sys.exit(0 if success else 1)
