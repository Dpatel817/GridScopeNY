"""
GridScope NY — FastAPI backend
Serves processed NYISO data as JSON REST endpoints on port 8000.
"""
from __future__ import annotations

import logging
import subprocess
import sys
from typing import Optional, Any

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from src.api_data_loader import (
    DATASET_META,
    PAGE_DATASETS,
    get_data_inventory,
    get_dataset_json,
    get_filter_options,
    get_page_config,
    _load_csv_safe,
)
from src.config import OPENAI_API_KEY

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(
    title="GridScope NY API",
    description="NYISO market intelligence data API",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "GridScope NY API"}


@app.get("/api/inventory")
def inventory():
    return get_data_inventory()


@app.get("/api/page/{page}")
def page_config(page: str):
    if page not in PAGE_DATASETS:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown page '{page}'. Valid: {list(PAGE_DATASETS.keys())}",
        )
    return get_page_config(page)


@app.get("/api/dataset/{dataset_key}")
def get_data(
    dataset_key: str,
    resolution: str = Query(default="raw", pattern="^(raw|hourly|on_peak|off_peak|daily)$"),
    limit: int = Query(default=10000, ge=1, le=100000),
    filter_col: Optional[str] = Query(default=None),
    filter_val: Optional[str] = Query(default=None),
):
    if dataset_key not in DATASET_META:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown dataset '{dataset_key}'.",
        )
    return get_dataset_json(
        dataset_key,
        resolution=resolution,
        limit=limit,
        filter_col=filter_col,
        filter_val=filter_val,
    )


@app.get("/api/filters/{dataset_key}/{column}")
def filters(dataset_key: str, column: str):
    if dataset_key not in DATASET_META:
        raise HTTPException(status_code=404, detail=f"Unknown dataset '{dataset_key}'.")
    options = get_filter_options(dataset_key, column)
    return {"dataset": dataset_key, "column": column, "options": options}


# ---------------------------------------------------------------------------
# Generator Map endpoint
# ---------------------------------------------------------------------------
@app.get("/api/generator-map")
def generator_map(
    market: str = Query(default="DA", pattern="^(DA|RT)$"),
    date: Optional[str] = Query(default=None),
    he: Optional[int] = Query(default=None, ge=0, le=23),
):
    gen_meta = DATASET_META.get("generator_names")
    da_meta = DATASET_META.get("da_lbmp_gen")
    rt_meta = DATASET_META.get("rt_lbmp_gen")

    if not gen_meta or not da_meta or not rt_meta:
        raise HTTPException(status_code=404, detail="Generator datasets not configured")

    gn = _load_csv_safe(gen_meta["file"])
    lmp_file = da_meta["file"] if market == "DA" else rt_meta["file"]
    lmp = _load_csv_safe(lmp_file)

    if gn.empty or lmp.empty:
        raise HTTPException(status_code=404, detail="Generator data files not found or empty")

    if "Date" in lmp.columns and hasattr(lmp["Date"].iloc[0], "strftime"):
        lmp["Date"] = lmp["Date"].dt.strftime("%Y-%m-%d")

    available_dates = sorted(lmp["Date"].dropna().unique().tolist()) if "Date" in lmp.columns else []
    available_hes = sorted(lmp["HE"].dropna().unique().astype(int).tolist()) if "HE" in lmp.columns else []

    if date:
        lmp = lmp[lmp["Date"] == date]
    else:
        if available_dates:
            lmp = lmp[lmp["Date"] == available_dates[-1]]

    if he is not None and "HE" in lmp.columns:
        lmp = lmp[lmp["HE"] == he]

    agg_cols = [c for c in ["LMP", "MLC", "MCC"] if c in lmp.columns]
    if agg_cols:
        gen_lookup = None
        if "Generator" in lmp.columns:
            gen_lookup = lmp.drop_duplicates("PTID")[["PTID", "Generator"]]
        lmp = lmp.groupby("PTID")[agg_cols].mean().reset_index()
        if gen_lookup is not None:
            lmp = lmp.merge(gen_lookup, on="PTID", how="left")

    gn_coords = gn[gn["Latitude"].notna() & gn["Longitude"].notna()].copy()
    gn_coords = gn_coords[["PTID", "Generator", "Zone", "Subzone", "Latitude", "Longitude"]].copy()
    gn_coords = gn_coords.rename(columns={"Generator": "GenName"})

    if "Generator" in lmp.columns:
        lmp = lmp.rename(columns={"Generator": "GenName_lmp"})

    merged = lmp.merge(gn_coords, on="PTID", how="inner")

    total_lmp_ptids = int(lmp["PTID"].nunique())
    total_gen_ptids = int(gn["PTID"].nunique())
    mapped_ptids = int(merged["PTID"].nunique())
    unmapped_ptids = total_lmp_ptids - mapped_ptids
    no_coords = int(gn[gn["Latitude"].isna() | gn["Longitude"].isna()].shape[0])

    out_cols = ["PTID", "GenName", "Zone", "Subzone", "Latitude", "Longitude", "LMP", "MLC", "MCC"]
    for c in out_cols:
        if c not in merged.columns:
            merged[c] = None

    merged = merged.replace({np.nan: None, np.inf: None, -np.inf: None})
    points = merged[out_cols].to_dict(orient="records")

    zones = sorted(gn_coords["Zone"].dropna().unique().tolist())

    return {
        "market": market,
        "date": date or (available_dates[-1] if available_dates else None),
        "he": he,
        "he_averaged": he is None,
        "points": points,
        "audit": {
            "total_generators_in_metadata": total_gen_ptids,
            "total_generators_in_lmp": total_lmp_ptids,
            "mapped_with_coords": mapped_ptids,
            "unmapped_no_coords": unmapped_ptids,
            "generators_missing_coords": no_coords,
        },
        "available_dates": available_dates,
        "available_hes": available_hes,
        "zones": zones,
    }


# ---------------------------------------------------------------------------
# AI Explainer endpoint
# ---------------------------------------------------------------------------
class AIExplainRequest(BaseModel):
    question: str
    context: Optional[dict[str, Any]] = None


@app.post("/api/ai-explainer")
def ai_explainer(body: AIExplainRequest):
    question = body.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="question is required")

    if not OPENAI_API_KEY:
        return {
            "answer": (
                "AI Analyst is not configured. "
                "Set the OPENAI_API_KEY environment variable to enable this feature."
            ),
            "status": "unconfigured",
        }

    ctx = body.context or {}
    context_block = ""
    if ctx:
        lines = []
        for k, v in ctx.items():
            if v is not None and v != "" and v != []:
                lines.append(f"- {k}: {v}")
        if lines:
            context_block = "Current dashboard context:\n" + "\n".join(lines)

    system_prompt = (
        "You are an expert NYISO electricity market analyst embedded in GridScopeNY, "
        "a premium market intelligence dashboard. Your role:\n"
        "1. Answer using ONLY the provided dashboard context plus the user question.\n"
        "2. Be concise, analytical, and professional.\n"
        "3. If context is insufficient, explicitly say what data is missing.\n"
        "4. Do NOT invent prices, constraints, zones, outages, or explanations not supported by the context.\n"
        "5. Prioritize market reasoning based on: prices, demand, generation, interface flows, congestion, and opportunity explorer outputs.\n"
        "6. Structure your response as:\n"
        "   - A brief summary paragraph\n"
        "   - 'DRIVERS:' section with 2-4 bullet points of likely drivers\n"
        "   - 'CAVEATS:' section with 1-2 bullet points on confidence/limitations\n"
        "7. Keep total response under 300 words."
    )

    user_content = question
    if context_block:
        user_content = f"{context_block}\n\nQuestion: {question}"

    try:
        import openai
        client = openai.OpenAI(api_key=OPENAI_API_KEY)
        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            max_tokens=800,
            temperature=0.3,
        )
        raw = completion.choices[0].message.content or ""

        answer = raw
        drivers: list[str] = []
        caveats: list[str] = []

        if "DRIVERS:" in raw:
            parts = raw.split("DRIVERS:", 1)
            answer = parts[0].strip()
            rest = parts[1]
            if "CAVEATS:" in rest:
                driver_section, caveat_section = rest.split("CAVEATS:", 1)
            else:
                driver_section = rest
                caveat_section = ""
            drivers = [l.strip().lstrip("•-– ").strip() for l in driver_section.strip().split("\n") if l.strip() and l.strip() not in ("", "-")]
            if caveat_section:
                caveats = [l.strip().lstrip("•-– ").strip() for l in caveat_section.strip().split("\n") if l.strip() and l.strip() not in ("", "-")]
        elif "CAVEATS:" in raw:
            parts = raw.split("CAVEATS:", 1)
            answer = parts[0].strip()
            caveats = [l.strip().lstrip("•-– ").strip() for l in parts[1].strip().split("\n") if l.strip()]

        return {
            "answer": answer,
            "drivers": drivers,
            "caveats": caveats,
            "status": "ok",
        }
    except ImportError:
        return {
            "answer": "openai package not installed. Run: pip install openai",
            "status": "error",
        }
    except Exception as exc:
        logger.error("OpenAI error: %s", exc)
        raise HTTPException(status_code=500, detail=f"AI error: {exc}")


class ExplainRequest(BaseModel):
    prompt: str


@app.post("/api/explain")
def explain(body: ExplainRequest):
    req = AIExplainRequest(question=body.prompt)
    return ai_explainer(req)


@app.post("/api/etl/fetch")
def run_etl_fetch():
    try:
        result = subprocess.run(
            [sys.executable, "ETL/fetch_nyiso_data.py"],
            capture_output=True,
            text=True,
            timeout=300,
        )
        return {
            "status": "ok" if result.returncode == 0 else "error",
            "returncode": result.returncode,
            "stdout": result.stdout[-3000:] if result.stdout else "",
            "stderr": result.stderr[-1000:] if result.stderr else "",
        }
    except subprocess.TimeoutExpired:
        return {"status": "timeout", "message": "ETL fetch timed out after 5 minutes"}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/etl/process")
def run_etl_process():
    try:
        result = subprocess.run(
            [sys.executable, "ETL/process_nyiso_data.py"],
            capture_output=True,
            text=True,
            timeout=300,
        )
        return {
            "status": "ok" if result.returncode == 0 else "error",
            "returncode": result.returncode,
            "stdout": result.stdout[-3000:] if result.stdout else "",
            "stderr": result.stderr[-1000:] if result.stderr else "",
        }
    except subprocess.TimeoutExpired:
        return {"status": "timeout", "message": "ETL process timed out after 5 minutes"}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
