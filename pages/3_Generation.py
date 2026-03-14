import streamlit as st
from src.data_loader import load_processed_data
from src.charts import line_chart_placeholder

st.title("Generation")
df = load_processed_data("generation.csv")

if df.empty:
    st.warning("No processed generation data found.")
else:
    st.dataframe(df.head(), use_container_width=True)
    line_chart_placeholder(df, title="Generation Trend")
