"""
GridScope NY — FastAPI backend
Serves processed NYISO data as JSON REST endpoints on port 8000.
"""
from __future__ import annotations

import logging
import subprocess
import sys
from typing import Optional

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


class ExplainRequest(BaseModel):
    prompt: str


@app.post("/api/explain")
def explain(body: ExplainRequest):
    prompt = body.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt is required")

    if not OPENAI_API_KEY:
        return {
            "response": (
                "AI Explainer is not configured. "
                "Set the OPENAI_API_KEY environment variable to enable this feature."
            ),
            "status": "unconfigured",
        }

    try:
        import openai
        client = openai.OpenAI(api_key=OPENAI_API_KEY)
        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an expert NYISO electricity market analyst. "
                        "Explain market events, price movements, congestion, and "
                        "generation patterns clearly and concisely for energy professionals."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            max_tokens=600,
        )
        return {
            "response": completion.choices[0].message.content,
            "status": "ok",
        }
    except ImportError:
        return {
            "response": "openai package not installed. Run: pip install openai",
            "status": "error",
        }
    except Exception as exc:
        logger.error("OpenAI error: %s", exc)
        raise HTTPException(status_code=500, detail=f"AI error: {exc}")


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
