import streamlit as st
from src.data_loader import load_processed_data
from src.charts import line_chart_placeholder

st.title("Interface Flows")
df = load_processed_data("interface_flows.csv")

if df.empty:
    st.warning("No processed interface flow data found.")
else:
    st.dataframe(df.head(), use_container_width=True)
    line_chart_placeholder(df, title="Interface Flow Trend")
