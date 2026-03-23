"""
GridScope NY — FastAPI application factory.
Mounts all route modules and configures middleware.
"""
from __future__ import annotations

import asyncio
import concurrent.futures
import logging
import os
import subprocess
import sys
import threading

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import PROCESSED_DIR
from app.datasets import DATASET_META, LARGE_DATASETS
from app.loader import get_dataset_json
from etl.load.cache import load_file, clear_cache, get_daily_cached, build_daily_cache

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

SCRAPER_INTERVAL_SECONDS = int(os.getenv("SCRAPER_INTERVAL_SECONDS", "900"))

_background_tasks: list[asyncio.Task] = []
_scrape_lock = asyncio.Lock()

# Shared thread pool for blocking data operations
data_executor = concurrent.futures.ThreadPoolExecutor(max_workers=8)

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

# Register route modules
from api.routes import data, analysis, live, ai  # noqa: E402
app.include_router(data.router)
app.include_router(analysis.router)
app.include_router(live.router)
app.include_router(ai.router)


@app.on_event("startup")
async def preload_large_datasets():
    clear_cache()
    logger.info("Cleared in-memory dataframe cache on startup")

    def _preload():
        import gc
        for key in LARGE_DATASETS:
            meta = DATASET_META.get(key)
            if not meta:
                continue
            cached = get_daily_cached(key, meta, PROCESSED_DIR)
            if cached is not None:
                logger.info("Daily cache already exists for %s", key)
                continue
            logger.info("Building daily cache for %s ...", key)
            df = load_file(meta["file"], PROCESSED_DIR, days=0)
            if not df.empty:
                build_daily_cache(key, meta, df, PROCESSED_DIR)
            del df
            clear_cache()
            gc.collect()
        logger.info("Daily cache build complete")

    threading.Thread(target=_preload, daemon=True).start()


@app.on_event("startup")
async def start_background_jobs():
    logger.info("Background jobs started (scraper DISABLED to avoid OOM, using existing parquet/CSV data)")


@app.on_event("shutdown")
async def stop_background_jobs():
    for task in _background_tasks:
        task.cancel()
    for task in _background_tasks:
        try:
            await task
        except asyncio.CancelledError:
            pass
    _background_tasks.clear()


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "GridScope NY API"}
