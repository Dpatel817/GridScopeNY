"""
Server-side AI context builder — extracted from api.py _build_server_side_context().
Aggregates key metrics from all datasets for the AI analyst endpoint.
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger("app.context")


def build_server_side_context(get_dataset_json_fn) -> dict[str, Any]:
    """
    Build a comprehensive data summary from all available datasets.
    get_dataset_json_fn: callable matching get_dataset_json signature.
    """
    ctx: dict[str, Any] = {}
    zone_avgs: list[tuple[str, float]] = []
    by_zone: dict[str, list[float]] = {}
    nyiso_vals: list[float] = []

    try:
        da_zone = get_dataset_json_fn("da_lbmp_zone", resolution="daily", limit=500)
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
            zone_avgs = sorted([(z, sum(vs) / len(vs)) for z, vs in by_zone.items()], key=lambda x: -x[1])
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
        rt_zone = get_dataset_json_fn("rt_lbmp_zone", resolution="daily", limit=500)
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
        isolf = get_dataset_json_fn("isolf", resolution="daily", limit=500)
        if isolf.get("data"):
            nyiso_vals = [float(r.get("NYISO", 0)) for r in isolf["data"] if r.get("NYISO")]
            if nyiso_vals:
                ctx["peak_forecast_load"] = f"{max(nyiso_vals):,.0f} MW"
                ctx["avg_forecast_load"] = f"{sum(nyiso_vals)/len(nyiso_vals):,.0f} MW"
    except Exception as exc:
        logger.warning("Server context - forecast load error: %s", exc)

    try:
        pal = get_dataset_json_fn("pal", resolution="daily", limit=500)
        if pal.get("data"):
            actuals = [float(r.get("NYISO", 0) or r.get("Actual Load", 0)) for r in pal["data"]]
            actuals = [a for a in actuals if a]
            if actuals:
                ctx["peak_actual_load"] = f"{max(actuals):,.0f} MW"
                if nyiso_vals:
                    avg_f = sum(nyiso_vals) / len(nyiso_vals)
                    avg_a = sum(actuals) / len(actuals)
                    err = (avg_f - avg_a) / avg_a * 100
                    ctx["forecast_error"] = f"{'+' if err > 0 else ''}{err:.1f}% ({'over' if err > 0 else 'under'}-forecast)"
    except Exception as exc:
        logger.warning("Server context - actual load error: %s", exc)

    try:
        gen = get_dataset_json_fn("rtfuelmix", resolution="daily", limit=500)
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
        cong = get_dataset_json_fn("dam_limiting_constraints", resolution="daily", limit=500)
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
            asp = get_dataset_json_fn(ds_name, resolution="daily", limit=500)
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
                parts = [f"{p}: avg ${s['sum']/s['cnt']:.2f}, max ${s['max']:.2f}" for p, s in stats.items() if s["cnt"] > 0]
                if parts:
                    ctx[key] = "; ".join(parts)
        except Exception as exc:
            logger.warning("Server context - ancillary %s error: %s", ds_name, exc)

    try:
        flows = get_dataset_json_fn("external_limits_flows", resolution="daily", limit=500)
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
