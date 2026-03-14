import streamlit as st
from src.data_loader import load_processed_data
from src.metrics import rank_opportunities

st.title("Opportunity Explorer")
df = load_processed_data("opportunities.csv")

if df.empty:
    st.warning("No processed opportunity data found.")
else:
    ranked = rank_opportunities(df)
    st.dataframe(ranked, use_container_width=True)
