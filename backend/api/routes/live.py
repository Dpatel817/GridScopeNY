"""Live data routes: TTCF derates, OIC, daily events"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from etl.extract.live import fetch_ttcf, fetch_oic, fetch_oic_range, fetch_daily_events

router = APIRouter()


@router.get("/api/ttcf-derates")
def ttcf_derates(date: Optional[str] = Query(default=None)):
    return fetch_ttcf(date)


@router.get("/api/oic")
def oic_data(date: Optional[str] = Query(default=None)):
    return fetch_oic(date)


@router.get("/api/oic-range")
def oic_range_data(
    start_date: str = Query(...),
    end_date: str = Query(...),
):
    return fetch_oic_range(start_date, end_date)


@router.get("/api/daily-events")
def get_daily_events(date: Optional[str] = Query(default=None)):
    try:
        from datetime import datetime
        if date:
            datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Date must be YYYY-MM-DD")
    return fetch_daily_events(date)


@router.post("/api/iq/scrape")
def scrape_interconnection_queue():
    try:
        from etl.interconnection_queue import run as iq_run
        from etl.load.cache import _df_cache
        success = iq_run()
        for key in list(_df_cache.keys()):
            if "iq_" in key or "interconnection" in key:
                del _df_cache[key]
        return {"status": "ok" if success else "error"}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
