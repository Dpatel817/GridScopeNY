# Full-stack efficiency review (frontend + backend)

This review focuses on likely runtime inefficiencies, memory pressure points, and framework-level usage patterns.

## What is already good

- Backend already uses a shared thread pool for blocking dataframe work and offloads `get_dataset_json` from the FastAPI event loop, which is the right pattern for pandas-heavy handlers.
- Data access has layered caching (in-memory + parquet daily cache) and includes offset/limit pagination primitives.
- Frontend uses `useMemo` heavily for expensive transforms and lazy-loads the map feature via `React.lazy`.

## Highest-impact inefficiencies

### 1) Backend repeatedly scans large data and copies dataframes per request

**Where**
- `get_dataset_json` loads and processes full datasets before slicing with `offset`/`limit`.
- `_clean_df_for_json` performs a full `df.copy()`, multiple column loops, and then `to_dict(orient="records")`, which is memory-intensive.

**Impact**
- Large request payload preparation is CPU + RAM heavy; multiple concurrent requests can spike memory and GC time.

**Recommendation**
- Push projection and row filtering earlier (read only needed columns, date windows, and maybe pre-filtered partitions).
- Add a response model variant that returns compact arrays for charts instead of row-wise dicts for all views.
- For table views, keep server pagination but avoid full in-memory normalization for rows outside requested page.

### 2) Backend uses `groupby.apply` + `iterrows` in hot path (`/api/constraint-impact`)

**Where**
- `_find_clean_prints` uses `groupby(...).apply(lambda ...)` and later two `iterrows()` loops.

**Impact**
- `groupby.apply` and `iterrows` are significantly slower than vectorized alternatives for medium/large frames.

**Recommendation**
- Replace with vectorized steps: pre-filter by threshold, `drop_duplicates`, `groupby.size()`, and convert output via `to_dict("records")`.

### 3) Frontend has many independent page-level fetches and no shared request cache

**Where**
- Custom hooks/pages call `fetch` directly across multiple effects and components.

**Impact**
- Duplicate requests on route changes/re-renders and no stale-while-revalidate behavior; increased backend load and slower UX on revisits.

**Recommendation**
- Introduce TanStack Query (React Query) or SWR for request dedupe, caching, retries, and background refresh.
- Co-locate cache keys by dataset/resolution/date-range to avoid repeated network work.

### 4) Frontend table rendering is non-virtualized

**Where**
- `DataTable` slices rows but still renders potentially hundreds of rows x all columns in a normal `<table>`.

**Impact**
- DOM/render cost rises quickly with wide datasets; scroll and interaction degrade on large responses.

**Recommendation**
- Use row virtualization (`@tanstack/react-virtual` or `react-window`) and stable row keys.
- Optionally add column virtualization for very wide data.

## Medium-priority opportunities

### 5) Per-request schema validation in `_load_csv_safe` can be expensive

- `_load_csv_safe` compares parquet schema to CSV header by reading CSV header (`pd.read_csv(..., nrows=0)`) and parquet metadata when both files exist.
- Consider caching this decision per file mtime pair to avoid repeated metadata/header reads.

### 6) Cache lock strategy can create contention under concurrency

- `_daily_cache_lock` guards reads/writes of `_daily_mem_cache`, but cache misses still cause potentially repeated parquet reads by concurrent requests.
- Add single-flight behavior per dataset key (one builder/loader, others await result).

### 7) React StrictMode doubles effect invocation in development

- App root wraps everything in `<StrictMode>`, and multiple `useEffect` fetch patterns can trigger duplicate network calls in dev.
- Not a production issue, but it can obscure profiling; use abortable fetches and idempotent effect guards.

## Suggested implementation order (best ROI)

1. Vectorize `/api/constraint-impact` clean-print logic.
2. Add frontend data fetching cache layer (TanStack Query/SWR).
3. Introduce table virtualization.
4. Reduce backend JSON shaping overhead for high-volume endpoints.
5. Add single-flight cache protection for daily cache builds/loads.

## Bottom line

You are using solid frameworks correctly overall, but the main inefficiency pattern is **high-volume dataframe + JSON work on the backend** and **uncached repeated fetch/render work on the frontend**. Addressing the top four items should noticeably improve latency and reduce resource usage.
