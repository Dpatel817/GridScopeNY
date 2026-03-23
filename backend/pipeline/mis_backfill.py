"""
NYISO MIS Backfill Pipeline — CLI orchestrator.

Flow:
  1. Crawl index pages → discover all archive ZIP URLs
  2. Save/update manifest (idempotent)
  3. Filter already-ingested URLs
  4. Download ZIPs → extract CSVs
  5. Normalize + tag → upsert parquet
  6. Sync to legacy data/
  7. Print summary report

Usage:
  python -m pipeline.mis_backfill --all
  python -m pipeline.mis_backfill --dataset da_lbmp_zone --start 2023-01 --end 2023-12
  python -m pipeline.mis_backfill --category prices --start 2024-01
  python -m pipeline.mis_backfill --all --dry-run
  python -m pipeline.mis_backfill --all --force --workers 4
"""
from __future__ import annotations

import argparse
import io
import logging
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Optional

import pandas as pd

# Ensure backend/ is on sys.path when run as __main__
_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from etl.mis_registry import MIS_REGISTRY
from etl.mis_crawler import crawl_all, ArchiveLink
from etl.mis_manifest import (
    save_archive_manifest, mark_downloaded,
    is_url_ingested, build_hash_registry, load_archive_manifest,
)
from etl.mis_downloader import download_zip, DownloadResult
from etl.mis_loader import normalize_and_tag, load_raw_table
from etl.storage import sync_to_legacy
from etl.extract.http_client import create_session

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("pipeline.mis_backfill")


@dataclass
class DatasetSummary:
    dataset_name: str
    p_code: str
    archives_discovered: int = 0
    archives_downloaded: int = 0
    archives_skipped: int = 0
    archives_failed: int = 0
    rows_loaded: int = 0
    failures: list[str] = field(default_factory=list)


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="NYISO MIS Backfill Pipeline")
    scope = p.add_mutually_exclusive_group(required=True)
    scope.add_argument("--all", action="store_true", help="Process all datasets")
    scope.add_argument("--dataset", help="Single dataset name (e.g. da_lbmp_zone)")
    scope.add_argument("--category", help="Dataset category (prices, demand, generation, interfaces, congestion)")
    p.add_argument("--start", metavar="YYYY-MM", help="Start month (inclusive)")
    p.add_argument("--end", metavar="YYYY-MM", help="End month (inclusive), defaults to current month")
    p.add_argument("--force", action="store_true", help="Re-download already-ingested archives")
    p.add_argument("--dry-run", action="store_true", help="Crawl and show manifest only, no downloads")
    p.add_argument("--workers", type=int, default=1, help="Parallel download workers (default: 1)")
    return p.parse_args()


def _filter_by_month(links: list[ArchiveLink], start: Optional[str], end: Optional[str]) -> list[ArchiveLink]:
    if not start and not end:
        return links
    result = []
    for link in links:
        m = link.archive_month
        if m == "unknown":
            result.append(link)
            continue
        if start and m < start:
            continue
        if end and m > end:
            continue
        result.append(link)
    return result


def _process_csv_files(
    csv_files: list[tuple[str, bytes]],
    dataset_name: str,
    meta: dict,
    archive_url: str,
    archive_month: str,
) -> int:
    """Parse, tag, and load all CSVs from a single archive. Returns total rows loaded."""
    total = 0
    for filename, csv_bytes in csv_files:
        try:
            df = pd.read_csv(io.BytesIO(csv_bytes))
        except Exception as exc:
            logger.error("[%s] Failed to parse %s: %s", dataset_name, filename, exc)
            continue

        if df.empty:
            continue

        df = normalize_and_tag(
            df,
            dataset_name=dataset_name,
            meta=meta,
            source_url=archive_url,
            archive_month=archive_month,
            file_name_inside_zip=filename,
        )

        rows = load_raw_table(df, dataset_name, meta, year_month=archive_month)
        total += rows
        logger.info("[%s] Loaded %s → %d rows", dataset_name, filename, rows)

    return total


def _process_link(
    session,
    link: ArchiveLink,
    meta: dict,
    hash_registry: dict,
    force: bool,
) -> tuple[DownloadResult, int]:
    """Download + load one archive link. Returns (result, rows_loaded)."""
    if not force and is_url_ingested(link.archive_url):
        return DownloadResult(
            dataset_name=link.dataset_name,
            archive_url=link.archive_url,
            archive_month=link.archive_month,
            status="skipped",
        ), 0

    result = download_zip(
        session=session,
        archive_url=link.archive_url,
        dataset_name=link.dataset_name,
        archive_month=link.archive_month,
        content_hash_registry=hash_registry,
    )

    rows = 0
    if result.status == "downloaded" and result.csv_files:
        rows = _process_csv_files(
            result.csv_files,
            link.dataset_name,
            meta,
            link.archive_url,
            link.archive_month,
        )

    mark_downloaded(
        archive_url=link.archive_url,
        rows_loaded=rows,
        status=result.status,
        content_hash=result.content_hash,
        error=result.error,
    )

    return result, rows


def run_backfill(
    dataset_filter: Optional[list[str]],
    start: Optional[str],
    end: Optional[str],
    force: bool,
    dry_run: bool,
    workers: int,
) -> dict[str, DatasetSummary]:
    session = create_session()

    # Step 1: Crawl
    logger.info("=== Step 1: Crawling index pages ===")
    all_links = crawl_all(session, MIS_REGISTRY, dataset_filter=dataset_filter)

    # Step 2: Save manifest
    flat_links = [link for links in all_links.values() for link in links]
    logger.info("=== Step 2: Saving manifest (%d links) ===", len(flat_links))
    save_archive_manifest(flat_links)

    if dry_run:
        logger.info("Dry run — stopping after manifest save")
        _print_summary({}, all_links)
        return {}

    # Step 3: Filter by month range
    filtered: dict[str, list[ArchiveLink]] = {}
    for name, links in all_links.items():
        filtered[name] = _filter_by_month(links, start, end)

    # Step 4-6: Download + load
    logger.info("=== Step 3: Downloading and loading archives ===")
    hash_registry = build_hash_registry()
    summaries: dict[str, DatasetSummary] = {}

    for dataset_name, links in sorted(filtered.items()):
        meta = MIS_REGISTRY[dataset_name]
        summary = DatasetSummary(
            dataset_name=dataset_name,
            p_code=meta.get("p_code", ""),
            archives_discovered=len(links),
        )
        summaries[dataset_name] = summary

        if not links:
            continue

        def _process(link: ArchiveLink) -> tuple[DownloadResult, int]:
            return _process_link(session, link, meta, hash_registry, force)

        if workers > 1:
            with ThreadPoolExecutor(max_workers=workers) as ex:
                futures = {ex.submit(_process, link): link for link in links}
                for fut in as_completed(futures):
                    link = futures[fut]
                    try:
                        result, rows = fut.result()
                        _tally(summary, result, rows)
                    except Exception as exc:
                        logger.error("[%s] Unexpected error for %s: %s", dataset_name, link.archive_url, exc)
                        summary.archives_failed += 1
                        summary.failures.append(f"{link.archive_url}: {exc}")
        else:
            for link in links:
                try:
                    result, rows = _process(link)
                    _tally(summary, result, rows)
                except Exception as exc:
                    logger.error("[%s] Unexpected error for %s: %s", dataset_name, link.archive_url, exc)
                    summary.archives_failed += 1
                    summary.failures.append(f"{link.archive_url}: {exc}")

        if summary.rows_loaded > 0:
            try:
                sync_to_legacy(dataset_name, meta)
            except Exception as exc:
                logger.warning("[%s] Legacy sync failed: %s", dataset_name, exc)

    _print_summary(summaries, all_links)
    return summaries


def _tally(summary: DatasetSummary, result: DownloadResult, rows: int) -> None:
    if result.status == "downloaded":
        summary.archives_downloaded += 1
        summary.rows_loaded += rows
    elif result.status == "skipped":
        summary.archives_skipped += 1
    elif result.status == "failed":
        summary.archives_failed += 1
        if result.error:
            summary.failures.append(f"{result.archive_url}: {result.error}")


def _print_summary(summaries: dict[str, DatasetSummary], all_links: dict) -> None:
    print("\n" + "=" * 90)
    print(f"{'DATASET':<35} {'P-CODE':<10} {'DISC':>6} {'DL':>6} {'SKIP':>6} {'FAIL':>6} {'ROWS':>10}")
    print("-" * 90)

    if summaries:
        for name, s in sorted(summaries.items()):
            print(f"{name:<35} {s.p_code:<10} {s.archives_discovered:>6} "
                  f"{s.archives_downloaded:>6} {s.archives_skipped:>6} "
                  f"{s.archives_failed:>6} {s.rows_loaded:>10,}")
            for failure in s.failures:
                print(f"  !! {failure}")
    else:
        for name, links in sorted(all_links.items()):
            meta = MIS_REGISTRY.get(name, {})
            print(f"{name:<35} {meta.get('p_code',''):<10} {len(links):>6} {'(dry-run)':>6}")

    print("=" * 90)


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

    end = args.end or date.today().strftime("%Y-%m")

    run_backfill(
        dataset_filter=dataset_filter,
        start=args.start,
        end=end,
        force=args.force,
        dry_run=args.dry_run,
        workers=args.workers,
    )


if __name__ == "__main__":
    main()
