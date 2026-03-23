"""
GridScope NY — 15-Minute Incremental Scraper (thin CLI wrapper)
Delegates all logic to pipeline/runner.py.

Usage:
    python -m pipeline.scraper
    python -m pipeline.scraper --lookback-days 3
    python -m pipeline.scraper --dataset da_lbmp_zone
    python -m pipeline.scraper --category prices
"""
import argparse
import logging
import sys

from etl.datasets import DATASET_REGISTRY
from etl.extract.http_client import create_session
from etl.utils import setup_logging
from pipeline.runner import run_dated_dataset, run_snapshot_dataset

logger = logging.getLogger("pipeline.scraper")

DEFAULT_LOOKBACK_DAYS = 2


def main():
    parser = argparse.ArgumentParser(description="GridScope NY — 15-Minute Scraper")
    parser.add_argument("--lookback-days", type=int, default=DEFAULT_LOOKBACK_DAYS)
    parser.add_argument("--dataset", type=str)
    parser.add_argument("--category", type=str)
    args = parser.parse_args()

    log_file = setup_logging("scraper")
    logger.info("Log file: %s", log_file)
    logger.info("Lookback: %d days", args.lookback_days)

    if args.dataset:
        if args.dataset not in DATASET_REGISTRY:
            logger.error("Unknown dataset: %s", args.dataset)
            sys.exit(1)
        targets = {args.dataset: DATASET_REGISTRY[args.dataset]}
    elif args.category:
        targets = {k: v for k, v in DATASET_REGISTRY.items() if v["category"] == args.category}
        if not targets:
            logger.error("No datasets found for category: %s", args.category)
            sys.exit(1)
    else:
        targets = DATASET_REGISTRY

    session = create_session()
    dated = {k: v for k, v in targets.items() if v["dataset_type"] in ("dated_csv", "dated_txt")}
    snapshots = {k: v for k, v in targets.items() if v["dataset_type"] in ("snapshot_csv", "snapshot_xlsx")}

    logger.info("Updating %d dated + %d snapshot datasets", len(dated), len(snapshots))

    errors = []
    for name, meta in sorted(dated.items()):
        try:
            run_dated_dataset(session, name, meta, args.lookback_days)
        except Exception as exc:
            logger.error("FAILED %s: %s", name, exc, exc_info=True)
            errors.append(name)

    for name, meta in sorted(snapshots.items()):
        try:
            run_snapshot_dataset(session, name, meta)
        except Exception as exc:
            logger.error("FAILED %s: %s", name, exc, exc_info=True)
            errors.append(name)

    session.close()

    if errors:
        logger.warning("Completed with %d errors: %s", len(errors), errors)
        sys.exit(1)
    else:
        logger.info("Scraper update complete!")


if __name__ == "__main__":
    main()
