# GridScope NY

A Streamlit-based NYISO (New York Independent System Operator) market intelligence dashboard for visualizing and analyzing electricity market data including prices, demand, generation, interface flows, congestion, and AI-assisted analysis.

## Architecture

- **Framework**: Streamlit (Python)
- **Language**: Python 3.12
- **Entry point**: `app.py`
- **Pages**: `pages/` directory (Streamlit multi-page app)
- **Source modules**: `src/` directory
- **Data**: `data/raw/` and `data/processed/` directories
- **ETL scripts**: `ETL/` directory

## Project Structure

```
app.py                  # Main entry point / Home page
pages/
  1_Prices.py           # Price data page
  2_Demand.py           # Demand data page
  3_Generation.py       # Generation data page
  4_Interface_Flows.py  # Interface flows page
  5_Congestion.py       # Congestion data page
  6_Opportunity_Explorer.py  # Opportunity analysis
  7_AI_Explainer.py     # AI-powered explanations
src/
  config.py             # App configuration and constants
  data_loader.py        # Data loading utilities
  charts.py             # Chart helpers
  filters.py            # UI filter components
  metrics.py            # Metric calculations
  nav.py                # Sidebar navigation
  utils.py              # Utility functions
  ai_explainer.py       # AI explanation logic
ETL/
  fetch_nyiso_data.py   # NYISO data fetching
  process_nyiso_data.py # Data processing
data/
  raw/                  # Raw NYISO data files
  processed/            # Processed CSV files for the app
```

## Configuration

- Streamlit config: `.streamlit/config.toml`
- Theme: Bootstrap-inspired color palette with Inter font
- Environment variables: `.env` file (OPENAI_API_KEY, NYISO_API_KEY)

## Running

```bash
streamlit run app.py --server.port 5000 --server.address 0.0.0.0 --server.headless true
```

## Dependencies

- streamlit
- pandas
- numpy
- plotly
- python-dotenv
- openpyxl
