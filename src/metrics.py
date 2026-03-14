import pandas as pd

def rank_opportunities(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df

    ranked = df.copy()

    if "score" not in ranked.columns:
        numeric_cols = ranked.select_dtypes(include="number").columns.tolist()
        if numeric_cols:
            ranked["score"] = ranked[numeric_cols].sum(axis=1)
        else:
            ranked["score"] = 0

    return ranked.sort_values("score", ascending=False).reset_index(drop=True)
