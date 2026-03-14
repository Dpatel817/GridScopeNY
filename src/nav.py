from __future__ import annotations

import streamlit as st

APP_NAME = "GridScopeNY"
APP_SUBTITLE = "NYISO market intelligence"

NAV_ITEMS = [
    {"path": "app.py", "label": "Home", "icon": "🏠"},
    {"path": "pages/1_Prices.py", "label": "Prices", "icon": "💲"},
    {"path": "pages/2_Demand.py", "label": "Demand", "icon": "📈"},
    {"path": "pages/3_Generation.py", "label": "Generation", "icon": "⚡"},
    {"path": "pages/4_Interface_Flows.py", "label": "Interface Flows", "icon": "🔌"},
    {"path": "pages/5_Congestion.py", "label": "Congestion", "icon": "🚧"},
    {"path": "pages/6_Opportunity_Explorer.py", "label": "Opportunity Explorer", "icon": "🔎"},
    {"path": "pages/7_AI_Explainer.py", "label": "AI Explainer", "icon": "🤖"},
]


def render_sidebar_nav() -> None:
    """Render the custom sidebar navigation."""
    with st.sidebar:
        st.markdown(f"## {APP_NAME}")
        st.caption(APP_SUBTITLE)
        st.divider()

        for item in NAV_ITEMS:
            st.page_link(
                item["path"],
                label=item["label"],
                icon=item["icon"],
            )

        st.divider()
        st.caption("Source: NYISO MIS")


def render_page_header(title: str, subtitle: str | None = None) -> None:
    """Standard page header for consistent styling."""
    st.title(title)
    if subtitle:
        st.caption(subtitle)
    st.divider()


def render_top_summary(
    *,
    selected_market: str = "NYISO",
    selected_scope: str = "Zonal",
    last_updated: str | None = None,
) -> None:
    """Optional reusable summary row."""
    col1, col2, col3 = st.columns(3)

    with col1:
        st.metric("Market", selected_market)

    with col2:
        st.metric("Scope", selected_scope)

    with col3:
        st.metric("Last Updated", last_updated or "N/A")