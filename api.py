"""
GridScope NY — FastAPI backend
Serves processed NYISO data as JSON REST endpoints on port 8000.
"""
from __future__ import annotations

import asyncio
import concurrent.futures
import logging
import os
import subprocess
import sys
from typing import Optional, Any

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

_data_executor = concurrent.futures.ThreadPoolExecutor(max_workers=8)

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

SCRAPER_INTERVAL_SECONDS = int(os.getenv("SCRAPER_INTERVAL_SECONDS", "900"))
CACHE_REFRESH_INTERVAL_SECONDS = int(os.getenv("CACHE_REFRESH_INTERVAL_SECONDS", "300"))

_background_tasks: list[asyncio.Task] = []
_scrape_lock = asyncio.Lock()
_cache_lock = asyncio.Lock()

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


@app.on_event("startup")
async def preload_large_datasets():
    import threading
    from src.api_data_loader import _LARGE_DATASETS, _get_daily_cached, _build_daily_cache, _aggregate_df, _df_cache
    _df_cache.clear()
    logger.info("Cleared in-memory dataframe cache on startup")
    def _preload():
        import gc
        for key in _LARGE_DATASETS:
            meta = DATASET_META.get(key)
            if not meta:
                continue
            cached = _get_daily_cached(key, meta)
            if cached is not None:
                logger.info("Daily cache already exists for %s", key)
                continue
            logger.info("Building daily cache for %s ...", key)
            df = _load_csv_safe(meta["file"], days=0)
            if not df.empty:
                _build_daily_cache(key, meta, df)
            del df
            _df_cache.clear()
            gc.collect()
        logger.info("Daily cache build complete")
    threading.Thread(target=_preload, daemon=True).start()


def _refresh_memory_cache() -> None:
    from src.api_data_loader import _df_cache

    _df_cache.clear()
    logger.info("Cleared API dataframe cache")


def _run_scraper_once() -> None:
    logger.info("Starting scheduled scrape job")
    cmd = [sys.executable, "scraper.py", "--lookback-days", "2"]
    completed = subprocess.run(
        cmd,
        cwd=os.path.dirname(os.path.abspath(__file__)),
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        logger.error(
            "Scheduled scraper failed (code=%s): %s",
            completed.returncode,
            completed.stderr.strip() or completed.stdout.strip(),
        )
        return

    logger.info("Scheduled scrape completed successfully")
    _refresh_memory_cache()


async def _scraper_loop() -> None:
    await asyncio.sleep(60)
    while True:
        try:
            async with _scrape_lock:
                await asyncio.to_thread(_run_scraper_once)
        except Exception:
            logger.exception("Unexpected error in scraper loop")
        await asyncio.sleep(SCRAPER_INTERVAL_SECONDS)


async def _cache_refresh_loop() -> None:
    pass


@app.on_event("startup")
async def start_background_jobs():
    logger.info(
        "Background jobs started (scraper DISABLED to avoid OOM, using existing parquet/CSV data)",
    )


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
        raise HTTPException(
            status_code=404,
            detail=f"Unknown dataset '{dataset_key}'.",
        )
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        _data_executor,
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


@app.get("/api/filters/{dataset_key}/{column}")
def filters(dataset_key: str, column: str):
    if dataset_key not in DATASET_META:
        raise HTTPException(status_code=404, detail=f"Unknown dataset '{dataset_key}'.")
    options = get_filter_options(dataset_key, column)
    return {"dataset": dataset_key, "column": column, "options": options}


# ---------------------------------------------------------------------------
# Constraint Impact Analysis endpoint
# ---------------------------------------------------------------------------
def _find_clean_prints(constr_df, facility, contingency):
    """Identify clean prints: Date+HE intervals where only one unique
    constraint (facility+contingency) is materially binding.
    A print is 'clean' when no other constraint has |cost| > threshold
    at the same Date+HE, making the MCC impact more attributable."""
    if constr_df.empty or not facility or not contingency:
        return [], []

    COST_THRESHOLD = 1.0
    grouped = constr_df.groupby(["Date", "HE"]).apply(
        lambda g: g[g["Constraint Cost"].abs() >= COST_THRESHOLD][["Limiting Facility", "Contingency"]].drop_duplicates().shape[0],
        include_groups=False
    ).reset_index(name="active_constraints")

    target_rows = constr_df[
        (constr_df["Limiting Facility"] == facility) &
        (constr_df["Contingency"] == contingency) &
        (constr_df["Constraint Cost"].abs() >= COST_THRESHOLD)
    ][["Date", "HE"]].drop_duplicates()

    merged = target_rows.merge(grouped, on=["Date", "HE"], how="left")
    clean = merged[merged["active_constraints"] == 1]
    mixed = merged[merged["active_constraints"] > 1]

    clean_prints = [{"date": r["Date"], "he": int(r["HE"])} for _, r in clean.iterrows()]
    mixed_prints = [{"date": r["Date"], "he": int(r["HE"]), "active_constraints": int(r["active_constraints"])} for _, r in mixed.iterrows()]
    return clean_prints, mixed_prints


def _build_congestion_pivot(constr_df, facility=None, contingency=None):
    """Build hourly pivot of constraint costs: rows=Date, cols=HE."""
    if constr_df.empty:
        return []
    work = constr_df.copy()
    if facility:
        work = work[work["Limiting Facility"] == facility]
    if contingency:
        work = work[work["Contingency"] == contingency]
    if work.empty:
        return []

    pivot = work.pivot_table(
        index="Date", columns="HE", values="Constraint Cost",
        aggfunc="sum", fill_value=0
    ).round(2)
    pivot = pivot.reset_index()
    pivot.columns = [str(c) for c in pivot.columns]
    return pivot.to_dict(orient="records")


@app.get("/api/constraint-impact")
def constraint_impact(
    market: str = Query(default="DA", pattern="^(DA|RT)$"),
    date: Optional[str] = Query(default=None),
    he: Optional[int] = Query(default=None, ge=0, le=23),
    facility: Optional[str] = Query(default=None),
    contingency: Optional[str] = Query(default=None),
    clean_only: bool = Query(default=False),
    search: Optional[str] = Query(default=None),
):
    constr_key = "dam_limiting_constraints" if market == "DA" else "rt_limiting_constraints"
    zone_key = "da_lbmp_zone" if market == "DA" else "rt_lbmp_zone"
    gen_key = "da_lbmp_gen" if market == "DA" else "rt_lbmp_gen"
    gen_names_meta = DATASET_META.get("generator_names")

    constr_meta = DATASET_META.get(constr_key)
    zone_meta = DATASET_META.get(zone_key)
    gen_meta = DATASET_META.get(gen_key)

    if not constr_meta:
        raise HTTPException(status_code=404, detail=f"Constraint dataset {constr_key} not configured")

    constr = _load_csv_safe(constr_meta["file"])
    if constr.empty:
        return {"status": "empty", "message": "No constraint data available"}

    if "Date" in constr.columns and hasattr(constr["Date"].iloc[0], "strftime"):
        constr["Date"] = constr["Date"].dt.strftime("%Y-%m-%d")

    all_facilities = sorted(constr["Limiting Facility"].dropna().unique().tolist())

    if search:
        sq = search.lower()
        filtered_facilities = [f for f in all_facilities if sq in f.lower()]
    else:
        filtered_facilities = all_facilities

    fac_subset = constr.copy()
    if facility:
        fac_subset = fac_subset[fac_subset["Limiting Facility"] == facility]

    contingencies = sorted(fac_subset["Contingency"].dropna().unique().tolist()) if facility else []

    fc_subset = fac_subset.copy()
    if contingency:
        fc_subset = fc_subset[fc_subset["Contingency"] == contingency]

    available_dates = sorted(fc_subset["Date"].dropna().unique().tolist()) if (facility and contingency) else sorted(constr["Date"].dropna().unique().tolist())

    if facility and contingency and not date and available_dates:
        date = available_dates[-1]

    available_hes = []
    if facility and contingency and date:
        day_fc = fc_subset[fc_subset["Date"] == date]
        available_hes = sorted(day_fc["HE"].dropna().unique().astype(int).tolist()) if "HE" in day_fc.columns else []

    if not (facility and contingency and date):
        return {
            "market": market, "date": date, "he": he,
            "facility": facility, "contingency": contingency,
            "clean_only": clean_only,
            "constraint_summary": None,
            "zonal_impact": [], "generator_impact": [],
            "clean_prints": [], "mixed_prints": [],
            "congestion_pivot": [],
            "available_dates": available_dates, "available_hes": available_hes,
            "facilities": filtered_facilities, "contingencies": contingencies,
            "status": "pending",
        }

    date_filtered = constr[constr["Date"] == date].copy()

    clean_prints, mixed_prints = _find_clean_prints(date_filtered, facility, contingency)
    clean_hes = [p["he"] for p in clean_prints]

    selected = fc_subset[fc_subset["Date"] == date].copy()

    if he is not None and "HE" in selected.columns:
        selected = selected[selected["HE"] == he]
    elif clean_only and facility and contingency:
        if clean_hes:
            selected = selected[selected["HE"].isin(clean_hes)]
        else:
            selected = selected.iloc[0:0]

    pivot_data = _build_congestion_pivot(date_filtered, facility, contingency)

    empty_response = {
        "market": market, "date": date, "he": he,
        "facility": facility, "contingency": contingency,
        "clean_only": clean_only,
        "constraint_summary": None,
        "zonal_impact": [], "generator_impact": [],
        "clean_prints": clean_prints, "mixed_prints": mixed_prints,
        "congestion_pivot": pivot_data,
        "available_dates": available_dates, "available_hes": available_hes,
        "facilities": filtered_facilities, "contingencies": contingencies,
        "status": "no_data",
    }

    if selected.empty:
        return empty_response

    costs = selected["Constraint Cost"].dropna().tolist()

    is_clean = False
    if he is not None and facility and contingency:
        is_clean = he in clean_hes

    constraint_summary = {
        "facility": facility or "All",
        "contingency": contingency or "All",
        "date": date,
        "he": he,
        "total_cost": round(sum(abs(c) for c in costs), 2),
        "avg_cost": round(sum(abs(c) for c in costs) / len(costs), 2) if costs else 0,
        "max_cost": round(max(abs(c) for c in costs), 2) if costs else 0,
        "min_cost": round(min(abs(c) for c in costs), 2) if costs else 0,
        "binding_count": len(costs),
        "unique_hours": int(selected["HE"].nunique()) if "HE" in selected.columns else 0,
        "unique_dates": int(selected["Date"].nunique()),
        "is_clean_print": is_clean,
        "clean_print_count": len(clean_prints),
        "mixed_print_count": len(mixed_prints),
    }

    date_hes = selected[["Date", "HE"]].drop_duplicates()
    zonal_impact = []
    if zone_meta:
        zone_df = _load_csv_safe(zone_meta["file"])
        if not zone_df.empty:
            if "Date" in zone_df.columns and hasattr(zone_df["Date"].iloc[0], "strftime"):
                zone_df["Date"] = zone_df["Date"].dt.strftime("%Y-%m-%d")

            zone_match = zone_df.merge(date_hes, on=["Date", "HE"], how="inner")

            if len(zone_match) > 0:
                zone_match = zone_match.groupby("Zone")[["LMP", "MLC", "MCC"]].mean().reset_index()

            if len(zone_match) > 0:
                sys_avg_lmp = zone_match["LMP"].mean()
                zone_match["delta_vs_system"] = (zone_match["LMP"] - sys_avg_lmp).round(2)
                zone_match["mcc_abs"] = zone_match["MCC"].abs()
                zone_match = zone_match.sort_values("mcc_abs", ascending=False)

                def interpret(row):
                    mcc = row["MCC"]
                    if abs(mcc) < 0.5:
                        return "Neutral"
                    if mcc > 0:
                        return "Bearish (paying congestion)"
                    return "Bullish (receiving congestion credit)"

                zone_match["interpretation"] = zone_match.apply(interpret, axis=1)
                zone_match = zone_match.replace({np.nan: None, np.inf: None, -np.inf: None})
                zonal_impact = zone_match[["Zone", "LMP", "MLC", "MCC", "delta_vs_system", "interpretation"]].round(2).to_dict(orient="records")

    generator_impact = []
    if gen_meta and gen_names_meta:
        gen_df = _load_csv_safe(gen_meta["file"])
        gn_df = _load_csv_safe(gen_names_meta["file"])

        if not gen_df.empty:
            if "Date" in gen_df.columns and hasattr(gen_df["Date"].iloc[0], "strftime"):
                gen_df["Date"] = gen_df["Date"].dt.strftime("%Y-%m-%d")

            gen_match = gen_df.merge(date_hes, on=["Date", "HE"], how="inner")

            if len(gen_match) > 0:
                gen_lookup = gen_match.drop_duplicates("PTID")[["PTID", "Generator"]]
                gen_agg = gen_match.groupby("PTID")[["LMP", "MLC", "MCC"]].mean().reset_index()
                gen_agg = gen_agg.merge(gen_lookup, on="PTID", how="left")

                if not gn_df.empty:
                    zone_lookup = gn_df[["PTID", "Zone"]].drop_duplicates("PTID")
                    gen_agg = gen_agg.merge(zone_lookup, on="PTID", how="left")

                gen_agg["mcc_abs"] = gen_agg["MCC"].abs()
                gen_agg = gen_agg.sort_values("mcc_abs", ascending=False)
                gen_agg = gen_agg.replace({np.nan: None, np.inf: None, -np.inf: None})

                top_gens = gen_agg.head(25)
                generator_impact = top_gens[
                    [c for c in ["Generator", "PTID", "Zone", "LMP", "MLC", "MCC"] if c in top_gens.columns]
                ].round(2).to_dict(orient="records")

    return {
        "market": market,
        "date": date,
        "he": he,
        "facility": facility,
        "contingency": contingency,
        "clean_only": clean_only,
        "constraint_summary": constraint_summary,
        "zonal_impact": zonal_impact,
        "generator_impact": generator_impact,
        "clean_prints": clean_prints,
        "mixed_prints": mixed_prints,
        "congestion_pivot": pivot_data,
        "available_dates": available_dates,
        "available_hes": available_hes,
        "facilities": filtered_facilities,
        "contingencies": contingencies,
        "status": "ok",
    }


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
    search_all_datasets: Optional[bool] = False


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


def _build_server_side_context() -> dict[str, Any]:
    """Build a comprehensive data summary from all available datasets server-side."""
    ctx: dict[str, Any] = {}
    zone_avgs: list[tuple[str, float]] = []
    by_zone: dict[str, list[float]] = {}
    nyiso_vals: list[float] = []

    try:
        da_zone = get_dataset_json("da_lbmp_zone", resolution="daily", limit=500)
        if da_zone.get("data"):
            records = [r for r in da_zone["data"] if r.get("Zone", "").strip() not in ("H Q", "NPX", "O H", "PJM", "")]
            lmps = [float(r.get("LMP", 0)) for r in records if r.get("LMP")]
            if lmps:
                ctx["avg_da_lmp"] = f"${sum(lmps)/len(lmps):.2f}/MWh"
                ctx["max_da_lmp"] = f"${max(lmps):.2f}/MWh"
                ctx["min_da_lmp"] = f"${min(lmps):.2f}/MWh"
            for r in records:
                z = str(r.get("Zone", ""))
                v = float(r.get("LMP", 0))
                if z and v:
                    by_zone.setdefault(z, []).append(v)
            zone_avgs = sorted(
                [(z, sum(vs)/len(vs)) for z, vs in by_zone.items()],
                key=lambda x: -x[1]
            )
            if zone_avgs:
                ctx["zone_price_ranking"] = ", ".join(f"{z}: ${a:.2f}" for z, a in zone_avgs[:5])
                ctx["highest_price_zone"] = f"{zone_avgs[0][0]} (${zone_avgs[0][1]:.2f}/MWh)"
                ctx["lowest_price_zone"] = f"{zone_avgs[-1][0]} (${zone_avgs[-1][1]:.2f}/MWh)"
            dates = sorted(set(str(r.get("Date", "")) for r in records if r.get("Date")))
            if dates:
                ctx["da_date_range"] = f"{dates[0]} to {dates[-1]}"
    except Exception as exc:
        logger.warning("Server context - DA prices error: %s", exc)

    try:
        rt_zone = get_dataset_json("rt_lbmp_zone", resolution="daily", limit=500)
        if rt_zone.get("data"):
            rt_records = [r for r in rt_zone["data"] if r.get("Zone", "").strip() not in ("H Q", "NPX", "O H", "PJM", "")]
            rt_lmps = [float(r.get("LMP", 0)) for r in rt_records if r.get("LMP")]
            if rt_lmps:
                ctx["avg_rt_lmp"] = f"${sum(rt_lmps)/len(rt_lmps):.2f}/MWh"
                ctx["max_rt_lmp"] = f"${max(rt_lmps):.2f}/MWh"
            rt_by_zone: dict[str, list[float]] = {}
            for r in rt_records:
                z = str(r.get("Zone", ""))
                v = float(r.get("LMP", 0))
                if z and v:
                    rt_by_zone.setdefault(z, []).append(v)
            if zone_avgs and rt_by_zone:
                spreads = []
                for z, da_avg in zone_avgs[:11]:
                    rt_vals = rt_by_zone.get(z, [])
                    rt_avg = sum(rt_vals) / len(rt_vals) if rt_vals else da_avg
                    spreads.append((z, da_avg - rt_avg, abs(da_avg - rt_avg)))
                spreads.sort(key=lambda x: -x[2])
                ctx["top_spread_zones"] = ", ".join(f"{s[0]}: ${s[1]:.2f} (DA-RT)" for s in spreads[:3])
    except Exception as exc:
        logger.warning("Server context - RT prices error: %s", exc)

    try:
        isolf = get_dataset_json("isolf", resolution="daily", limit=500)
        if isolf.get("data"):
            nyiso_vals = [float(r.get("NYISO", 0)) for r in isolf["data"] if r.get("NYISO")]
            if nyiso_vals:
                ctx["peak_forecast_load"] = f"{max(nyiso_vals):,.0f} MW"
                ctx["avg_forecast_load"] = f"{sum(nyiso_vals)/len(nyiso_vals):,.0f} MW"
    except Exception as exc:
        logger.warning("Server context - forecast load error: %s", exc)

    try:
        pal = get_dataset_json("pal", resolution="daily", limit=500)
        if pal.get("data"):
            actuals = [float(r.get("NYISO", 0) or r.get("Actual Load", 0)) for r in pal["data"]]
            actuals = [a for a in actuals if a]
            if actuals:
                ctx["peak_actual_load"] = f"{max(actuals):,.0f} MW"
                if nyiso_vals:
                    avg_f = sum(nyiso_vals) / len(nyiso_vals)
                    avg_a = sum(actuals) / len(actuals)
                    err = ((avg_f - avg_a) / avg_a * 100)
                    ctx["forecast_error"] = f"{'+' if err > 0 else ''}{err:.1f}% ({'over' if err > 0 else 'under'}-forecast)"
    except Exception as exc:
        logger.warning("Server context - actual load error: %s", exc)

    try:
        gen = get_dataset_json("rtfuelmix", resolution="daily", limit=500)
        if gen.get("data"):
            fuels: dict[str, float] = {}
            for r in gen["data"]:
                fuel = str(r.get("Fuel Type", "") or r.get("Fuel Category", ""))
                mw = float(r.get("Generation MW", 0) or r.get("Gen MWh", 0))
                if fuel and mw:
                    fuels[fuel] = fuels.get(fuel, 0) + mw
            total = sum(fuels.values())
            if total > 0:
                sorted_fuels = sorted(fuels.items(), key=lambda x: -x[1])
                ctx["generation_mix"] = ", ".join(f"{f}: {v/total*100:.1f}%" for f, v in sorted_fuels[:5])
                ctx["total_generation"] = f"{total:,.0f} MW"
                renew = sum(fuels.get(f, 0) for f in ("Wind", "Solar", "Hydro"))
                ctx["renewable_share"] = f"{renew/total*100:.1f}%"
    except Exception as exc:
        logger.warning("Server context - generation error: %s", exc)

    try:
        cong = get_dataset_json("dam_limiting_constraints", resolution="daily", limit=500)
        if cong.get("data"):
            constraints: dict[str, dict[str, Any]] = {}
            for r in cong["data"]:
                name = str(r.get("Limiting Facility", "") or r.get("Constraint Name", ""))
                cost = abs(float(r.get("Constraint Cost", 0) or r.get("Shadow Price", 0)))
                if name and cost:
                    if name not in constraints:
                        constraints[name] = {"totalCost": 0, "count": 0}
                    constraints[name]["totalCost"] += cost
                    constraints[name]["count"] += 1
            sorted_c = sorted(constraints.items(), key=lambda x: -x[1]["totalCost"])
            if sorted_c:
                ctx["top_constraints"] = "; ".join(
                    f"{n}: ${v['totalCost']:.0f} total ({v['count']} intervals)"
                    for n, v in sorted_c[:5]
                )
                ctx["total_congestion_cost"] = f"${sum(v['totalCost'] for _, v in sorted_c):.0f}"
    except Exception as exc:
        logger.warning("Server context - congestion error: %s", exc)

    for key, ds_name, products in [
        ("da_ancillary_prices", "damasp", ["10 Min Spin", "10 Min Non-Sync", "30 Min OR", "Reg Cap"]),
        ("rt_ancillary_prices", "rtasp", ["10 Min Spin", "10 Min Non-Sync", "30 Min OR", "Reg Cap"]),
    ]:
        try:
            asp = get_dataset_json(ds_name, resolution="daily", limit=500)
            if asp.get("data"):
                stats: dict[str, dict[str, float]] = {}
                for r in asp["data"]:
                    for p in products:
                        val = float(r.get(p, 0))
                        if val:
                            if p not in stats:
                                stats[p] = {"max": 0, "sum": 0, "cnt": 0}
                            stats[p]["max"] = max(stats[p]["max"], val)
                            stats[p]["sum"] += val
                            stats[p]["cnt"] += 1
                parts = [f"{p}: avg ${s['sum']/s['cnt']:.2f}, max ${s['max']:.2f}"
                         for p, s in stats.items() if s["cnt"] > 0]
                if parts:
                    ctx[key] = "; ".join(parts)
        except Exception as exc:
            logger.warning("Server context - %s error: %s", ds_name, exc)

    try:
        flows = get_dataset_json("external_limits_flows", resolution="daily", limit=500)
        if flows.get("data"):
            ifaces: dict[str, dict[str, list[float]]] = {}
            for r in flows["data"]:
                name = str(r.get("Interface Name", "") or r.get("Point Name", ""))
                flow = float(r.get("Flow MW", 0) or r.get("Flow (MW)", 0) or r.get("Power (MW)", 0))
                limit_val = float(r.get("Positive Limit", 0) or r.get("Limit (MW)", 0))
                if name:
                    if name not in ifaces:
                        ifaces[name] = {"flows": [], "limits": []}
                    ifaces[name]["flows"].append(flow)
                    if limit_val:
                        ifaces[name]["limits"].append(limit_val)
            flow_summary = []
            for name, v in ifaces.items():
                if not v["flows"]:
                    continue
                avg_f = sum(v["flows"]) / len(v["flows"])
                max_f = max(v["flows"])
                avg_l = sum(v["limits"]) / len(v["limits"]) if v["limits"] else 0
                util = (avg_f / avg_l * 100) if avg_l else 0
                flow_summary.append((name, avg_f, max_f, util))
            flow_summary.sort(key=lambda x: -x[3])
            if flow_summary:
                ctx["interface_flows"] = "; ".join(
                    f"{f[0]}: avg {f[1]:.0f} MW, max {f[2]:.0f} MW, {f[3]:.0f}% utilized"
                    for f in flow_summary[:5]
                )
                constrained = [f for f in flow_summary if f[3] > 80]
                if constrained:
                    ctx["constrained_interfaces"] = ", ".join(f"{f[0]} ({f[3]:.0f}%)" for f in constrained)
    except Exception as exc:
        logger.warning("Server context - interface flows error: %s", exc)

    return ctx


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

    if body.search_all_datasets:
        server_ctx = _build_server_side_context()
        for k, v in server_ctx.items():
            if k not in ctx or not ctx[k]:
                ctx[k] = v

    context_lines = []
    label_map = {
        "avg_da_lmp": "Avg DA LMP (Zones A-K)",
        "max_da_lmp": "Peak DA LMP",
        "min_da_lmp": "Min DA LMP",
        "avg_rt_lmp": "Avg RT LMP (Zones A-K)",
        "zones_count": "Active zones",
        "highest_price_zone": "Highest-priced zone",
        "lowest_price_zone": "Lowest-priced zone",
        "zone_price_ranking": "Zone price ranking",
        "da_rt_spread": "DA-RT spread",
        "spread_rankings": "DA-RT spread rankings",
        "peak_forecast_load": "Peak forecast load",
        "avg_forecast_load": "Avg forecast load",
        "top_congested_constraints": "Top congested constraints",
        "generation_mix": "Generation mix",
        "rt_events": "Recent RT events",
        "oper_messages": "Operational announcements",
        "top_battery_zone": "Top battery opportunity zone",
        "battery_revenue": "Estimated battery revenue",
        "selected_zone": "Selected zone",
        "zone_rank": "Zone rank",
        "avg_spread": "Zone avg DA-RT spread",
        "max_spread": "Zone max spread",
        "estimated_revenue": "Zone estimated revenue",
        "volatility": "Zone volatility (sigma)",
        "signal_type": "Signal type",
        "spread_events": "Spread events",
        "rt_premium_pct": "RT premium %",
        "battery_duration": "Battery duration",
        "zones_analyzed": "Zones analyzed",
        "top_constraints": "Top constraints",
        "peak_load": "Peak load",
        "avg_load": "Avg load",
        "trader_insight_summary": "Trader insight",
        "battery_insight_summary": "Battery insight",
        "datasets_available": "Datasets loaded",
        "interface_flow_summary": "Key interface flows",
        "date_range": "Analysis date range",
        "da_date_range": "DA data range",
        "top_spread_zones": "Top DA-RT spread zones",
        "forecast_error": "Forecast error",
        "total_generation": "Total generation",
        "renewable_share": "Renewable share",
        "total_congestion_cost": "Total congestion cost",
        "da_ancillary_prices": "DA ancillary prices",
        "rt_ancillary_prices": "RT ancillary prices",
        "interface_flows": "Interface flows",
        "constrained_interfaces": "Constrained interfaces",
        "peak_actual_load": "Peak actual load",
    }
    for k, v in ctx.items():
        if v is not None and v != "" and v != [] and k not in ("resolution", "current_page"):
            label = label_map.get(k, k.replace("_", " ").title())
            context_lines.append(f"  {label}: {v}")
    context_block = ""
    if context_lines:
        context_block = "DASHBOARD STATE (use these numbers directly):\n" + "\n".join(context_lines)

    system_prompt = (
        "You are a senior NYISO electricity market analyst and strategist at a top-tier energy trading desk. "
        "You have deep expertise in power market fundamentals, congestion pricing, ancillary service markets, "
        "battery storage economics, and NYISO market structure. You think in terms of risk/reward, "
        "basis differentials, heat rates, load-weighted prices, and congestion rent.\n\n"
        "SCOPE: NYISO Zones A through K only. Zone A=WEST, B=GENESE, C=CENTRL, D=NORTH, E=MHK VL, "
        "F=CAPITL, G=HUD VL, H=MILLWD, I=DUNWOD, J=N.Y.C., K=LONGIL. "
        "Do NOT analyze H Q, NPX, O H, or PJM - these are external settlement nodes, not NYISO zones.\n\n"
        "You have access to comprehensive data across ALL datasets: Day-Ahead and Real-Time zonal LBMPs, "
        "load forecasts and actuals, real-time fuel mix, DA and RT ancillary service prices, "
        "binding transmission constraints, interface flows and limits, and interconnection queue data.\n\n"
        "ANALYTICAL FRAMEWORK — always think through:\n"
        "1. PRICE FORMATION: What is driving zonal price separation? Congestion, load, or generation mix?\n"
        "2. SPREAD DYNAMICS: Are DA-RT spreads structural (congestion-driven) or episodic (weather/outage)?\n"
        "3. RISK ASSESSMENT: What verification risk exists? Is the signal persistent or fading?\n"
        "4. CROSS-MARKET SIGNALS: Do ancillary prices, interface flows, or load patterns confirm the thesis?\n"
        "5. ACTIONABLE POSITIONING: What specific trade or storage strategy does the data support?\n\n"
        "STRICT RULES:\n"
        "- Use the dashboard data provided. Reference actual numbers, zones, and values.\n"
        "- Connect the dots across datasets — do not silo your analysis to one data source.\n"
        "- Identify causation where data supports it, not just correlation.\n"
        "- Do NOT use markdown formatting. No **, no #, no `, no bullet symbols.\n"
        "- Write in plain professional prose. No filler, no hedging, no generic disclaimers.\n"
        "- If data is insufficient, state exactly what is missing in one sentence.\n"
        "- Do NOT invent prices, outages, or events not in the context.\n"
        "- Sound like a desk analyst writing a morning market note, not a chatbot.\n\n"
        "RESPONSE FORMAT (follow exactly):\n\n"
        "SUMMARY:\n"
        "2-4 sentence direct answer with specific data. Lead with the most tradeable insight.\n\n"
        "TRADER TAKEAWAYS:\n"
        "- 2-4 concise bullets: spread behavior, dislocations, congestion sensitivity, "
        "verification risk, arbitrage conditions, cross-market confirmation\n\n"
        "BATTERY STRATEGIST TAKEAWAYS:\n"
        "- 2-4 concise bullets: duration fit, charge/discharge windows, persistence, "
        "structural vs event-driven value, congestion-behind-the-meter opportunity\n\n"
        "KEY SIGNALS:\n"
        "- 2-4 short bullets citing actual metrics across datasets (spreads, constraints, load, "
        "flows, ancillary prices, generation mix)\n\n"
        "CAVEAT:\n"
        "- One short caveat only if genuinely needed. Omit this section if no caveat is needed.\n\n"
        "Keep the total response under 350 words. Be direct and specific."
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
            max_tokens=1200,
            temperature=0.2,
        )
        raw = completion.choices[0].message.content or ""
        answer = _strip_markdown(raw)

        import re

        section_headers = [
            r'SUMMARY\s*:', r'TRADER\s+TAKEAWAYS?\s*:', r'BATTERY\s+STRATEGIST\s+TAKEAWAYS?\s*:',
            r'KEY\s+(?:SUPPORTING\s+)?SIGNALS?\s*:', r'CAVEATS?\s*:', r'DRIVERS?\s*:'
        ]

        def _extract_section(text: str, start_pattern: str, end_patterns: list[str]) -> list[str]:
            m = re.search(start_pattern, text, re.IGNORECASE)
            if not m:
                return []
            rest = text[m.end():]
            end_pos = len(rest)
            for ep in end_patterns:
                em = re.search(ep, rest, re.IGNORECASE)
                if em and em.start() < end_pos:
                    end_pos = em.start()
            return _parse_bullet_lines(rest[:end_pos])

        def _extract_summary(text: str) -> str:
            m = re.search(r'(?i)SUMMARY\s*:', text)
            if m:
                rest = text[m.end():]
                end_pos = len(rest)
                for ep in section_headers:
                    if 'SUMMARY' in ep:
                        continue
                    em = re.search(ep, rest, re.IGNORECASE)
                    if em and em.start() < end_pos:
                        end_pos = em.start()
                return rest[:end_pos].strip()
            return re.split(r'(?i)(?:TRADER|BATTERY|KEY|DRIVER|CAVEAT)', text, maxsplit=1)[0].strip()

        summary_text = _extract_summary(answer)
        summary_text = re.sub(r'^(?:SUMMARY|Summary)\s*:?\s*', '', summary_text).strip()

        trader_items = _extract_section(answer, r'TRADER\s+TAKEAWAYS?\s*:',
            [p for p in section_headers if 'TRADER' not in p])
        battery_items = _extract_section(answer, r'BATTERY\s+STRATEGIST\s+TAKEAWAYS?\s*:',
            [p for p in section_headers if 'BATTERY' not in p])
        signal_items = _extract_section(answer, r'KEY\s+(?:SUPPORTING\s+)?SIGNALS?\s*:',
            [p for p in section_headers if 'KEY' not in p and 'SIGNAL' not in p])
        if not signal_items:
            signal_items = _extract_section(answer, r'DRIVERS?\s*:',
                [p for p in section_headers if 'DRIVER' not in p])
        caveat_items = _extract_section(answer, r'CAVEATS?\s*:',
            [p for p in section_headers if 'CAVEAT' not in p])

        return {
            "answer": summary_text,
            "trader_takeaways": trader_items,
            "battery_takeaways": battery_items,
            "key_signals": signal_items,
            "drivers": signal_items if signal_items else trader_items[:2],
            "caveats": caveat_items,
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


# ---------------------------------------------------------------------------
# AI Price Summary endpoint
# ---------------------------------------------------------------------------
class PriceSummaryRequest(BaseModel):
    onPeakAvgDA: str = ""
    onPeakAvgRT: str = ""
    peakDA: str = ""
    peakRT: str = ""
    lowDA: str = ""
    lowRT: str = ""
    topDartZone: str = ""
    topDartAvg: str = ""
    topDartMax: str = ""
    dateRange: str = ""


@app.post("/api/ai-price-summary")
def ai_price_summary(body: PriceSummaryRequest):
    if not OPENAI_API_KEY:
        return {"summary": "", "status": "unconfigured"}

    stats_block = (
        f"On-Peak Avg DA LMP: ${body.onPeakAvgDA}/MWh\n"
        f"On-Peak Avg RT LMP: ${body.onPeakAvgRT}/MWh\n"
        f"Peak DA LMP: {body.peakDA}\n"
        f"Peak RT LMP: {body.peakRT}\n"
        f"Low DA LMP: {body.lowDA}\n"
        f"Low RT LMP: {body.lowRT}\n"
        f"Top DART Zone: {body.topDartZone} (avg ${body.topDartAvg}, max ${body.topDartMax})\n"
        f"Date Range: {body.dateRange}"
    )

    system_prompt = (
        "You are a senior NYISO electricity market analyst. Write a concise 3-5 sentence "
        "market commentary paragraph about current NYISO price conditions based on the stats below. "
        "Cover: DA vs RT price levels, strongest DART spread zone, notable peak/low hours, "
        "and intraday shape or volatility. Use specific numbers from the data. "
        "Do NOT use markdown formatting. No **, no #, no `. Write plain professional prose. "
        "Do NOT invent data not provided. Keep under 120 words."
    )

    try:
        import openai
        client = openai.OpenAI(api_key=OPENAI_API_KEY)
        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": stats_block},
            ],
            max_tokens=300,
            temperature=0.2,
        )
        raw = completion.choices[0].message.content or ""
        return {"summary": _strip_markdown(raw), "status": "ok"}
    except ImportError:
        return {"summary": "", "status": "error"}
    except Exception as exc:
        logger.error("AI price summary error: %s", exc)
        return {"summary": "", "status": "error"}


class GenerationSummaryRequest(BaseModel):
    onPeakAvgTotal: str = ""
    peakTotal: str = ""
    lowTotal: str = ""
    topFuel: str = ""
    topFuelShare: str = ""
    secondFuel: str = ""
    secondFuelShare: str = ""
    renewableShare: str = ""
    fuelTypesActive: str = ""
    dateRange: str = ""


@app.post("/api/ai-generation-summary")
def ai_generation_summary(body: GenerationSummaryRequest):
    if not OPENAI_API_KEY:
        return {"summary": "", "status": "unconfigured"}

    stats_block = (
        f"On-Peak Avg Total Generation: {body.onPeakAvgTotal}\n"
        f"Peak Total Generation: {body.peakTotal}\n"
        f"Low Total Generation: {body.lowTotal}\n"
        f"Top Fuel Source: {body.topFuel} ({body.topFuelShare})\n"
        f"Second Fuel Source: {body.secondFuel} ({body.secondFuelShare})\n"
        f"Renewable Share: {body.renewableShare}\n"
        f"Fuel Types Active: {body.fuelTypesActive}\n"
        f"Date Range: {body.dateRange}"
    )

    system_prompt = (
        "You are a senior NYISO electricity market analyst. Write a concise 3-5 sentence "
        "market commentary paragraph about current NYISO generation conditions based on the stats below. "
        "Cover: fuel mix dominance, generation peaks, renewable contribution, "
        "and mix diversity or concentration. Use specific numbers from the data. "
        "Do NOT use markdown formatting. No **, no #, no `. Write plain professional prose. "
        "Do NOT invent data not provided. Keep under 120 words."
    )

    try:
        import openai
        client = openai.OpenAI(api_key=OPENAI_API_KEY)
        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": stats_block},
            ],
            max_tokens=300,
            temperature=0.2,
        )
        raw = completion.choices[0].message.content or ""
        return {"summary": _strip_markdown(raw), "status": "ok"}
    except ImportError:
        return {"summary": "", "status": "error"}
    except Exception as exc:
        logger.error("AI generation summary error: %s", exc)
        return {"summary": "", "status": "error"}


class CongestionSummaryRequest(BaseModel):
    onPeakTotalCost: str = ""
    onPeakAvgCost: str = ""
    peakPositive: str = ""
    peakNegative: str = ""
    highestCostConstraint: str = ""
    avgCostTopConstraint: str = ""
    bindingCount: str = ""
    top3Share: str = ""
    dateRange: str = ""


@app.post("/api/ai-congestion-summary")
def ai_congestion_summary(body: CongestionSummaryRequest):
    if not OPENAI_API_KEY:
        return {"summary": "", "status": "unconfigured"}

    stats_block = (
        f"On-Peak Total Constraint Cost: {body.onPeakTotalCost}\n"
        f"On-Peak Avg Constraint Cost: {body.onPeakAvgCost}\n"
        f"Peak Positive Constraint Cost: {body.peakPositive}\n"
        f"Peak Negative Constraint Cost: {body.peakNegative}\n"
        f"Highest-Cost Binding Constraint: {body.highestCostConstraint}\n"
        f"Avg Cost of Top Constraint: {body.avgCostTopConstraint}\n"
        f"Binding Constraints Count: {body.bindingCount}\n"
        f"Top 3 Concentration: {body.top3Share}\n"
        f"Date Range: {body.dateRange}"
    )

    system_prompt = (
        "You are a senior NYISO electricity market analyst. Write a concise 3-5 sentence "
        "market commentary paragraph about current NYISO transmission congestion based on the stats below. "
        "Cover: total congestion costs, highest-cost binding constraint, concentration of costs, "
        "whether congestion was broad-based or concentrated, and notable constraint patterns. "
        "Use specific numbers from the data. "
        "Do NOT use markdown formatting. No **, no #, no `. Write plain professional prose. "
        "Do NOT invent data not provided. Keep under 120 words."
    )

    try:
        import openai
        client = openai.OpenAI(api_key=OPENAI_API_KEY)
        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"NYISO Congestion Statistics:\n{stats_block}"},
            ],
            max_tokens=300,
            temperature=0.2,
        )
        raw = completion.choices[0].message.content or ""
        return {"summary": _strip_markdown(raw), "status": "ok"}
    except ImportError:
        return {"summary": "", "status": "error"}
    except Exception as exc:
        logger.error("AI congestion summary error: %s", exc)
        return {"summary": "", "status": "error"}


class FlowSummaryRequest(BaseModel):
    onPeakAvgInternal: str = ""
    onPeakAvgExternal: str = ""
    peakPositive: str = ""
    peakNegative: str = ""
    mostActive: str = ""
    topInternal: str = ""
    topExternal: str = ""
    activeCount: str = ""
    dateRange: str = ""


@app.post("/api/ai-flow-summary")
def ai_flow_summary(body: FlowSummaryRequest):
    if not OPENAI_API_KEY:
        return {"summary": "", "status": "unconfigured"}

    stats_block = (
        f"On-Peak Avg Internal Flow: {body.onPeakAvgInternal}\n"
        f"On-Peak Avg External Flow: {body.onPeakAvgExternal}\n"
        f"Peak Positive Flow: {body.peakPositive}\n"
        f"Peak Negative Flow: {body.peakNegative}\n"
        f"Most Active Interface: {body.mostActive}\n"
        f"Top Internal Interface: {body.topInternal}\n"
        f"Top External Interface: {body.topExternal}\n"
        f"Active Interfaces: {body.activeCount}\n"
        f"Date Range: {body.dateRange}"
    )

    system_prompt = (
        "You are a senior NYISO electricity market analyst. Write a concise 3-5 sentence "
        "market commentary paragraph about current NYISO interface flow conditions based on the stats below. "
        "Cover: most active transfer paths, internal vs external flow pressure, "
        "peak flow magnitudes, import/export dynamics, and whether flows are concentrated or broad-based. "
        "Use specific numbers from the data. "
        "Do NOT use markdown formatting. No **, no #, no `. Write plain professional prose. "
        "Do NOT invent data not provided. Keep under 120 words."
    )

    try:
        import openai
        client = openai.OpenAI(api_key=OPENAI_API_KEY)
        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"NYISO Interface Flow Statistics:\n{stats_block}"},
            ],
            max_tokens=300,
            temperature=0.2,
        )
        raw = completion.choices[0].message.content or ""
        return {"summary": _strip_markdown(raw), "status": "ok"}
    except ImportError:
        return {"summary": "", "status": "error"}
    except Exception as exc:
        logger.error("AI flow summary error: %s", exc)
        return {"summary": "", "status": "error"}


class DemandSummaryRequest(BaseModel):
    onPeakAvgForecast: str = ""
    onPeakAvgActual: str = ""
    peakForecast: str = ""
    peakActual: str = ""
    lowForecast: str = ""
    lowActual: str = ""
    avgForecastError: str = ""
    peakForecastError: str = ""
    largestUnderForecast: str = ""
    largestOverForecast: str = ""
    dateRange: str = ""


@app.post("/api/ai-demand-summary")
def ai_demand_summary(body: DemandSummaryRequest):
    if not OPENAI_API_KEY:
        return {"summary": "", "status": "unconfigured"}

    stats_block = (
        f"On-Peak Avg Forecast Load: {body.onPeakAvgForecast}\n"
        f"On-Peak Avg Actual Load: {body.onPeakAvgActual}\n"
        f"Peak Forecast Load: {body.peakForecast}\n"
        f"Peak Actual Load: {body.peakActual}\n"
        f"Low Forecast Load: {body.lowForecast}\n"
        f"Low Actual Load: {body.lowActual}\n"
        f"Avg Forecast Error: {body.avgForecastError}\n"
        f"Peak Forecast Error: {body.peakForecastError}\n"
        f"Largest Under-Forecast: {body.largestUnderForecast}\n"
        f"Largest Over-Forecast: {body.largestOverForecast}\n"
        f"Date Range: {body.dateRange}"
    )

    system_prompt = (
        "You are a senior NYISO electricity market analyst. Write a concise 3-5 sentence "
        "market commentary paragraph about current NYISO demand conditions based on the stats below. "
        "Cover: forecast vs actual load levels, forecast accuracy/bias, peak timing, "
        "and any notable stress windows or surprises. Use specific numbers from the data. "
        "Do NOT use markdown formatting. No **, no #, no `. Write plain professional prose. "
        "Do NOT invent data not provided. Keep under 120 words."
    )

    try:
        import openai
        client = openai.OpenAI(api_key=OPENAI_API_KEY)
        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": stats_block},
            ],
            max_tokens=300,
            temperature=0.2,
        )
        raw = completion.choices[0].message.content or ""
        return {"summary": _strip_markdown(raw), "status": "ok"}
    except ImportError:
        return {"summary": "", "status": "error"}
    except Exception as exc:
        logger.error("AI demand summary error: %s", exc)
        return {"summary": "", "status": "error"}


# ---------------------------------------------------------------------------
# TTCF Derates endpoint
# ---------------------------------------------------------------------------
TTCF_PATH_MAP = {
    'SCH - PJ - NY': 'PJM AC',
    'SCH - PJM_HTP': 'PJM HTP',
    'SCH - PJM_VFT': 'PJM VFT',
    'SCH - PJM_NEPTUNE': 'PJM Neptune',
    'SCH - NE - NY': 'NE AC',
    'SCH - NPX_1385': '1385',
    'SCH - NPX_CSC': 'CSC',
    'SCH - OH - NY': 'IMO AC',
    'SCH - HQ - NY': 'HQ AC',
    'SCH - HQ_CEDARS': 'HQ Cedars',
    'CENTRAL EAST - VC': 'Central East',
    'MOSES SOUTH': 'Moses South',
    'SPR/DUN-SOUTH': 'Spr/Dun South',
    'UPNY CONED': 'UPNY-ConEd',
    'DYSINGER EAST': 'Dysinger East',
    'TOTAL EAST': 'Total East',
    'CONED - LIPA': 'ConEd-LIPA',
    'WEST CENTRAL': 'West Central',
}

TTCF_RENAME = {
    'RTSA FACILITY NAME': 'Cause Of Derate',
    'DATE_OUT': 'Date Out',
    'TIME_OU': 'Time Out',
    'DATE_IN': 'Date In',
    'TIME_IN': 'Time In',
    'EXPORT PATH NAME': 'Path Name',
    'FWD - Total Transfer Cap': 'Revised Import TTC',
    'FWD - TTC transfer impact': 'Import TTC Impact',
    'FWD - TTC ALL I/S': 'Base Import TTC',
    'REV - Total Transfer Cap': 'Revised Export TTC',
    'REV - TTC transfer impact': 'Export TTC Impact',
    'REV - TTC ALL I/S': 'Base Export TTC',
}

TTCF_DROP_COLS = {'ATI', 'CALLED_IN_', 'CANCELLATI', 'mod mess', 'CANCELLATI2', 'PTID', 'ARR'}


def _clean_time_to_hhmm(series: pd.Series) -> pd.Series:
    if series is None:
        return pd.Series(dtype="object")
    s = series.copy()
    s = s.replace([0, 0.0, "0", "0.0"], np.nan)
    s = s.astype("string").str.strip()
    s = s.replace({"": pd.NA, "nan": pd.NA, "NaT": pd.NA, "None": pd.NA})
    mask6 = s.str.fullmatch(r"\d{6}", na=False)
    s.loc[mask6] = s.loc[mask6].str.slice(0, 2) + ":" + s.loc[mask6].str.slice(2, 4)
    mask4 = s.str.fullmatch(r"\d{4}", na=False)
    s.loc[mask4] = s.loc[mask4].str.slice(0, 2) + ":" + s.loc[mask4].str.slice(2, 4)
    mask3 = s.str.fullmatch(r"\d{3}", na=False)
    s.loc[mask3] = "0" + s.loc[mask3].str.slice(0, 1) + ":" + s.loc[mask3].str.slice(1, 3)
    dt = pd.to_datetime(s, errors="coerce")
    return dt.dt.strftime("%H:%M")


@app.get("/api/ttcf-derates")
def ttcf_derates(
    date: Optional[str] = Query(default=None),
):
    import io
    import requests as req_lib
    from datetime import datetime as dt_cls, timedelta

    if date:
        target_date = date.replace("-", "")
    else:
        target_date = dt_cls.now().strftime("%Y%m%d")

    actual_date = target_date
    url = f"https://mis.nyiso.com/public/csv/ttcf/{target_date}ttcf.csv"
    try:
        resp = req_lib.get(url, timeout=30, verify=False)
        if resp.status_code == 404:
            yesterday = (dt_cls.strptime(target_date, "%Y%m%d") - timedelta(days=1)).strftime("%Y%m%d")
            url = f"https://mis.nyiso.com/public/csv/ttcf/{yesterday}ttcf.csv"
            resp = req_lib.get(url, timeout=30, verify=False)
            actual_date = yesterday
            if resp.status_code == 404:
                return {"status": "no_data", "message": "No TTCF data available", "derates": [], "date": date}
        resp.raise_for_status()
    except Exception as e:
        logger.error("TTCF fetch error: %s", e)
        return {"status": "error", "message": str(e), "derates": [], "date": date}

    try:
        df = pd.read_csv(io.StringIO(resp.text))
        df = df.fillna(0)
        df = df.drop(columns=[c for c in TTCF_DROP_COLS if c in df.columns], errors="ignore")
        df = df.rename(columns=TTCF_RENAME)

        if "Path Name" in df.columns:
            df["Path Name"] = df["Path Name"].replace(TTCF_PATH_MAP)

        if "Date Out" in df.columns:
            df["Date Out"] = pd.to_datetime(df["Date Out"], errors="coerce")
        if "Date In" in df.columns:
            df["Date In"] = pd.to_datetime(df["Date In"], errors="coerce")
        if "Time Out" in df.columns:
            df["Time Out"] = _clean_time_to_hhmm(df["Time Out"])
        if "Time In" in df.columns:
            df["Time In"] = _clean_time_to_hhmm(df["Time In"])

        for col in ["Import TTC Impact", "Export TTC Impact", "Revised Import TTC",
                     "Revised Export TTC", "Base Import TTC", "Base Export TTC"]:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

        has_impact = (df.get("Import TTC Impact", 0).abs() > 0) | (df.get("Export TTC Impact", 0).abs() > 0)
        derates = df[has_impact].copy() if has_impact.any() else df.head(0)

        if "Date Out" in derates.columns:
            derates["Date Out"] = derates["Date Out"].dt.strftime("%Y-%m-%d")
        if "Date In" in derates.columns:
            derates["Date In"] = derates["Date In"].dt.strftime("%Y-%m-%d")

        derates = derates.replace({np.nan: None, np.inf: None, -np.inf: None})
        records = derates.to_dict(orient="records")

        paths = sorted(df["Path Name"].dropna().unique().tolist()) if "Path Name" in df.columns else []

        fmt_actual = f"{actual_date[:4]}-{actual_date[4:6]}-{actual_date[6:8]}"
        return {
            "status": "ok",
            "date": fmt_actual,
            "requested_date": date or target_date,
            "derates": records,
            "total_entries": len(df),
            "derate_count": len(records),
            "paths": paths,
        }
    except Exception as e:
        logger.error("TTCF parse error: %s", e)
        return {"status": "error", "message": str(e), "derates": [], "date": date}


# ---------------------------------------------------------------------------
# OIC (Operating In Commitment) endpoint
# ---------------------------------------------------------------------------
@app.get("/api/oic")
def oic_data(
    date: Optional[str] = Query(default=None),
):
    import io
    import requests as req_lib
    from datetime import datetime as dt_cls

    if date:
        target_date = date.replace("-", "")
    else:
        target_date = dt_cls.now().strftime("%Y%m%d")

    url = f"https://mis.nyiso.com/public/csv/OpInCommit/{target_date}OpInCommit.csv"
    try:
        resp = req_lib.get(url, timeout=30, verify=False)
        if resp.status_code == 404:
            return {"status": "no_data", "message": "No OIC data available", "data": [], "date": date}
        resp.raise_for_status()
    except Exception as e:
        logger.error("OIC fetch error: %s", e)
        return {"status": "error", "message": str(e), "data": [], "date": date}

    try:
        df = pd.read_csv(io.StringIO(resp.text))
        if " PTID" in df.columns:
            df = df.drop(columns=[" PTID"])
        if "PTID" in df.columns and df.columns.tolist().count("PTID") > 1:
            df = df.loc[:, ~df.columns.duplicated()]

        df = df.replace({np.nan: None, np.inf: None, -np.inf: None})
        records = df.to_dict(orient="records")
        columns = df.columns.tolist()

        return {
            "status": "ok",
            "date": date or target_date,
            "data": records,
            "columns": columns,
            "row_count": len(records),
        }
    except Exception as e:
        logger.error("OIC parse error: %s", e)
        return {"status": "error", "message": str(e), "data": [], "date": date}


@app.get("/api/oic-range")
def oic_range_data(
    start_date: str = Query(...),
    end_date: str = Query(...),
):
    import io
    import requests as req_lib
    from datetime import datetime as dt_cls, timedelta

    try:
        sd = dt_cls.strptime(start_date, "%Y-%m-%d")
        ed = dt_cls.strptime(end_date, "%Y-%m-%d")
    except ValueError:
        return {"status": "error", "message": "Invalid date format. Use YYYY-MM-DD.", "data": []}

    if ed < sd:
        return {"status": "error", "message": "end_date must be >= start_date.", "data": []}

    max_days = 30
    if (ed - sd).days + 1 > max_days:
        return {"status": "error", "message": f"Date range limited to {max_days} days.", "data": []}

    all_frames = []
    current = sd
    while current <= ed:
        date_str = current.strftime("%Y%m%d")
        url = f"https://mis.nyiso.com/public/csv/OpInCommit/{date_str}OpInCommit.csv"
        try:
            resp = req_lib.get(url, timeout=30, verify=False)
            if resp.status_code == 200:
                df = pd.read_csv(io.StringIO(resp.text))
                if " PTID" in df.columns:
                    df = df.drop(columns=[" PTID"])
                if "PTID" in df.columns and df.columns.tolist().count("PTID") > 1:
                    df = df.loc[:, ~df.columns.duplicated()]
                df["_fetch_date"] = current.strftime("%Y-%m-%d")
                all_frames.append(df)
        except Exception as e:
            logger.warning("OIC range fetch error for %s: %s", date_str, e)
        current += timedelta(days=1)

    if not all_frames:
        return {"status": "no_data", "message": "No OIC data found for the selected range.", "data": []}

    combined = pd.concat(all_frames, ignore_index=True)
    combined = combined.replace({np.nan: None, np.inf: None, -np.inf: None})

    combined.columns = [c.strip() for c in combined.columns]

    zone_col = None
    for candidate in ["Load Zone of Resource", "Load Zone", "Zone"]:
        if candidate in combined.columns:
            zone_col = candidate
            break

    type_col = None
    for candidate in ["Commitment Type", "Type", "OIC Type"]:
        if candidate in combined.columns:
            type_col = candidate
            break

    mw_col = None
    for candidate in ["MW Committed/LSL(MWh)/POI WDL (MW)", "MW Committed", "Committed MW", "MW", "Capacity MW"]:
        if candidate in combined.columns:
            mw_col = candidate
            break

    by_zone = {}
    by_zone_type = {}
    mw_by_zone = {}
    all_types = set()

    if zone_col:
        zone_groups = combined.groupby(zone_col)
        for zone, grp in zone_groups:
            if zone is None:
                continue
            by_zone[str(zone)] = len(grp)
            if type_col:
                valid_types = grp[type_col].dropna().astype(str).str.strip()
                valid_types = valid_types[~valid_types.isin(["", "nan", "None", "none"])]
                type_counts = valid_types.value_counts().to_dict()
                by_zone_type[str(zone)] = {str(k): int(v) for k, v in type_counts.items()}
                all_types.update(type_counts.keys())
            if mw_col:
                numeric_vals = pd.to_numeric(grp[mw_col], errors="coerce")
                mw_by_zone[str(zone)] = round(float(numeric_vals.sum()), 2)

    records = combined.to_dict(orient="records")
    columns = [c for c in combined.columns.tolist() if c != "_fetch_date"]

    top_zone = max(by_zone, key=by_zone.get) if by_zone else None

    return {
        "status": "ok",
        "start_date": start_date,
        "end_date": end_date,
        "total_commitments": len(combined),
        "active_zones": len(by_zone),
        "top_zone": top_zone,
        "by_zone": by_zone,
        "by_zone_type": by_zone_type,
        "all_types": sorted(str(t) for t in all_types if t is not None),
        "mw_by_zone": mw_by_zone,
        "has_mw": mw_col is not None,
        "data": records,
        "columns": columns,
        "row_count": len(records),
    }


# ---------------------------------------------------------------------------
# Congestion Stacked Bar endpoint
# ---------------------------------------------------------------------------
@app.get("/api/congestion-stacked")
def congestion_stacked(
    market: str = Query(default="DA", pattern="^(DA|RT)$"),
    date: Optional[str] = Query(default=None),
):
    constr_key = "dam_limiting_constraints" if market == "DA" else "rt_limiting_constraints"
    constr_meta = DATASET_META.get(constr_key)
    if not constr_meta:
        raise HTTPException(status_code=404, detail=f"Dataset {constr_key} not configured")

    constr = _load_csv_safe(constr_meta["file"])
    if constr.empty:
        return {"status": "empty", "stacked_data": [], "constraint_names": []}

    if "Date" in constr.columns and hasattr(constr["Date"].iloc[0], "strftime"):
        constr["Date"] = constr["Date"].dt.strftime("%Y-%m-%d")

    available_dates = sorted(constr["Date"].dropna().unique().tolist())

    if date:
        constr = constr[constr["Date"] == date]
    elif available_dates:
        constr = constr[constr["Date"] == available_dates[-1]]

    if constr.empty:
        return {"status": "empty", "stacked_data": [], "constraint_names": [], "available_dates": available_dates}

    cost_col = "Constraint Cost" if "Constraint Cost" in constr.columns else "ShadowPrice"
    name_col = "Limiting Facility" if "Limiting Facility" in constr.columns else "Constraint"
    cont_col = "Contingency" if "Contingency" in constr.columns else None

    if cont_col and cont_col in constr.columns:
        constr["_label"] = constr[name_col].astype(str) + " | " + constr[cont_col].astype(str)
    else:
        constr["_label"] = constr[name_col].astype(str)

    pivot = constr.pivot_table(
        index="_label", columns="HE", values=cost_col, aggfunc="sum", fill_value=0
    ).round(2)

    he_cols = sorted(pivot.columns.tolist(), key=lambda x: int(x))
    constraint_names = pivot.index.tolist()

    stacked_data = []
    for he in he_cols:
        row: dict = {"HE": int(he)}
        for name in constraint_names:
            row[name] = float(pivot.loc[name, he])
        stacked_data.append(row)

    return {
        "status": "ok",
        "market": market,
        "date": date or (available_dates[-1] if available_dates else None),
        "stacked_data": stacked_data,
        "constraint_names": constraint_names,
        "available_dates": available_dates,
    }


import requests as _requests
import io as _io
from datetime import datetime as _datetime, timedelta as _timedelta

@app.get("/api/daily-events")
def get_daily_events(date: Optional[str] = None):
    if not date:
        date = _datetime.now().strftime("%Y-%m-%d")
    try:
        _datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Date must be YYYY-MM-DD")

    date_compact = date.replace("-", "")
    rt_url = f"https://mis.nyiso.com/public/csv/RealTimeEvents/{date_compact}RealTimeEvents.csv"
    oper_url = f"https://mis.nyiso.com/public/csv/OperMessages/{date_compact}OperMessages.csv"

    def fetch_rt(url: str):
        try:
            resp = _requests.get(url, timeout=20, verify=False)
            resp.raise_for_status()
            text = resp.text.strip()
            if not text:
                return [], ""
            df = pd.read_csv(_io.StringIO(text))
            df.columns = [c.strip() for c in df.columns]
            rows = []
            for _, r in df.iterrows():
                ts = str(r.get("Timestamp", "")).strip()
                msg = str(r.get("Message", "")).strip().strip('"')
                if ts and msg:
                    rows.append({"timestamp": ts, "message": msg})
            return rows, text
        except Exception:
            return [], ""

    def fetch_oper(url: str):
        try:
            resp = _requests.get(url, timeout=20, verify=False)
            resp.raise_for_status()
            raw_text = resp.text.strip()
            if not raw_text:
                return [], ""
            lines = raw_text.split("\n")
            header = lines[0] if lines else ""
            rows = []
            current_insert = ""
            current_msg_parts = []
            for line in lines[1:]:
                line = line.strip()
                if not line:
                    continue
                if line.startswith('"') and '","' in line:
                    if current_insert and current_msg_parts:
                        rows.append({
                            "insert_time": current_insert.strip('"'),
                            "message": " ".join(current_msg_parts).strip().strip('"'),
                        })
                    idx = line.index('","')
                    current_insert = line[:idx].strip('"')
                    current_msg_parts = [line[idx+3:]]
                else:
                    current_msg_parts.append(line)
            if current_insert and current_msg_parts:
                rows.append({
                    "insert_time": current_insert.strip('"'),
                    "message": " ".join(current_msg_parts).strip().strip('"'),
                })
            return rows, raw_text
        except Exception:
            return [], ""

    rt_rows, rt_raw = fetch_rt(rt_url)
    oper_rows, oper_raw = fetch_oper(oper_url)

    available_dates = []
    today = _datetime.now().date()
    for i in range(8):
        d = today - _timedelta(days=i)
        available_dates.append(d.strftime("%Y-%m-%d"))

    return {
        "date": date,
        "available_dates": available_dates,
        "rt_events": rt_rows,
        "rt_events_raw": rt_raw,
        "oper_messages": oper_rows,
        "oper_messages_raw": oper_raw,
    }


@app.post("/api/iq/scrape")
def scrape_interconnection_queue():
    try:
        from etl.interconnection_queue import run as iq_run
        success = iq_run()
        from src.api_data_loader import _df_cache
        for key in list(_df_cache.keys()):
            if "iq_" in key or "interconnection" in key:
                del _df_cache[key]
        return {
            "status": "ok" if success else "error",
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

