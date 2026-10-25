"""Backward-compatibility shim.

All logic has been moved to the web/ package. This module re-exports
public symbols so that existing imports (tests, web.py, conftest.py)
continue to work without modification.
"""

from .web import close_app, create_app  # noqa: F401
from .web.helpers import safe_int, safe_float, _filter_cases, EDITABLE_FIELDS, ITEMS_PER_PAGE  # noqa: F401
from .web.jobs import _job_lock, _job_status  # noqa: F401
from .web.security import csrf  # noqa: F401
from .storage import load_all_cases  # noqa: F401
