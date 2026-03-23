"""
NYISO MIS Incremental Updater — CLI.

Fetches today's current_url for:
  - All no_archive=True datasets (no monthly ZIPs available)
  - Optionally all datasets (daily refresh mode)

Designed to be wired to a cron job / scheduler.

Usage:
  python -m pipeline.mis_incremental                    # no-archive datasets only
  python -m pipeline.mis_incremental --all              # all datasets
  python -m pipeline.mis_incremental --dataset rtfuelmix
  python -m pipeline.mis_incremental --category generation
"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path
from typing import Optional

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from etl.mis_registry import MIS_REGISTRY
from etl.mis_loader import incremental_update
from etl.extract.http_client import create_session

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("pipeline.mis_incremental")


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="NYISO MIS Incremental Updater")
    scope = p.add_mutually_exclusive_group()
    scope.add_argument("--all", action="store_true", help="Refresh all datasets (not just no-archive)")
    scope.add_argument("--dataset", help="Single dataset name")
    scope.add_argument("--category", help="Dataset category")
    return p.parse_args()


def run_incremental(dataset_filter: Optional[list[str]], all_datasets: bool) -> dict[str, int]:
    session = create_session()
    results: dict[str, int] = {}

    targets = {
        k: v for k, v in MIS_REGISTRY.items()
        if (dataset_filter is None or k in dataset_filter)
        and (all_datasets or v.get("no_archive") or v.get("current_url"))
        and v.get("current_url")
    }

    if not all_datasets and dataset_filter is None:
        # Default: only no_archive datasets
        targets = {k: v for k, v in targets.items() if v.get("no_archive")}

    logger.info("Running incremental update for %d datasets", len(targets))

    for name, meta in sorted(targets.items()):
        try:
            rows = incremental_update(session, name, meta)
            results[name] = rows
        except Exception as exc:
            logger.error("[%s] Incremental update failed: %s", name, exc, exc_info=True)
            results[name] = -1

    _print_summary(results)
    return results


def _print_summary(results: dict[str, int]) -> None:
    print("\n" + "=" * 55)
    print(f"{'DATASET':<35} {'ROWS':>10}")
    print("-" * 55)
    for name, rows in sorted(results.items()):
        status = f"{rows:>10,}" if rows >= 0 else "    FAILED"
        print(f"{name:<35} {status}")
    print("=" * 55)


def main() -> None:
    args = _parse_args()

    if args.dataset:
        if args.dataset not in MIS_REGISTRY:
            logger.error("Unknown dataset: %s", args.dataset)
            sys.exit(1)
        dataset_filter = [args.dataset]
    elif args.category:
        dataset_filter = [k for k, v in MIS_REGISTRY.items() if v.get("category") == args.category]
        if not dataset_filter:
            logger.error("No datasets found for category: %s", args.category)
            sys.exit(1)
    else:
        dataset_filter = None

    run_incremental(dataset_filter=dataset_filter, all_datasets=args.all)


if __name__ == "__main__":
    main()
