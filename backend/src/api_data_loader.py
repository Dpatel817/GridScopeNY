"""
Backward-compatibility shim.
All logic has been moved to:
  - app/datasets.py  (DATASET_META, PAGE_DATASETS, LARGE_DATASETS)
  - app/loader.py    (get_dataset_json, get_filter_options, get_page_config, get_data_inventory)
  - etl/load/cache.py (_df_cache, _load_csv_safe → load_file, _get_daily_cached, _build_daily_cache)
  - etl/transform/aggregator.py (_aggregate_df → aggregate_df)
"""
from app.datasets import DATASET_META, PAGE_DATASETS, LARGE_DATASETS as _LARGE_DATASETS  # noqa: F401
from app.loader import (  # noqa: F401
    get_dataset_json, get_filter_options, get_page_config, get_data_inventory,
)
from etl.load.cache import (  # noqa: F401
    _df_cache, load_file as _load_csv_safe,
    get_daily_cached as _get_daily_cached,
    build_daily_cache as _build_daily_cache,
)
from etl.transform.aggregator import aggregate_df as _aggregate_df  # noqa: F401
