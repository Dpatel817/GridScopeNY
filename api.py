"""
GridScope NY — FastAPI backend
Serves processed NYISO data as JSON REST endpoints.
Runs on port 8000 (localhost).
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
    ALL_FILE_MAPS,
    get_data_inventory,
    get_dataset_json,
)
from src.config import OPENAI_API_KEY

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(
    title="GridScope NY API",
    description="NYISO market intelligence data API",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "GridScope NY API"}


@app.get("/api/inventory")
def inventory():
    """Return data inventory — which datasets have data and how many rows."""
    return get_data_inventory()


@app.get("/api/{category}/{dataset}")
def get_data(
    category: str,
    dataset: str,
    limit: int = Query(default=5000, ge=1, le=50000),
):
    """
    Fetch data for a specific category + dataset.

    Categories: prices, demand, generation, interfaces, congestion
    Dataset names are the keys within each category's file map.
    """
    if category not in ALL_FILE_MAPS:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown category '{category}'. Valid: {list(ALL_FILE_MAPS.keys())}",
        )

    file_map = ALL_FILE_MAPS[category]
    if dataset not in file_map:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown dataset '{dataset}' in category '{category}'. "
                   f"Valid: {list(file_map.keys())}",
        )

    return get_dataset_json(category, dataset, limit=limit)


@app.get("/api/{category}")
def list_datasets(category: str):
    """List all available datasets for a category."""
    if category not in ALL_FILE_MAPS:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown category '{category}'. Valid: {list(ALL_FILE_MAPS.keys())}",
        )
    return {
        "category": category,
        "datasets": list(ALL_FILE_MAPS[category].keys()),
    }


class ExplainRequest(BaseModel):
    prompt: str


@app.post("/api/explain")
def explain(body: ExplainRequest):
    """AI explanation endpoint. Requires OPENAI_API_KEY env var."""
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
    """Trigger the NYISO data fetch ETL script."""
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
    """Trigger the NYISO data processing ETL script."""
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
