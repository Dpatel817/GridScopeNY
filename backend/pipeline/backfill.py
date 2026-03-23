"""
GridScope NY — Historical Backfill (thin CLI wrapper)
Delegates all logic to pipeline/runner.py.

Usage:
    python -m pipeline.backfill --all
    python -m pipeline.backfill --dataset da_lbmp_zone
    python -m pipeline.backfill --dataset da_lbmp_zone --start 2024-01 --end 2025-06
    python -m pipeline.backfill --category prices
    python -m pipeline.backfill --list
"""
import argparse
import logging
import sys
from datetime import date

from etl.config import BACKFILL_START
from etl.datasets import DATASET_REGISTRY
from etl.extract.http_client import create_session
from etl.utils import setup_logging
from pipeline.runner import backfill_dated_dataset, run_snapshot_dataset

logger = logging.getLogger("pipeline.backfill")


def main():
    parser = argparse.ArgumentParser(description="GridScope NY — Historical Backfill")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--dataset", type=str)
    parser.add_argument("--category", type=str)
    parser.add_argument("--start", type=str, default=None)
    parser.add_argument("--end", type=str, default=None)
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    if args.list:
        for name, meta in sorted(DATASET_REGISTRY.items()):
            print(f"  {name:35s} {meta['dataset_type']:15s} {meta['category']}")
        return

    log_file = setup_logging("backfill")
    logger.info("Log file: %s", log_file)

    start_month = args.start or BACKFILL_START.strftime("%Y-%m")
    end_month = args.end or date.today().strftime("%Y-%m")
    logger.info("Backfill range: %s to %s", start_month, end_month)

    if args.dataset:
        targets = {args.dataset: DATASET_REGISTRY[args.dataset]}
    elif args.category:
        targets = {k: v for k, v in DATASET_REGISTRY.items() if v["category"] == args.category}
    elif args.all:
        targets = DATASET_REGISTRY
    else:
        parser.print_help()
        return

    if args.force:
        from etl.manifests import load_manifest, save_manifest
        for name in targets:
            m = load_manifest(name)
            m.pop("processed_months", None)
            save_manifest(name, m)

    session = create_session()
    dated = {k: v for k, v in targets.items() if v["dataset_type"] in ("dated_csv", "dated_txt")}
    snapshots = {k: v for k, v in targets.items() if v["dataset_type"] in ("snapshot_csv", "snapshot_xlsx")}

    logger.info("Backfilling %d dated + %d snapshot datasets", len(dated), len(snapshots))

    for name, meta in sorted(dated.items()):
        logger.info("\n%s\nDATASET: %s (%s)\n%s", "=" * 50, name, meta["category"], "=" * 50)
        try:
            backfill_dated_dataset(session, name, meta, start_month, end_month)
        except Exception as exc:
            logger.error("FAILED %s: %s", name, exc, exc_info=True)

    for name, meta in sorted(snapshots.items()):
        logger.info("\n%s\nSNAPSHOT: %s (%s)\n%s", "=" * 50, name, meta["category"], "=" * 50)
        try:
            run_snapshot_dataset(session, name, meta)
        except Exception as exc:
            logger.error("FAILED %s: %s", name, exc, exc_info=True)

    logger.info("\nBackfill complete!")
    session.close()


if __name__ == "__main__":
    main()
