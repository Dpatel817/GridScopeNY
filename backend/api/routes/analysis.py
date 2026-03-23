"""Analysis routes: constraint impact, generator map, congestion stacked bar"""
from __future__ import annotations

from typing import Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from app.datasets import DATASET_META
from app.config import PROCESSED_DIR
from etl.load.cache import load_file

router = APIRouter()


def _load(filename: str) -> pd.DataFrame:
    return load_file(filename, PROCESSED_DIR)


def _find_clean_prints(constr_df: pd.DataFrame, facility: str, contingency: str):
    if constr_df.empty or not facility or not contingency:
        return [], []
    COST_THRESHOLD = 1.0
    grouped = constr_df.groupby(["Date", "HE"]).apply(
        lambda g: g[g["Constraint Cost"].abs() >= COST_THRESHOLD][["Limiting Facility", "Contingency"]].drop_duplicates().shape[0],
        include_groups=False,
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


def _build_congestion_pivot(constr_df: pd.DataFrame, facility=None, contingency=None):
    if constr_df.empty:
        return []
    work = constr_df.copy()
    if facility:
        work = work[work["Limiting Facility"] == facility]
    if contingency:
        work = work[work["Contingency"] == contingency]
    if work.empty:
        return []
    pivot = work.pivot_table(index="Date", columns="HE", values="Constraint Cost", aggfunc="sum", fill_value=0).round(2)
    pivot = pivot.reset_index()
    pivot.columns = [str(c) for c in pivot.columns]
    return pivot.to_dict(orient="records")


@router.get("/api/constraint-impact")
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

    constr_meta = DATASET_META.get(constr_key)
    if not constr_meta:
        raise HTTPException(status_code=404, detail=f"Constraint dataset {constr_key} not configured")

    constr = _load(constr_meta["file"])
    if constr.empty:
        return {"status": "empty", "message": "No constraint data available"}

    if "Date" in constr.columns and hasattr(constr["Date"].iloc[0], "strftime"):
        constr["Date"] = constr["Date"].dt.strftime("%Y-%m-%d")

    all_facilities = sorted(constr["Limiting Facility"].dropna().unique().tolist())
    filtered_facilities = [f for f in all_facilities if search.lower() in f.lower()] if search else all_facilities

    fac_subset = constr[constr["Limiting Facility"] == facility] if facility else constr.copy()
    contingencies = sorted(fac_subset["Contingency"].dropna().unique().tolist()) if facility else []

    fc_subset = fac_subset[fac_subset["Contingency"] == contingency] if contingency else fac_subset.copy()
    available_dates = sorted(fc_subset["Date"].dropna().unique().tolist()) if (facility and contingency) else sorted(constr["Date"].dropna().unique().tolist())

    if facility and contingency and not date and available_dates:
        date = available_dates[-1]

    available_hes = []
    if facility and contingency and date:
        day_fc = fc_subset[fc_subset["Date"] == date]
        available_hes = sorted(day_fc["HE"].dropna().unique().astype(int).tolist()) if "HE" in day_fc.columns else []

    if not (facility and contingency and date):
        return {
            "market": market, "date": date, "he": he, "facility": facility, "contingency": contingency,
            "clean_only": clean_only, "constraint_summary": None, "zonal_impact": [], "generator_impact": [],
            "clean_prints": [], "mixed_prints": [], "congestion_pivot": [],
            "available_dates": available_dates, "available_hes": available_hes,
            "facilities": filtered_facilities, "contingencies": contingencies, "status": "pending",
        }

    date_filtered = constr[constr["Date"] == date].copy()
    clean_prints, mixed_prints = _find_clean_prints(date_filtered, facility, contingency)
    clean_hes = [p["he"] for p in clean_prints]
    selected = fc_subset[fc_subset["Date"] == date].copy()

    if he is not None and "HE" in selected.columns:
        selected = selected[selected["HE"] == he]
    elif clean_only and facility and contingency:
        selected = selected[selected["HE"].isin(clean_hes)] if clean_hes else selected.iloc[0:0]

    pivot_data = _build_congestion_pivot(date_filtered, facility, contingency)

    empty_response = {
        "market": market, "date": date, "he": he, "facility": facility, "contingency": contingency,
        "clean_only": clean_only, "constraint_summary": None, "zonal_impact": [], "generator_impact": [],
        "clean_prints": clean_prints, "mixed_prints": mixed_prints, "congestion_pivot": pivot_data,
        "available_dates": available_dates, "available_hes": available_hes,
        "facilities": filtered_facilities, "contingencies": contingencies, "status": "no_data",
    }

    if selected.empty:
        return empty_response

    costs = selected["Constraint Cost"].dropna().tolist()
    is_clean = he in clean_hes if he is not None and facility and contingency else False

    constraint_summary = {
        "facility": facility or "All", "contingency": contingency or "All",
        "date": date, "he": he,
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
    zone_meta = DATASET_META.get(zone_key)
    if zone_meta:
        zone_df = _load(zone_meta["file"])
        if not zone_df.empty:
            if "Date" in zone_df.columns and hasattr(zone_df["Date"].iloc[0], "strftime"):
                zone_df["Date"] = zone_df["Date"].dt.strftime("%Y-%m-%d")
            zone_match = zone_df.merge(date_hes, on=["Date", "HE"], how="inner")
            if len(zone_match) > 0:
                zone_match = zone_match.groupby("Zone")[["LMP", "MLC", "MCC"]].mean().reset_index()
                sys_avg_lmp = zone_match["LMP"].mean()
                zone_match["delta_vs_system"] = (zone_match["LMP"] - sys_avg_lmp).round(2)
                zone_match["mcc_abs"] = zone_match["MCC"].abs()
                zone_match = zone_match.sort_values("mcc_abs", ascending=False)
                zone_match["interpretation"] = zone_match["MCC"].apply(
                    lambda mcc: "Neutral" if abs(mcc) < 0.5 else ("Bearish (paying congestion)" if mcc > 0 else "Bullish (receiving congestion credit)")
                )
                zone_match = zone_match.replace({np.nan: None, np.inf: None, -np.inf: None})
                zonal_impact = zone_match[["Zone", "LMP", "MLC", "MCC", "delta_vs_system", "interpretation"]].round(2).to_dict(orient="records")

    generator_impact = []
    gen_meta = DATASET_META.get(gen_key)
    gen_names_meta = DATASET_META.get("generator_names")
    if gen_meta and gen_names_meta:
        gen_df = _load(gen_meta["file"])
        gn_df = _load(gen_names_meta["file"])
        if not gen_df.empty:
            if "Date" in gen_df.columns and hasattr(gen_df["Date"].iloc[0], "strftime"):
                gen_df["Date"] = gen_df["Date"].dt.strftime("%Y-%m-%d")
            gen_match = gen_df.merge(date_hes, on=["Date", "HE"], how="inner")
            if len(gen_match) > 0:
                gen_lookup = gen_match.drop_duplicates("PTID")[["PTID", "Generator"]]
                gen_agg = gen_match.groupby("PTID")[["LMP", "MLC", "MCC"]].mean().reset_index()
                gen_agg = gen_agg.merge(gen_lookup, on="PTID", how="left")
                if not gn_df.empty:
                    gen_agg = gen_agg.merge(gn_df[["PTID", "Zone"]].drop_duplicates("PTID"), on="PTID", how="left")
                gen_agg["mcc_abs"] = gen_agg["MCC"].abs()
                gen_agg = gen_agg.sort_values("mcc_abs", ascending=False)
                gen_agg = gen_agg.replace({np.nan: None, np.inf: None, -np.inf: None})
                top_gens = gen_agg.head(25)
                generator_impact = top_gens[[c for c in ["Generator", "PTID", "Zone", "LMP", "MLC", "MCC"] if c in top_gens.columns]].round(2).to_dict(orient="records")

    return {
        "market": market, "date": date, "he": he, "facility": facility, "contingency": contingency,
        "clean_only": clean_only, "constraint_summary": constraint_summary,
        "zonal_impact": zonal_impact, "generator_impact": generator_impact,
        "clean_prints": clean_prints, "mixed_prints": mixed_prints, "congestion_pivot": pivot_data,
        "available_dates": available_dates, "available_hes": available_hes,
        "facilities": filtered_facilities, "contingencies": contingencies, "status": "ok",
    }


@router.get("/api/generator-map")
def generator_map(
    market: str = Query(default="DA", pattern="^(DA|RT)$"),
    date: Optional[str] = Query(default=None),
    he: Optional[int] = Query(default=None, ge=0, le=23),
):
    gen_meta = DATASET_META.get("generator_names")
    lmp_key = "da_lbmp_gen" if market == "DA" else "rt_lbmp_gen"
    lmp_meta = DATASET_META.get(lmp_key)

    if not gen_meta or not lmp_meta:
        raise HTTPException(status_code=404, detail="Generator datasets not configured")

    gn = _load(gen_meta["file"])
    lmp = _load(lmp_meta["file"])

    if gn.empty or lmp.empty:
        raise HTTPException(status_code=404, detail="Generator data files not found or empty")

    if "Date" in lmp.columns and hasattr(lmp["Date"].iloc[0], "strftime"):
        lmp["Date"] = lmp["Date"].dt.strftime("%Y-%m-%d")

    available_dates = sorted(lmp["Date"].dropna().unique().tolist()) if "Date" in lmp.columns else []
    available_hes = sorted(lmp["HE"].dropna().unique().astype(int).tolist()) if "HE" in lmp.columns else []
    debug_lmp_rows_loaded = len(lmp)

    selected_date = date or (available_dates[-1] if available_dates else None)
    if selected_date:
        lmp = lmp[lmp["Date"] == selected_date]
    debug_lmp_rows_after_date = len(lmp)

    if he is not None and "HE" in lmp.columns:
        lmp = lmp[lmp["HE"] == he]
    debug_lmp_rows_after_he = len(lmp)

    agg_cols = [c for c in ["LMP", "MLC", "MCC"] if c in lmp.columns]
    if agg_cols:
        gen_lookup = lmp.drop_duplicates("PTID")[["PTID", "Generator"]] if "Generator" in lmp.columns else None
        lmp = lmp.groupby("PTID")[agg_cols].mean().reset_index()
        if gen_lookup is not None:
            lmp = lmp.merge(gen_lookup, on="PTID", how="left")

    gn_coords = gn[gn["Latitude"].notna() & gn["Longitude"].notna()].copy()
    gn_coords = gn_coords[["PTID", "Generator", "Zone", "Subzone", "Latitude", "Longitude"]].rename(columns={"Generator": "GenName"})

    if "Generator" in lmp.columns:
        lmp = lmp.rename(columns={"Generator": "GenName_lmp"})

    merged = lmp.merge(gn_coords, on="PTID", how="inner")
    total_lmp_ptids = int(lmp["PTID"].nunique())
    total_gen_ptids = int(gn["PTID"].nunique())
    mapped_ptids = int(merged["PTID"].nunique())

    out_cols = ["PTID", "GenName", "Zone", "Subzone", "Latitude", "Longitude", "LMP", "MLC", "MCC"]
    for c in out_cols:
        if c not in merged.columns:
            merged[c] = None
    merged = merged.replace({np.nan: None, np.inf: None, -np.inf: None})

    return {
        "market": market, "date": selected_date, "he": he, "he_averaged": he is None,
        "points": merged[out_cols].to_dict(orient="records"),
        "audit": {
            "total_generators_in_metadata": total_gen_ptids,
            "total_generators_in_lmp": total_lmp_ptids,
            "mapped_with_coords": mapped_ptids,
            "unmapped_no_coords": total_lmp_ptids - mapped_ptids,
            "generators_missing_coords": int(gn[gn["Latitude"].isna() | gn["Longitude"].isna()].shape[0]),
        },
        "available_dates": available_dates,
        "available_hes": available_hes,
        "zones": sorted(gn_coords["Zone"].dropna().unique().tolist()),
        "debug": {
            "lmp_file": lmp_meta["file"],
            "lmp_rows_loaded": debug_lmp_rows_loaded,
            "lmp_rows_after_date_filter": debug_lmp_rows_after_date,
            "lmp_rows_after_he_filter": debug_lmp_rows_after_he,
            "lmp_ptids_after_agg": total_lmp_ptids,
            "merged_rows": len(merged),
            "selected_date": selected_date,
            "date_range": f"{available_dates[0]} to {available_dates[-1]}" if available_dates else "none",
        },
    }


@router.get("/api/congestion-stacked")
def congestion_stacked(
    market: str = Query(default="DA", pattern="^(DA|RT)$"),
    date: Optional[str] = Query(default=None),
):
    constr_key = "dam_limiting_constraints" if market == "DA" else "rt_limiting_constraints"
    constr_meta = DATASET_META.get(constr_key)
    if not constr_meta:
        raise HTTPException(status_code=404, detail=f"Dataset {constr_key} not configured")

    constr = _load(constr_meta["file"])
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

    constr["_label"] = (constr[name_col].astype(str) + " | " + constr[cont_col].astype(str)) if (cont_col and cont_col in constr.columns) else constr[name_col].astype(str)

    pivot = constr.pivot_table(index="_label", columns="HE", values=cost_col, aggfunc="sum", fill_value=0).round(2)
    he_cols = sorted(pivot.columns.tolist(), key=lambda x: int(x))
    constraint_names = pivot.index.tolist()

    stacked_data = [{"HE": int(he), **{name: float(pivot.loc[name, he]) for name in constraint_names}} for he in he_cols]

    return {
        "status": "ok", "market": market,
        "date": date or (available_dates[-1] if available_dates else None),
        "stacked_data": stacked_data, "constraint_names": constraint_names,
        "available_dates": available_dates,
    }
