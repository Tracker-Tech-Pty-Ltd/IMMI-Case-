"""Bookmarks / Collections export endpoint.

POST /api/v1/collections/export
  Body: { collection_name, case_ids[], case_notes{} }
  Returns: HTML report for download.
"""

from flask import Blueprint, Response, request
from ..helpers import get_repo, error_response as _error
from ..security import rate_limit

bookmarks_bp = Blueprint("bookmarks", __name__, url_prefix="/api/v1/collections")


def _safe_filename(name: str) -> str:
    """Return a safe filename from collection name."""
    import re

    safe = re.sub(r"[^\w\s-]", "", name).strip()
    safe = re.sub(r"[\s-]+", "_", safe)
    return safe[:80] or "collection"


def _generate_html_report(
    collection_name: str,
    cases: list,
    case_notes: dict,
) -> str:
    """Generate a printable HTML report for a collection."""
    from html import escape

    def field(label: str, value) -> str:
        if not value:
            return ""
        return (
            f"<tr><td class='label'>{escape(label)}</td>"
            f"<td>{escape(str(value))}</td></tr>"
        )

    def concepts_html(concepts_str: str) -> str:
        if not concepts_str:
            return ""
        items = [c.strip() for c in concepts_str.split(";") if c.strip()]
        badges = "".join(
            f"<span class='concept'>{escape(c)}</span>" for c in items
        )
        return f"<div class='concepts'>{badges}</div>"

    case_blocks = []
    for c in cases:
        note = case_notes.get(c.case_id, "") if hasattr(c, "case_id") else ""
        # Support both dict-like and object access
        def _get(obj, attr, default=""):
            if isinstance(obj, dict):
                return obj.get(attr, default) or default
            return getattr(obj, attr, default) or default

        case_blocks.append(f"""
    <div class="case-block">
      <div class="case-header">
        <span class="court-badge">{escape(_get(c, 'court_code'))}</span>
        <span class="citation">{escape(_get(c, 'citation') or _get(c, 'title'))}</span>
      </div>
      <table class="meta">
        {field('Citation', _get(c, 'citation'))}
        {field('Court', _get(c, 'court'))}
        {field('Date', _get(c, 'date'))}
        {field('Outcome', _get(c, 'outcome'))}
        {field('Judge(s)', _get(c, 'judges'))}
        {field('Case Nature', _get(c, 'case_nature'))}
        {field('Visa Type', _get(c, 'visa_type'))}
        {field('URL', _get(c, 'url'))}
      </table>
      {concepts_html(_get(c, 'legal_concepts'))}
      {f'<div class="note"><strong>Note:</strong> {escape(note)}</div>' if note else ''}
    </div>
    """)

    all_cases_html = "".join(case_blocks)
    today = __import__("datetime").date.today().isoformat()

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{escape(collection_name)} — IMMI-Case Report</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
      color: #1a1a2e;
      background: #fff;
      padding: 32px;
      max-width: 860px;
      margin: 0 auto;
    }}
    h1 {{ font-size: 1.5rem; margin-bottom: 4px; }}
    .subtitle {{ color: #666; margin-bottom: 24px; font-size: 12px; }}
    .case-block {{
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
      break-inside: avoid;
    }}
    .case-header {{
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
    }}
    .court-badge {{
      background: #e8f0fe;
      color: #1a56db;
      border-radius: 4px;
      padding: 2px 8px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      white-space: nowrap;
    }}
    .citation {{ font-weight: 600; font-size: 14px; }}
    table.meta {{ width: 100%; border-collapse: collapse; margin-bottom: 8px; }}
    table.meta td {{ padding: 2px 4px; vertical-align: top; }}
    td.label {{ color: #666; font-weight: 500; width: 120px; white-space: nowrap; }}
    .concepts {{ margin-top: 8px; display: flex; flex-wrap: wrap; gap: 4px; }}
    .concept {{
      background: #f1f5f9;
      border-radius: 12px;
      padding: 1px 8px;
      font-size: 11px;
      color: #475569;
    }}
    .note {{
      margin-top: 10px;
      padding: 8px 12px;
      background: #fffbeb;
      border-left: 3px solid #f59e0b;
      border-radius: 0 4px 4px 0;
      font-size: 12px;
      color: #78350f;
    }}
    @media print {{
      body {{ padding: 16px; }}
      .case-block {{ page-break-inside: avoid; }}
    }}
  </style>
</head>
<body>
  <h1>{escape(collection_name)}</h1>
  <p class="subtitle">
    IMMI-Case Export &nbsp;·&nbsp; {len(cases)} case(s) &nbsp;·&nbsp; Generated {today}
  </p>
  {all_cases_html}
</body>
</html>"""


@bookmarks_bp.route("/export", methods=["POST"])
@rate_limit(10, 60, scope="collections-export")
def export_collection():
    """Export a collection as a downloadable HTML report."""
    data = request.get_json(silent=True) or {}
    case_ids = data.get("case_ids", [])
    collection_name = data.get("collection_name", "Collection")
    case_notes = data.get("case_notes", {})

    if not case_ids:
        return _error("case_ids is required")
    if len(case_ids) > 200:
        return _error("Maximum 200 cases per export")

    repo = get_repo()
    cases = [repo.get_by_id(cid) for cid in case_ids]
    cases = [c for c in cases if c is not None]

    if not cases:
        return _error("No valid cases found", 404)

    html = _generate_html_report(collection_name, cases, case_notes)
    safe_name = _safe_filename(collection_name)
    return Response(
        html,
        mimetype="text/html",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_name}.html"'
        },
    )
