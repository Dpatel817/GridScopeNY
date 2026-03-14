import streamlit as st
from src.data_loader import load_processed_data
from src.charts import line_chart_placeholder

st.title("Demand")
df = load_processed_data("demand.csv")

if df.empty:
    st.warning("No processed demand data found.")
else:
    st.dataframe(df.head(), use_container_width=True)
    line_chart_placeholder(df, title="Demand Trend")
