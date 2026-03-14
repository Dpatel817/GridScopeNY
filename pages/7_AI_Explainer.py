import streamlit as st
from src.ai_explainer import explain_text

st.title("AI Explainer")

prompt = st.text_area(
    "Ask a question about NYISO market behavior",
    placeholder="Why did Zone J prices separate from Zone G today?"
)

if st.button("Explain"):
    if not prompt.strip():
        st.warning("Enter a question first.")
    else:
        response = explain_text(prompt)
        st.write(response)
