import streamlit as st
import plotly.express as px

def line_chart_placeholder(df, title="Chart"):
    if df.empty:
        st.info("No data available for chart.")
        return

    numeric_cols = df.select_dtypes(include="number").columns.tolist()
    if not numeric_cols:
        st.info("No numeric columns found for plotting.")
        return

    x_col = df.columns[0]
    y_col = numeric_cols[0]

    fig = px.line(df, x=x_col, y=y_col, title=title)
    st.plotly_chart(fig, use_container_width=True)
