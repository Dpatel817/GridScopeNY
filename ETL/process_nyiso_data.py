import pandas as pd

def strip_whitespace(url):
    df = pd.read_csv(url)
    return df


url = r"GridScope_NY/data/raw/da_lbmp_zone_raw.csv"

strip_whitespace(url)

print(url)