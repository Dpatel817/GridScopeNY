"""Data access routes: /api/dataset, /api/inventory, /api/page, /api/filters"""
from __future__ import annotations

import asyncio
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.datasets import DATASET_META, PAGE_DATASETS
from app.loader import get_dataset_json, get_filter_options, get_page_config, get_data_inventory

router = APIRouter()

# Reuse the shared executor from main
def _get_executor():
    from api.main import data_executor
    return data_executor


@router.get("/api/inventory")
def inventory():
    return get_data_inventory()


@router.get("/api/page/{page}")
def page_config(page: str):
    if page not in PAGE_DATASETS:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown page '{page}'. Valid: {list(PAGE_DATASETS.keys())}",
        )
    return get_page_config(page)


@router.get("/api/dataset/{dataset_key}")
async def get_data(
    dataset_key: str,
    resolution: str = Query(default="raw", pattern="^(raw|hourly|on_peak|off_peak|daily)$"),
    limit: int = Query(default=10000, ge=1, le=500000),
    filter_col: Optional[str] = Query(default=None),
    filter_val: Optional[str] = Query(default=None),
    days: int = Query(default=0, ge=0),
    offset: int = Query(default=0, ge=0),
):
    if dataset_key not in DATASET_META:
        raise HTTPException(status_code=404, detail=f"Unknown dataset '{dataset_key}'.")
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        _get_executor(),
        lambda: get_dataset_json(
            dataset_key,
            resolution=resolution,
            limit=limit,
            filter_col=filter_col,
            filter_val=filter_val,
            days=days if days > 0 else None,
            offset=offset,
        ),
    )


@router.get("/api/filters/{dataset_key}/{column}")
def filters(dataset_key: str, column: str):
    if dataset_key not in DATASET_META:
        raise HTTPException(status_code=404, detail=f"Unknown dataset '{dataset_key}'.")
    options = get_filter_options(dataset_key, column)
    return {"dataset": dataset_key, "column": column, "options": options}
