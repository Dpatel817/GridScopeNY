"""Integration tests for pipeline runner (mocked I/O)."""
from __future__ import annotations

import pytest
import pandas as pd
from unittest.mock import MagicMock, patch


class TestRunDatedDataset:
    def _meta(self):
        return {
            "dataset_type": "dated_csv",
            "daily_url": "https://example.com/{date}test.csv",
            "primary_keys": ["Time Stamp", "Name"],
            "timestamp_col": "Time Stamp",
            "sort_cols": ["Time Stamp"],
        }

    @patch("pipeline.runner.mark_dates_processed")
    @patch("pipeline.runner.sync_to_legacy")
    @patch("pipeline.runner.upsert_parquet")
    @patch("pipeline.runner.process_raw_files")
    @patch("pipeline.runner.fetch_daily_file")
    @patch("pipeline.runner.get_date_range")
    def test_run_dated_dataset_success(
        self, mock_dates, mock_fetch, mock_process, mock_upsert, mock_sync, mock_mark
    ):
        from pipeline.runner import run_dated_dataset

        mock_dates.return_value = ["20240615", "20240616"]
        mock_fetch.return_value = "/tmp/fake.csv"
        mock_process.return_value = pd.DataFrame({"Time Stamp": ["2024-06-15"], "Name": ["WEST"], "LMP": [10.0]})

        session = MagicMock()
        run_dated_dataset(session, "da_lbmp_zone", self._meta(), lookback_days=2)

        mock_upsert.assert_called_once()
        mock_sync.assert_called_once()
        mock_mark.assert_called_once()

    @patch("pipeline.runner.get_date_range")
    @patch("pipeline.runner.fetch_daily_file")
    def test_run_dated_dataset_no_files(self, mock_fetch, mock_dates):
        from pipeline.runner import run_dated_dataset

        mock_dates.return_value = ["20240615"]
        mock_fetch.return_value = None  # no file fetched

        session = MagicMock()
        # Should not raise, just log and return
        run_dated_dataset(session, "da_lbmp_zone", self._meta(), lookback_days=1)

    @patch("pipeline.runner.get_date_range")
    @patch("pipeline.runner.fetch_daily_file")
    @patch("pipeline.runner.process_raw_files")
    def test_run_dated_dataset_empty_df(self, mock_process, mock_fetch, mock_dates):
        from pipeline.runner import run_dated_dataset

        mock_dates.return_value = ["20240615"]
        mock_fetch.return_value = "/tmp/fake.csv"
        mock_process.return_value = pd.DataFrame()  # empty after processing

        session = MagicMock()
        run_dated_dataset(session, "da_lbmp_zone", self._meta(), lookback_days=1)


class TestRunSnapshotDataset:
    def _meta(self):
        return {
            "dataset_type": "snapshot_csv",
            "snapshot_url": "https://example.com/snapshot.csv",
            "primary_keys": ["PTID"],
            "timestamp_col": None,
            "sort_cols": ["PTID"],
        }

    @patch("pipeline.runner.mark_snapshot_fetched")
    @patch("pipeline.runner.sync_to_legacy")
    @patch("pipeline.runner.upsert_parquet")
    @patch("pipeline.runner.process_raw_file")
    @patch("pipeline.runner.fetch_snapshot")
    def test_run_snapshot_success(self, mock_fetch, mock_process, mock_upsert, mock_sync, mock_mark):
        from pipeline.runner import run_snapshot_dataset

        mock_fetch.return_value = "/tmp/snapshot.csv"
        mock_process.return_value = pd.DataFrame({"PTID": [1, 2], "Name": ["A", "B"]})

        session = MagicMock()
        run_snapshot_dataset(session, "generator_names", self._meta())

        mock_upsert.assert_called_once()
        mock_sync.assert_called_once()
        mock_mark.assert_called_once()

    @patch("pipeline.runner.mark_snapshot_fetched")
    @patch("pipeline.runner.fetch_snapshot")
    def test_run_snapshot_fetch_failure(self, mock_fetch, mock_mark):
        from pipeline.runner import run_snapshot_dataset

        mock_fetch.return_value = None  # fetch failed

        session = MagicMock()
        run_snapshot_dataset(session, "generator_names", self._meta())
        mock_mark.assert_not_called()
