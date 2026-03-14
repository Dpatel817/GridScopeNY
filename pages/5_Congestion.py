import streamlit as st
from src.data_loader import load_processed_data
from src.charts import line_chart_placeholder

st.title("Congestion")
df = load_processed_data("congestion.csv")

if df.empty:
    st.warning("No processed congestion data found.")
else:
    st.dataframe(df.head(), use_container_width=True)
    line_chart_placeholder(df, title="Congestion Trend")
