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

    debug_lmp_rows_loaded = len(lmp)

    if date:
        lmp = lmp[lmp["Date"] == date]
    else:
        if available_dates:
            lmp = lmp[lmp["Date"] == available_dates[-1]]

    debug_lmp_rows_after_date = len(lmp)

    if he is not None and "HE" in lmp.columns:
        lmp = lmp[lmp["HE"] == he]

    debug_lmp_rows_after_he = len(lmp)

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

    selected_date = date or (available_dates[-1] if available_dates else None)

    return {
        "market": market,
        "date": selected_date,
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
        "debug": {
            "lmp_file": lmp_file,
            "lmp_rows_loaded": debug_lmp_rows_loaded,
            "lmp_rows_after_date_filter": debug_lmp_rows_after_date,
            "lmp_rows_after_he_filter": debug_lmp_rows_after_he,
            "lmp_ptids_after_agg": total_lmp_ptids,
            "merged_rows": len(merged),
            "selected_date": selected_date,
            "date_range": f"{available_dates[0]} to {available_dates[-1]}" if available_dates else "none",
        },
    }


# ---------------------------------------------------------------------------
# AI Explainer endpoint
# ---------------------------------------------------------------------------
class AIExplainRequest(BaseModel):
    question: str
    context: Optional[dict[str, Any]] = None


def _strip_markdown(text: str) -> str:
    """Remove markdown formatting artifacts from LLM output."""
    import re
    text = re.sub(r'\*\*([^*]+)\*\*', r'\1', text)
    text = re.sub(r'__([^_]+)__', r'\1', text)
    text = re.sub(r'\*([^*]+)\*', r'\1', text)
    text = re.sub(r'_([^_]+)_', r'\1', text)
    text = re.sub(r'^#{1,4}\s+', '', text, flags=re.MULTILINE)
    text = re.sub(r'`{1,3}[^`]*`{1,3}', '', text)
    text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)
    text = re.sub(r'\*{2,}', '', text)
    text = re.sub(r'_{2,}', '', text)
    return text.strip()


def _parse_bullet_lines(text: str) -> list[str]:
    """Extract clean bullet items from a text block."""
    items = []
    for line in text.strip().split("\n"):
        cleaned = line.strip().lstrip("•-–*1234567890.) ").strip()
        if cleaned and len(cleaned) > 3:
            items.append(_strip_markdown(cleaned))
    return items


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
    context_lines = []
    label_map = {
        "avg_da_lmp": "Avg DA LMP",
        "max_da_lmp": "Peak DA LMP",
        "zones_count": "Active zones",
        "highest_price_zone": "Highest-priced zone",
        "lowest_price_zone": "Lowest-priced zone",
        "peak_forecast_load": "Peak forecast load",
        "avg_forecast_load": "Avg forecast load",
        "datasets_available": "Datasets loaded",
        "top_congested_constraints": "Top congested constraints",
        "da_rt_spread_range": "DA-RT spread range",
        "interface_flow_summary": "Key interface flows",
        "generation_mix": "Generation mix",
    }
    for k, v in ctx.items():
        if v is not None and v != "" and v != [] and k not in ("resolution", "current_page"):
            label = label_map.get(k, k.replace("_", " ").title())
            context_lines.append(f"  {label}: {v}")
    context_block = ""
    if context_lines:
        context_block = "DASHBOARD STATE (use these numbers directly):\n" + "\n".join(context_lines)

    system_prompt = (
        "You are a senior NYISO electricity market analyst. You write concise analyst notes "
        "for energy traders and portfolio managers using GridScopeNY.\n\n"
        "STRICT RULES:\n"
        "- Use the dashboard data provided. Reference actual numbers, zones, and values.\n"
        "- Do NOT use markdown formatting. No **, no #, no `, no bullet symbols.\n"
        "- Write in plain professional prose. No filler, no hedging, no generic disclaimers.\n"
        "- If data is insufficient, state exactly what is missing in one sentence.\n"
        "- Do NOT invent prices, outages, or events not in the context.\n"
        "- Do NOT say 'typically' or 'generally' when specific data is available.\n\n"
        "RESPONSE FORMAT (follow exactly):\n"
        "Write a 2-4 sentence direct answer using specific data points.\n\n"
        "DRIVERS:\n"
        "- First likely driver (one sentence)\n"
        "- Second likely driver (one sentence)\n"
        "- Third likely driver if relevant (one sentence)\n\n"
        "CAVEATS:\n"
        "- One short caveat only if genuinely needed\n\n"
        "Keep the total response under 200 words. Be direct. Sound like an analyst, not a chatbot."
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
            max_tokens=600,
            temperature=0.2,
        )
        raw = completion.choices[0].message.content or ""

        answer = _strip_markdown(raw)
        drivers: list[str] = []
        caveats: list[str] = []

        import re
        drivers_match = re.split(r'(?i)DRIVERS?\s*:', answer, maxsplit=1)
        if len(drivers_match) > 1:
            answer = drivers_match[0].strip()
            rest = drivers_match[1]
            caveats_match = re.split(r'(?i)CAVEATS?\s*:', rest, maxsplit=1)
            if len(caveats_match) > 1:
                drivers = _parse_bullet_lines(caveats_match[0])
                caveats = _parse_bullet_lines(caveats_match[1])
            else:
                drivers = _parse_bullet_lines(rest)
        elif re.search(r'(?i)CAVEATS?\s*:', answer):
            parts = re.split(r'(?i)CAVEATS?\s*:', answer, maxsplit=1)
            answer = parts[0].strip()
            caveats = _parse_bullet_lines(parts[1])

        answer = answer.strip()
        if answer.startswith("Summary") or answer.startswith("SUMMARY"):
            answer = re.sub(r'^(?:SUMMARY|Summary)\s*:?\s*', '', answer).strip()

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
