"""Unit tests for ETL transform stage."""
import pytest
import pandas as pd

from etl.transform.normalizer import normalize_columns, COLUMN_RENAMES
from etl.transform.aggregator import aggregate_df, ON_PEAK_HOURS, OFF_PEAK_HOURS
from etl.transform.validator import (
    validate_not_empty, validate_required_columns, validate_numeric_range,
    ValidationError,
)


# ---------------------------------------------------------------------------
# normalizer tests
# ---------------------------------------------------------------------------
class TestNormalizeColumns:
    def test_renames_lbmp_columns(self):
        df = pd.DataFrame({"LBMP ($/MWHr)": [10.0], "Marginal Cost Losses ($/MWHr)": [1.0]})
        result = normalize_columns(df)
        assert "LMP" in result.columns
        assert "MLC" in result.columns

    def test_derives_date_he_from_time_stamp(self):
        df = pd.DataFrame({"Time Stamp": pd.to_datetime(["2024-06-15 13:00:00"]), "Name": ["WEST"]})
        result = normalize_columns(df)
        assert "Date" in result.columns
        assert result["Date"].iloc[0] == "2024-06-15"
        assert result["HE"].iloc[0] == 14  # hour 13 → HE 14

    def test_promotes_name_to_zone(self):
        df = pd.DataFrame({"Name": ["WEST", "EAST"], "LMP": [10.0, 12.0]})
        result = normalize_columns(df)
        assert "Zone" in result.columns
        assert result["Zone"].tolist() == ["WEST", "EAST"]

    def test_empty_df_passthrough(self):
        df = pd.DataFrame()
        result = normalize_columns(df)
        assert result.empty

    def test_isolf_zone_renames(self):
        df = pd.DataFrame({"Capitl": [100.0], "Centrl": [200.0]})
        result = normalize_columns(df)
        assert "CAPITL" in result.columns
        assert "CENTRL" in result.columns


# ---------------------------------------------------------------------------
# aggregator tests
# ---------------------------------------------------------------------------
class TestAggregateDF:
    def _make_df(self):
        return pd.DataFrame({
            "Date": ["2024-06-15"] * 4,
            "HE": [8, 8, 9, 9],
            "Zone": ["WEST", "EAST", "WEST", "EAST"],
            "LMP": [10.0, 12.0, 11.0, 13.0],
        })

    def _meta(self):
        return {
            "native": "hourly",
            "date_col": "Date",
            "he_col": "HE",
            "group_cols": ["Zone"],
            "value_cols": ["LMP"],
        }

    def test_raw_returns_unchanged(self):
        df = self._make_df()
        result = aggregate_df(df, self._meta(), "raw")
        assert len(result) == 4

    def test_daily_aggregation(self):
        df = self._make_df()
        result = aggregate_df(df, self._meta(), "daily")
        assert len(result) == 2  # WEST and EAST
        west = result[result["Zone"] == "WEST"]["LMP"].iloc[0]
        assert west == pytest.approx(10.5, abs=0.01)

    def test_on_peak_filters_hours(self):
        df = pd.DataFrame({
            "Date": ["2024-06-15"] * 3,
            "HE": [1, 10, 22],  # 1=off-peak, 10=on-peak, 22=on-peak
            "Zone": ["WEST"] * 3,
            "LMP": [5.0, 15.0, 20.0],
        })
        result = aggregate_df(df, self._meta(), "on_peak")
        assert len(result) == 1
        assert result["LMP"].iloc[0] == pytest.approx(17.5, abs=0.01)

    def test_event_native_returns_unchanged(self):
        df = self._make_df()
        meta = {**self._meta(), "native": "event"}
        result = aggregate_df(df, meta, "daily")
        assert len(result) == 4

    def test_on_peak_hours_definition(self):
        assert 8 in ON_PEAK_HOURS
        assert 22 in ON_PEAK_HOURS
        assert 1 not in ON_PEAK_HOURS
        assert 7 not in ON_PEAK_HOURS

    def test_off_peak_hours_complement(self):
        assert set(ON_PEAK_HOURS) | set(OFF_PEAK_HOURS) == set(range(1, 25))
        assert set(ON_PEAK_HOURS) & set(OFF_PEAK_HOURS) == set()


# ---------------------------------------------------------------------------
# validator tests
# ---------------------------------------------------------------------------
class TestValidator:
    def test_validate_not_empty_raises_on_empty(self):
        with pytest.raises(ValidationError, match="empty"):
            validate_not_empty(pd.DataFrame(), "test_dataset")

    def test_validate_not_empty_passes_on_data(self):
        validate_not_empty(pd.DataFrame({"a": [1]}), "test_dataset")

    def test_validate_required_columns_raises_on_missing(self):
        df = pd.DataFrame({"A": [1]})
        with pytest.raises(ValidationError, match="Missing required columns"):
            validate_required_columns(df, ["A", "B"], "test_dataset")

    def test_validate_required_columns_passes(self):
        df = pd.DataFrame({"A": [1], "B": [2]})
        validate_required_columns(df, ["A", "B"], "test_dataset")

    def test_validate_numeric_range_warns_on_out_of_range(self, caplog):
        import logging
        df = pd.DataFrame({"LMP": [10000.0]})
        with caplog.at_level(logging.WARNING):
            validate_numeric_range(df, "LMP", -5000, 5000, "test_dataset")
        assert "above" in caplog.text

    def test_validate_numeric_range_skips_missing_col(self):
        df = pd.DataFrame({"other": [1]})
        validate_numeric_range(df, "LMP", -5000, 5000, "test_dataset")  # should not raise
