"""AI analyst routes: explainer, price/generation/congestion/flow/demand summaries"""
from __future__ import annotations

import logging
import re
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import OPENAI_API_KEY
from app.context import build_server_side_context
from app.loader import get_dataset_json

router = APIRouter()
logger = logging.getLogger("api.routes.ai")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _strip_markdown(text: str) -> str:
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
    items = []
    for line in text.strip().split("\n"):
        cleaned = line.strip().lstrip("•-–*1234567890.) ").strip()
        if cleaned and len(cleaned) > 3:
            items.append(_strip_markdown(cleaned))
    return items


def _call_openai(system_prompt: str, user_content: str, max_tokens: int = 300) -> str:
    import openai
    client = openai.OpenAI(api_key=OPENAI_API_KEY)
    completion = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": user_content}],
        max_tokens=max_tokens,
        temperature=0.2,
    )
    return completion.choices[0].message.content or ""


# ---------------------------------------------------------------------------
# AI Explainer
# ---------------------------------------------------------------------------
class AIExplainRequest(BaseModel):
    question: str
    context: Optional[dict[str, Any]] = None
    search_all_datasets: Optional[bool] = False


_LABEL_MAP = {
    "avg_da_lmp": "Avg DA LMP (Zones A-K)", "max_da_lmp": "Peak DA LMP", "min_da_lmp": "Min DA LMP",
    "avg_rt_lmp": "Avg RT LMP (Zones A-K)", "highest_price_zone": "Highest-priced zone",
    "lowest_price_zone": "Lowest-priced zone", "zone_price_ranking": "Zone price ranking",
    "da_rt_spread": "DA-RT spread", "peak_forecast_load": "Peak forecast load",
    "avg_forecast_load": "Avg forecast load", "top_constraints": "Top constraints",
    "generation_mix": "Generation mix", "top_spread_zones": "Top DA-RT spread zones",
    "forecast_error": "Forecast error", "total_generation": "Total generation",
    "renewable_share": "Renewable share", "total_congestion_cost": "Total congestion cost",
    "da_ancillary_prices": "DA ancillary prices", "rt_ancillary_prices": "RT ancillary prices",
    "interface_flows": "Interface flows", "constrained_interfaces": "Constrained interfaces",
    "peak_actual_load": "Peak actual load", "da_date_range": "DA data range",
}

_SECTION_HEADERS = [
    r'SUMMARY\s*:', r'TRADER\s+TAKEAWAYS?\s*:', r'BATTERY\s+STRATEGIST\s+TAKEAWAYS?\s*:',
    r'KEY\s+(?:SUPPORTING\s+)?SIGNALS?\s*:', r'CAVEATS?\s*:', r'DRIVERS?\s*:',
]

_SYSTEM_PROMPT_EXPLAINER = (
    "You are a senior NYISO electricity market analyst and strategist at a top-tier energy trading desk. "
    "You have deep expertise in power market fundamentals, congestion pricing, ancillary service markets, "
    "battery storage economics, and NYISO market structure.\n\n"
    "SCOPE: NYISO Zones A through K only. Zone A=WEST, B=GENESE, C=CENTRL, D=NORTH, E=MHK VL, "
    "F=CAPITL, G=HUD VL, H=MILLWD, I=DUNWOD, J=N.Y.C., K=LONGIL. "
    "Do NOT analyze H Q, NPX, O H, or PJM.\n\n"
    "STRICT RULES:\n"
    "- Use the dashboard data provided. Reference actual numbers, zones, and values.\n"
    "- Do NOT use markdown formatting. No **, no #, no `, no bullet symbols.\n"
    "- Write in plain professional prose. No filler, no hedging.\n"
    "- If data is insufficient, state exactly what is missing in one sentence.\n\n"
    "RESPONSE FORMAT:\n\n"
    "SUMMARY:\n2-4 sentence direct answer with specific data.\n\n"
    "TRADER TAKEAWAYS:\n- 2-4 concise bullets\n\n"
    "BATTERY STRATEGIST TAKEAWAYS:\n- 2-4 concise bullets\n\n"
    "KEY SIGNALS:\n- 2-4 short bullets citing actual metrics\n\n"
    "CAVEAT:\n- One short caveat only if genuinely needed.\n\n"
    "Keep the total response under 350 words."
)


@router.post("/api/ai-explainer")
def ai_explainer(body: AIExplainRequest):
    question = body.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="question is required")
    if not OPENAI_API_KEY:
        return {"answer": "AI Analyst is not configured. Set the OPENAI_API_KEY environment variable.", "status": "unconfigured"}

    ctx = dict(body.context or {})
    if body.search_all_datasets:
        server_ctx = build_server_side_context(get_dataset_json)
        for k, v in server_ctx.items():
            if k not in ctx or not ctx[k]:
                ctx[k] = v

    context_lines = [
        f"  {_LABEL_MAP.get(k, k.replace('_', ' ').title())}: {v}"
        for k, v in ctx.items()
        if v is not None and v != "" and v != [] and k not in ("resolution", "current_page")
    ]
    context_block = ("DASHBOARD STATE (use these numbers directly):\n" + "\n".join(context_lines)) if context_lines else ""
    user_content = f"{context_block}\n\nQuestion: {question}" if context_block else question

    try:
        raw = _call_openai(_SYSTEM_PROMPT_EXPLAINER, user_content, max_tokens=1200)
        answer = _strip_markdown(raw)

        def _extract_section(text, start_pat, end_pats):
            m = re.search(start_pat, text, re.IGNORECASE)
            if not m:
                return []
            rest = text[m.end():]
            end_pos = len(rest)
            for ep in end_pats:
                em = re.search(ep, rest, re.IGNORECASE)
                if em and em.start() < end_pos:
                    end_pos = em.start()
            return _parse_bullet_lines(rest[:end_pos])

        def _extract_summary(text):
            m = re.search(r'(?i)SUMMARY\s*:', text)
            if m:
                rest = text[m.end():]
                end_pos = len(rest)
                for ep in _SECTION_HEADERS:
                    if 'SUMMARY' in ep:
                        continue
                    em = re.search(ep, rest, re.IGNORECASE)
                    if em and em.start() < end_pos:
                        end_pos = em.start()
                return rest[:end_pos].strip()
            return re.split(r'(?i)(?:TRADER|BATTERY|KEY|DRIVER|CAVEAT)', text, maxsplit=1)[0].strip()

        summary_text = re.sub(r'^(?:SUMMARY|Summary)\s*:?\s*', '', _extract_summary(answer)).strip()
        trader_items = _extract_section(answer, r'TRADER\s+TAKEAWAYS?\s*:', [p for p in _SECTION_HEADERS if 'TRADER' not in p])
        battery_items = _extract_section(answer, r'BATTERY\s+STRATEGIST\s+TAKEAWAYS?\s*:', [p for p in _SECTION_HEADERS if 'BATTERY' not in p])
        signal_items = _extract_section(answer, r'KEY\s+(?:SUPPORTING\s+)?SIGNALS?\s*:', [p for p in _SECTION_HEADERS if 'KEY' not in p and 'SIGNAL' not in p])
        if not signal_items:
            signal_items = _extract_section(answer, r'DRIVERS?\s*:', [p for p in _SECTION_HEADERS if 'DRIVER' not in p])
        caveat_items = _extract_section(answer, r'CAVEATS?\s*:', [p for p in _SECTION_HEADERS if 'CAVEAT' not in p])

        return {
            "answer": summary_text, "trader_takeaways": trader_items,
            "battery_takeaways": battery_items, "key_signals": signal_items,
            "drivers": signal_items if signal_items else trader_items[:2],
            "caveats": caveat_items, "status": "ok",
        }
    except ImportError:
        return {"answer": "openai package not installed. Run: pip install openai", "status": "error"}
    except Exception as exc:
        logger.error("OpenAI error: %s", exc)
        raise HTTPException(status_code=500, detail=f"AI error: {exc}")


class ExplainRequest(BaseModel):
    prompt: str


@router.post("/api/explain")
def explain(body: ExplainRequest):
    return ai_explainer(AIExplainRequest(question=body.prompt))


# ---------------------------------------------------------------------------
# Specialized AI summary endpoints
# ---------------------------------------------------------------------------
def _summary_endpoint(stats_block: str, system_prompt: str):
    if not OPENAI_API_KEY:
        return {"summary": "", "status": "unconfigured"}
    try:
        raw = _call_openai(system_prompt, stats_block)
        return {"summary": _strip_markdown(raw), "status": "ok"}
    except ImportError:
        return {"summary": "", "status": "error"}
    except Exception as exc:
        logger.error("AI summary error: %s", exc)
        return {"summary": "", "status": "error"}


_PRICE_PROMPT = (
    "You are a senior NYISO electricity market analyst. Write a concise 3-5 sentence "
    "market commentary paragraph about current NYISO price conditions based on the stats below. "
    "Cover: DA vs RT price levels, strongest DART spread zone, notable peak/low hours, "
    "and intraday shape or volatility. Use specific numbers from the data. "
    "Do NOT use markdown formatting. No **, no #, no `. Write plain professional prose. "
    "Do NOT invent data not provided. Keep under 120 words."
)

_GEN_PROMPT = (
    "You are a senior NYISO electricity market analyst. Write a concise 3-5 sentence "
    "market commentary paragraph about current NYISO generation conditions based on the stats below. "
    "Cover: fuel mix dominance, generation peaks, renewable contribution, "
    "and mix diversity or concentration. Use specific numbers from the data. "
    "Do NOT use markdown formatting. No **, no #, no `. Write plain professional prose. "
    "Do NOT invent data not provided. Keep under 120 words."
)

_CONG_PROMPT = (
    "You are a senior NYISO electricity market analyst. Write a concise 3-5 sentence "
    "market commentary paragraph about current NYISO transmission congestion based on the stats below. "
    "Cover: total congestion costs, highest-cost binding constraint, concentration of costs, "
    "whether congestion was broad-based or concentrated, and notable constraint patterns. "
    "Use specific numbers from the data. "
    "Do NOT use markdown formatting. No **, no #, no `. Write plain professional prose. "
    "Do NOT invent data not provided. Keep under 120 words."
)

_FLOW_PROMPT = (
    "You are a senior NYISO electricity market analyst. Write a concise 3-5 sentence "
    "market commentary paragraph about current NYISO interface flow conditions based on the stats below. "
    "Cover: most active transfer paths, internal vs external flow pressure, "
    "peak flow magnitudes, import/export dynamics, and whether flows are concentrated or broad-based. "
    "Use specific numbers from the data. "
    "Do NOT use markdown formatting. No **, no #, no `. Write plain professional prose. "
    "Do NOT invent data not provided. Keep under 120 words."
)

_DEMAND_PROMPT = (
    "You are a senior NYISO electricity market analyst. Write a concise 3-5 sentence "
    "market commentary paragraph about current NYISO demand conditions based on the stats below. "
    "Cover: forecast vs actual load levels, forecast accuracy/bias, peak timing, "
    "and any notable stress windows or surprises. Use specific numbers from the data. "
    "Do NOT use markdown formatting. No **, no #, no `. Write plain professional prose. "
    "Do NOT invent data not provided. Keep under 120 words."
)


class PriceSummaryRequest(BaseModel):
    onPeakAvgDA: str = ""; onPeakAvgRT: str = ""; peakDA: str = ""; peakRT: str = ""
    lowDA: str = ""; lowRT: str = ""; topDartZone: str = ""; topDartAvg: str = ""
    topDartMax: str = ""; dateRange: str = ""


@router.post("/api/ai-price-summary")
def ai_price_summary(body: PriceSummaryRequest):
    stats = (
        f"On-Peak Avg DA LMP: ${body.onPeakAvgDA}/MWh\nOn-Peak Avg RT LMP: ${body.onPeakAvgRT}/MWh\n"
        f"Peak DA LMP: {body.peakDA}\nPeak RT LMP: {body.peakRT}\nLow DA LMP: {body.lowDA}\n"
        f"Low RT LMP: {body.lowRT}\nTop DART Zone: {body.topDartZone} (avg ${body.topDartAvg}, max ${body.topDartMax})\n"
        f"Date Range: {body.dateRange}"
    )
    return _summary_endpoint(stats, _PRICE_PROMPT)


class GenerationSummaryRequest(BaseModel):
    onPeakAvgTotal: str = ""; peakTotal: str = ""; lowTotal: str = ""; topFuel: str = ""
    topFuelShare: str = ""; secondFuel: str = ""; secondFuelShare: str = ""
    renewableShare: str = ""; fuelTypesActive: str = ""; dateRange: str = ""


@router.post("/api/ai-generation-summary")
def ai_generation_summary(body: GenerationSummaryRequest):
    stats = (
        f"On-Peak Avg Total Generation: {body.onPeakAvgTotal}\nPeak Total Generation: {body.peakTotal}\n"
        f"Low Total Generation: {body.lowTotal}\nTop Fuel Source: {body.topFuel} ({body.topFuelShare})\n"
        f"Second Fuel Source: {body.secondFuel} ({body.secondFuelShare})\nRenewable Share: {body.renewableShare}\n"
        f"Fuel Types Active: {body.fuelTypesActive}\nDate Range: {body.dateRange}"
    )
    return _summary_endpoint(stats, _GEN_PROMPT)


class CongestionSummaryRequest(BaseModel):
    onPeakTotalCost: str = ""; onPeakAvgCost: str = ""; peakPositive: str = ""; peakNegative: str = ""
    highestCostConstraint: str = ""; avgCostTopConstraint: str = ""; bindingCount: str = ""
    top3Share: str = ""; dateRange: str = ""


@router.post("/api/ai-congestion-summary")
def ai_congestion_summary(body: CongestionSummaryRequest):
    stats = (
        f"On-Peak Total Constraint Cost: {body.onPeakTotalCost}\nOn-Peak Avg Constraint Cost: {body.onPeakAvgCost}\n"
        f"Peak Positive Constraint Cost: {body.peakPositive}\nPeak Negative Constraint Cost: {body.peakNegative}\n"
        f"Highest-Cost Binding Constraint: {body.highestCostConstraint}\nAvg Cost of Top Constraint: {body.avgCostTopConstraint}\n"
        f"Binding Constraints Count: {body.bindingCount}\nTop 3 Concentration: {body.top3Share}\nDate Range: {body.dateRange}"
    )
    return _summary_endpoint(f"NYISO Congestion Statistics:\n{stats}", _CONG_PROMPT)


class FlowSummaryRequest(BaseModel):
    onPeakAvgInternal: str = ""; onPeakAvgExternal: str = ""; peakPositive: str = ""; peakNegative: str = ""
    mostActive: str = ""; topInternal: str = ""; topExternal: str = ""; activeCount: str = ""; dateRange: str = ""


@router.post("/api/ai-flow-summary")
def ai_flow_summary(body: FlowSummaryRequest):
    stats = (
        f"On-Peak Avg Internal Flow: {body.onPeakAvgInternal}\nOn-Peak Avg External Flow: {body.onPeakAvgExternal}\n"
        f"Peak Positive Flow: {body.peakPositive}\nPeak Negative Flow: {body.peakNegative}\n"
        f"Most Active Interface: {body.mostActive}\nTop Internal Interface: {body.topInternal}\n"
        f"Top External Interface: {body.topExternal}\nActive Interfaces: {body.activeCount}\nDate Range: {body.dateRange}"
    )
    return _summary_endpoint(f"NYISO Interface Flow Statistics:\n{stats}", _FLOW_PROMPT)


class DemandSummaryRequest(BaseModel):
    onPeakAvgForecast: str = ""; onPeakAvgActual: str = ""; peakForecast: str = ""; peakActual: str = ""
    lowForecast: str = ""; lowActual: str = ""; avgForecastError: str = ""; peakForecastError: str = ""
    largestUnderForecast: str = ""; largestOverForecast: str = ""; dateRange: str = ""


@router.post("/api/ai-demand-summary")
def ai_demand_summary(body: DemandSummaryRequest):
    stats = (
        f"On-Peak Avg Forecast Load: {body.onPeakAvgForecast}\nOn-Peak Avg Actual Load: {body.onPeakAvgActual}\n"
        f"Peak Forecast Load: {body.peakForecast}\nPeak Actual Load: {body.peakActual}\n"
        f"Low Forecast Load: {body.lowForecast}\nLow Actual Load: {body.lowActual}\n"
        f"Avg Forecast Error: {body.avgForecastError}\nPeak Forecast Error: {body.peakForecastError}\n"
        f"Largest Under-Forecast: {body.largestUnderForecast}\nLargest Over-Forecast: {body.largestOverForecast}\n"
        f"Date Range: {body.dateRange}"
    )
    return _summary_endpoint(stats, _DEMAND_PROMPT)
