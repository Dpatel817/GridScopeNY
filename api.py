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

    available_dates = sorted(constr["Date"].dropna().unique().tolist())
    available_hes = sorted(constr["HE"].dropna().unique().astype(int).tolist()) if "HE" in constr.columns else []

    if not date and available_dates:
        date = available_dates[-1]

    date_filtered = constr[constr["Date"] == date].copy() if date else constr.copy()

    facilities = sorted(date_filtered["Limiting Facility"].dropna().unique().tolist())

    fac_filtered = date_filtered.copy()
    if facility:
        fac_filtered = fac_filtered[fac_filtered["Limiting Facility"] == facility]

    contingencies = sorted(fac_filtered["Contingency"].dropna().unique().tolist())

    clean_prints, mixed_prints = _find_clean_prints(date_filtered, facility, contingency)
    clean_hes = [p["he"] for p in clean_prints]

    selected = fac_filtered.copy()
    if contingency:
        selected = selected[selected["Contingency"] == contingency]

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
        "facilities": facilities, "contingencies": contingencies,
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
        "facilities": facilities,
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
    }
    for k, v in ctx.items():
        if v is not None and v != "" and v != [] and k not in ("resolution", "current_page"):
            label = label_map.get(k, k.replace("_", " ").title())
            context_lines.append(f"  {label}: {v}")
    context_block = ""
    if context_lines:
        context_block = "DASHBOARD STATE (use these numbers directly):\n" + "\n".join(context_lines)

    system_prompt = (
        "You are a senior NYISO electricity market analyst writing for energy traders, battery strategists, "
        "and portfolio managers using the GridScopeNY dashboard.\n\n"
        "SCOPE: NYISO Zones A through K only. Zone A=WEST, B=GENESE, C=CENTRL, D=NORTH, E=MHK VL, "
        "F=CAPITL, G=HUD VL, H=MILLWD, I=DUNWOD, J=N.Y.C., K=LONGIL. "
        "Do NOT analyze H Q, NPX, O H, or PJM - these are external settlement nodes, not NYISO zones.\n\n"
        "STRICT RULES:\n"
        "- Use the dashboard data provided. Reference actual numbers, zones, and values.\n"
        "- Do NOT use markdown formatting. No **, no #, no `, no bullet symbols.\n"
        "- Write in plain professional prose. No filler, no hedging, no generic disclaimers.\n"
        "- If data is insufficient, state exactly what is missing in one sentence.\n"
        "- Do NOT invent prices, outages, or events not in the context.\n"
        "- Do NOT say 'typically' or 'generally' when specific data is available.\n\n"
        "RESPONSE FORMAT (follow exactly):\n\n"
        "SUMMARY:\n"
        "2-4 sentence direct answer using specific data points from the dashboard.\n\n"
        "TRADER TAKEAWAYS:\n"
        "- 2-4 concise bullets focused on spread behavior, dislocations, congestion sensitivity, "
        "verification risk, arbitrage conditions\n\n"
        "BATTERY STRATEGIST TAKEAWAYS:\n"
        "- 2-4 concise bullets focused on duration fit, persistence, structural vs event-driven value, "
        "storage-relevant conditions\n\n"
        "KEY SIGNALS:\n"
        "- 2-4 short bullets citing actual dashboard metrics (spreads, constraints, load, flows, events)\n\n"
        "CAVEAT:\n"
        "- One short caveat only if genuinely needed. Omit this section if no caveat is needed.\n\n"
        "Keep the total response under 300 words. Be direct. Sound like an analyst, not a chatbot."
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
            max_tokens=900,
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


import threading
_refresh_lock = threading.Lock()

@app.post("/api/refresh")
def refresh_data():
    if not _refresh_lock.acquire(blocking=False):
        return {"status": "already_running", "message": "A refresh is already in progress"}
    try:
        from src.api_data_loader import _df_cache
        _df_cache.clear()
        fetch_result = subprocess.run(
            [sys.executable, "ETL/fetch_nyiso_data.py"],
            capture_output=True, text=True, timeout=300,
        )
        process_result = subprocess.run(
            [sys.executable, "ETL/process_nyiso_data.py"],
            capture_output=True, text=True, timeout=300,
        )
        _df_cache.clear()
        return {
            "status": "ok" if fetch_result.returncode == 0 and process_result.returncode == 0 else "partial",
            "fetch": "ok" if fetch_result.returncode == 0 else "error",
            "process": "ok" if process_result.returncode == 0 else "error",
        }
    except subprocess.TimeoutExpired:
        return {"status": "timeout", "message": "Refresh timed out after 5 minutes"}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        _refresh_lock.release()


@app.post("/api/cache/clear")
def clear_cache():
    from src.api_data_loader import _df_cache
    count = len(_df_cache)
    _df_cache.clear()
    return {"status": "ok", "cleared": count}


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
