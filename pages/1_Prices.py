import streamlit as st
from src.data_loader import load_processed_data
from src.charts import line_chart_placeholder

st.title("Prices")
df = load_processed_data("prices.csv")

if df.empty:
    st.warning("No processed price data found.")
else:
    st.dataframe(df.head(), use_container_width=True)
    line_chart_placeholder(df, title="Price Trend")
