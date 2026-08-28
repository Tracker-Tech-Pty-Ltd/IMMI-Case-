"""End-to-end correctness of the /api/v1/cases pagination planner.

Every page a listing serves must be the same window the offset path would
serve, and a full walk must yield every row exactly once. These tests drive the
same planner + loader pair that `list_cases()` uses, against a real temporary
SQLite database.

Regression coverage:
  * the reverse tail walk used to return a shifted, full-size window whenever
    total % page_size != 0
  * the anchor cache key used to ignore page_size
  * sort_by="date" used to be routed to a seek path ordered by (year, case_id)
  * forward paging used to never record an anchor
"""

import os

import pytest

from immi_case_downloader.cases_pagination import CaseListQuery, choose_pagination_plan
from immi_case_downloader.models import ImmigrationCase
from immi_case_downloader.sqlite_repository import SqliteRepository
from immi_case_downloader.web.routes.api_constants import CASE_LIST_COLUMNS
from immi_case_downloader.web.routes.api_cases import (
    _load_cases_via_seek,
    _maybe_remember_offset_anchor,
)

MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


def _build_repo(tmp_path, count, dated=False):
    """Create a temporary SQLite repo with `count` deterministic cases."""
    repo = SqliteRepository(os.path.join(str(tmp_path), "cases.db"))
    repo.save_many([
        ImmigrationCase(
            case_id=f"c{i:05d}",
            citation=f"[{2000 + i % 26}] AATA {i}",
            title=f"Case {i}",
            court="AATA",
            court_code="AATA",
            date=(
                f"{(i % 28) + 1} {MONTHS[i % 12]} {2000 + i % 26}"
                if dated
                else str(2000 + i % 26)
            ),
            year=2000 + i % 26,
            url=f"http://example.test/{i}",
        )
        for i in range(count)
    ])
    return repo


def _offset_ids(repo, query, page, page_size):
    """The window the legacy offset path returns — the reference answer."""
    rows = repo.list_cases_fast(
        court=query.court,
        year=query.year,
        visa_type=query.visa_type,
        source=query.source,
        tag=query.tag,
        nature=query.nature,
        keyword=query.keyword,
        sort_by=query.sort_by,
        sort_dir=query.sort_dir,
        page=page,
        page_size=page_size,
        columns=CASE_LIST_COLUMNS,
    )
    return [c.case_id for c in rows]


def _serve_page(repo, query, page, page_size, total):
    """Mirror of `list_cases()`: plan, run the seek path, fall back to offset."""
    total_pages = max(1, (total + page_size - 1) // page_size)
    plan = choose_pagination_plan(
        repo=repo, query=query, page=page, total_pages=total_pages
    )
    rows, strategy, _reason = _load_cases_via_seek(
        repo,
        query=query,
        plan=plan,
        page=page,
        page_size=page_size,
        total=total,
        total_pages=total_pages,
    )
    if strategy == "offset_fallback":
        rows = repo.list_cases_fast(
            court=query.court,
            year=query.year,
            visa_type=query.visa_type,
            source=query.source,
            tag=query.tag,
            nature=query.nature,
            keyword=query.keyword,
            sort_by=query.sort_by,
            sort_dir=query.sort_dir,
            page=page,
            page_size=page_size,
            columns=CASE_LIST_COLUMNS,
        )
        _maybe_remember_offset_anchor(
            repo,
            query=query,
            page=page,
            page_size=page_size,
            page_cases=rows,
        )
    return [c.case_id for c in rows], strategy


def _query(sort_by="year", sort_dir="desc", page_size=50):
    return CaseListQuery(sort_by=sort_by, sort_dir=sort_dir, page_size=page_size)


@pytest.mark.parametrize(
    ("count", "page_size"),
    [(105, 50), (250, 100), (997, 100), (120, 10), (50, 50), (49, 50)],
)
@pytest.mark.parametrize("sort_dir", ["desc", "asc"])
def test_every_page_matches_the_offset_path(tmp_path, count, page_size, sort_dir):
    """A page served by any strategy equals the page the offset path serves."""
    repo = _build_repo(tmp_path, count)
    total = repo.count_cases()
    query = _query(sort_dir=sort_dir, page_size=page_size)
    total_pages = max(1, (total + page_size - 1) // page_size)

    for page in range(1, total_pages + 1):
        got, strategy = _serve_page(repo, query, page, page_size, total)
        assert got == _offset_ids(repo, query, page, page_size), (
            f"page {page}/{total_pages} served by {strategy} does not match offset"
        )


def test_last_page_is_partial_not_a_full_shifted_window(tmp_path):
    """105 rows at page_size=50: the last page has 5 rows, not 50."""
    repo = _build_repo(tmp_path, 105)
    total = repo.count_cases()
    query = _query(page_size=50)

    got, _strategy = _serve_page(repo, query, 3, 50, total)

    assert len(got) == 5
    assert got == _offset_ids(repo, query, 3, 50)


def test_full_walk_is_complete_and_duplicate_free(tmp_path):
    """Concatenating every page yields each case exactly once."""
    repo = _build_repo(tmp_path, 997)
    total = repo.count_cases()
    page_size = 100
    query = _query(page_size=page_size)

    seen = []
    for page in range(1, (total + page_size - 1) // page_size + 1):
        ids, _strategy = _serve_page(repo, query, page, page_size, total)
        seen.extend(ids)

    assert len(seen) == total
    assert len(set(seen)) == total


def test_date_sorted_walk_is_complete_and_duplicate_free(tmp_path):
    """sort_by='date' must not cross an ordering boundary mid-walk."""
    repo = _build_repo(tmp_path, 250, dated=True)
    total = repo.count_cases()
    page_size = 10
    query = _query(sort_by="date", page_size=page_size)

    seen = []
    strategies = set()
    for page in range(1, (total + page_size - 1) // page_size + 1):
        ids, strategy = _serve_page(repo, query, page, page_size, total)
        strategies.add(strategy)
        seen.extend(ids)

    assert len(seen) == total
    assert len(set(seen)) == total
    assert strategies == {"offset_fallback"}


def test_forward_paging_populates_the_anchor_cache(tmp_path):
    """Walking past the anchor interval must let a later page seek again."""
    repo = _build_repo(tmp_path, 250)
    total = repo.count_cases()
    page_size = 10
    query = _query(page_size=page_size)

    strategy = None
    ids = []
    for page in range(1, 12):
        ids, strategy = _serve_page(repo, query, page, page_size, total)

    assert strategy == "seek_forward"
    assert ids == _offset_ids(repo, query, 11, page_size)


def test_anchors_are_not_shared_across_page_sizes(tmp_path):
    """An anchor recorded at one page_size must not be reused at another."""
    repo = _build_repo(tmp_path, 120)
    total = repo.count_cases()

    # Warm the cache at page_size=10 (page 10 of 12 records an anchor).
    _serve_page(repo, _query(page_size=10), 10, 10, total)

    small = _query(page_size=5)
    got, _strategy = _serve_page(repo, small, 11, 5, total)

    assert got == _offset_ids(repo, small, 11, 5)


def test_anchors_are_not_shared_across_databases(tmp_path):
    """Two SQLite databases in one process must not read each other's anchors.

    backend_kind_for_repo() answers "sqlite" for both, so before the dataset id
    was part of the cache key this served database B a cursor into database A.
    """
    dir_a = tmp_path / "a"
    dir_b = tmp_path / "b"
    dir_a.mkdir()
    dir_b.mkdir()
    repo_a = _build_repo(dir_a, 250)
    repo_b = _build_repo(dir_b, 250)
    page_size = 10
    query = _query(page_size=page_size)
    total = repo_a.count_cases()

    # Warm A up to and past the anchor interval.
    for page in range(1, 12):
        _serve_page(repo_a, query, page, page_size, total)

    # B has never been walked: page 11 must still be right.
    got, _strategy = _serve_page(repo_b, query, 11, page_size, total)

    assert got == _offset_ids(repo_b, query, 11, page_size)


# ── The real endpoint ─────────────────────────────────────────────────────
# Everything above drives the planner and loader directly. These drive
# GET /api/v1/cases, which is the only way to catch list_cases() forgetting to
# pass page_size or total, or its outer `except Exception` swallowing a failure
# into an empty 200.


def _sqlite_app(tmp_path, count):
    """A Flask app whose SQLite repo holds `count` deterministic cases."""
    from immi_case_downloader.web import create_app

    repo = _build_repo(tmp_path, count)   # writes tmp_path/cases.db
    repo.close()
    app = create_app(str(tmp_path), backend="sqlite")
    app.config["TESTING"] = True
    app.config["WTF_CSRF_ENABLED"] = False
    return app


def _http_ids(client, page, page_size, sort_by="year", sort_dir="desc"):
    resp = client.get(
        f"/api/v1/cases?sort_by={sort_by}&sort_dir={sort_dir}"
        f"&page={page}&page_size={page_size}"
    )
    assert resp.status_code == 200, resp.status_code
    body = resp.get_json()
    return [c["case_id"] for c in body["cases"]], body


@pytest.mark.parametrize("page_size", [10, 50])
def test_http_full_walk_matches_the_offset_path(tmp_path, page_size):
    """Every page of a real HTTP walk equals the offset path's window."""
    app = _sqlite_app(tmp_path, 250)
    reference = SqliteRepository(os.path.join(str(tmp_path), "cases.db"))
    query = _query(page_size=page_size)
    total = reference.count_cases()
    total_pages = max(1, (total + page_size - 1) // page_size)

    seen = []
    with app.test_client() as client:
        for page in range(1, total_pages + 1):
            got, body = _http_ids(client, page, page_size)
            assert got == _offset_ids(reference, query, page, page_size), (
                f"HTTP page {page}/{total_pages} does not match the offset path"
            )
            assert body["page_size"] == page_size
            seen.extend(got)

    assert len(seen) == total
    assert len(set(seen)) == total


def test_http_page_size_switch_returns_the_right_window(tmp_path):
    """Walking at one page size then switching must not reuse those anchors."""
    app = _sqlite_app(tmp_path, 250)
    reference = SqliteRepository(os.path.join(str(tmp_path), "cases.db"))

    with app.test_client() as client:
        for page in range(1, 12):
            _http_ids(client, page, 10)
        got, _body = _http_ids(client, 11, 5)

    assert got == _offset_ids(reference, _query(page_size=5), 11, 5)


def test_http_pages_are_correct_after_an_insert(tmp_path):
    """A row added mid-browse must not leave a stale anchor behind."""
    from immi_case_downloader.web.routes.api import _invalidate_cases_cache

    app = _sqlite_app(tmp_path, 250)
    db_path = os.path.join(str(tmp_path), "cases.db")
    reference = SqliteRepository(db_path)
    page_size = 10
    query = _query(page_size=page_size)

    with app.test_client() as client:
        for page in range(1, 12):
            _http_ids(client, page, page_size)

        writer = SqliteRepository(db_path)
        writer.save_many([
            ImmigrationCase(
                case_id="c99999", citation="[2025] AATA 9999", title="Inserted",
                court="AATA", court_code="AATA", date="2025", year=2025,
                url="http://example.test/inserted",
            )
        ])
        writer.close()
        _invalidate_cases_cache()

        total = reference.count_cases()
        got, _body = _http_ids(client, 11, page_size)

    assert total == 251
    assert got == _offset_ids(reference, query, 11, page_size)


def test_http_pages_are_correct_after_a_delete(tmp_path):
    """Deleting a row above the cursor shifts every later row."""
    from immi_case_downloader.web.routes.api import _invalidate_cases_cache

    app = _sqlite_app(tmp_path, 250)
    db_path = os.path.join(str(tmp_path), "cases.db")
    reference = SqliteRepository(db_path)
    page_size = 10
    query = _query(page_size=page_size)

    with app.test_client() as client:
        first_page, _body = _http_ids(client, 1, page_size)
        for page in range(2, 12):
            _http_ids(client, page, page_size)

        writer = SqliteRepository(db_path)
        writer.delete(first_page[0])
        writer.close()
        _invalidate_cases_cache()

        got, _body = _http_ids(client, 11, page_size)

    assert reference.count_cases() == 249
    assert got == _offset_ids(reference, query, 11, page_size)
