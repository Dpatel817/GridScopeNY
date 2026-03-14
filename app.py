import streamlit as st
from src.config import APP_TITLE
from src.nav import render_sidebar_nav

st.set_page_config(page_title=APP_TITLE, layout="wide", initial_sidebar_state="expanded")

render_sidebar_nav()

st.title(APP_TITLE)
st.caption("NYISO market dashboard for prices, demand, generation, flows, congestion, and AI-assisted analysis.")

st.markdown("""
### Welcome
Use the sidebar to navigate across:
- Prices
- Demand
- Generation
- Interface Flows
- Congestion
- Opportunity Explorer
- AI Explainer
""")
