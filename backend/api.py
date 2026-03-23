"""
Backward-compatibility shim.
The application has been refactored into api/main.py.
This file re-exports `app` so that `uvicorn api:app` still works
if invoked directly, but the canonical entry point is `api.main:app`.
"""
from api.main import app  # noqa: F401
