"""Real Chromium checks for the Legal Codex detail/profile interaction layer.

Screenshots use the isolated case fixture, never production or personal data.
"""

import json
from pathlib import Path

import pytest
from playwright.sync_api import expect

EVIDENCE = Path(".impeccable/review/detail-judges-21st-20261017")
CASE_PATH = "/cases/96ebc92e9afa"
JUDGE_PATH = "/judge-profiles/Senior%20Member%20Jones"


class TestCodexDetailExperience:
    @pytest.mark.parametrize("surface", ["case", "judges", "judge"])
    @pytest.mark.parametrize("dark", [False, True], ids=["light", "dark"])
    @pytest.mark.parametrize("mobile", [False, True], ids=["desktop", "mobile"])
    def test_theme_layout_and_keyboard(self, browser, base_url, surface, dark, mobile):
        context = browser.new_context(
            viewport={"width": 390 if mobile else 1280, "height": 844 if mobile else 900},
            locale="zh-TW",
            base_url=base_url,
        )
        context.add_init_script("localStorage.setItem('i18nextLng', 'zh-TW')")
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        try:
            path = {"case": CASE_PATH, "judges": "/judge-profiles", "judge": JUDGE_PATH}[surface]
            page.goto(path, wait_until="networkidle")
            expect(page.locator("main h1")).to_be_visible()
            if surface == "judges":
                records = page.request.get(
                    "/api/v1/analytics/judge-leaderboard?min_cases=1&name_q=Judge"
                ).json()["judges"]
                assert records
                first_name = records[0].get("display_name") or records[0]["name"]
                page.locator("input[aria-keyshortcuts='/']").fill("Judge")
                expect(page.locator(".codex-judge-results")).to_contain_text(first_name)
            if dark:
                page.locator(".celestial-toggle").click()
            page.wait_for_function(
                "dark => document.documentElement.classList.contains('dark') === dark && "
                "!document.documentElement.classList.contains('theme-transitioning')",
                arg=dark,
            )
            page.wait_for_function("""() => [...document.querySelectorAll('main .codex-sticker img')]
                .filter(img => {const r = img.getBoundingClientRect();
                    return getComputedStyle(img).display !== 'none' && r.top < innerHeight && r.bottom > 0;})
                .every(img => img.complete && img.naturalWidth > 0)""")
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            theme = "dark" if dark else "light"
            size = "mobile" if mobile else "desktop"
            EVIDENCE.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(EVIDENCE / f"{surface}-{size}-{theme}.png"))

            if surface == "case":
                source = page.locator(".codex-detail-toolbar a[target='_blank']")
                assert "austlii.edu.au" in source.get_attribute("href")
                disclosure = page.locator(".codex-disclosure").first
                summary = disclosure.locator("summary")
                summary.press("Enter")
                expect(disclosure).not_to_have_attribute("open")
                summary.press("Enter")
                expect(disclosure).to_have_attribute("open", "")
                expect(disclosure.locator(".codex-disclosure-content")).to_contain_text("character test")

            if surface in ("case", "judge"):
                link = page.locator(".codex-section-nav a").last
                target_id = link.get_attribute("href")[1:]
                link.press("Enter")
                target = page.locator(f"#{target_id}")
                expect(target).to_be_focused()
                expect(link).to_have_attribute("aria-current", "location")
                page.wait_for_function("""id => {
                    const target = document.getElementById(id).getBoundingClientRect();
                    const header = document.querySelector('header').getBoundingClientRect();
                    return target.top >= header.bottom && target.top < innerHeight;
                }""", arg=target_id)

            if surface == "judges":
                toggle = page.locator(".codex-view-rail button").last
                toggle.press("Enter")
                expect(toggle).to_have_attribute("aria-pressed", "true")
                card = page.locator(".codex-judge-card").first
                expect(card).to_be_visible()
                checkbox = card.locator("input[type='checkbox']")
                checkbox.check()
                expect(checkbox).to_be_checked()
                page.screenshot(path=str(EVIDENCE / f"judges-{size}-{theme}-cards.png"))
                assert page.url.endswith("/judge-profiles")
                card.press("Enter")
                expect(page.locator(".codex-judge-hero")).to_be_visible()

            assert errors == []
            (EVIDENCE / f"{surface}-{size}-{theme}.json").write_text(json.dumps({
                "surface": surface, "mobile": mobile, "dark": dark,
                "no_horizontal_overflow": True, "keyboard": "passed", "errors": errors,
            }, indent=2), encoding="utf-8")
        finally:
            context.close()

    def test_compare_selection_survives_view_switch(self, browser, base_url):
        context = browser.new_context(base_url=base_url, viewport={"width": 1280, "height": 900}, locale="en-AU")
        page = context.new_page()
        try:
            page.goto("/judge-profiles", wait_until="networkidle")
            records = page.request.get("/api/v1/analytics/judge-leaderboard?min_cases=1&name_q=Judge").json()["judges"]
            assert len(records) >= 2
            page.locator("input[aria-keyshortcuts='/']").fill("Judge")
            expect(page.locator("tbody tr")).to_have_count(len(records))
            boxes = page.locator("tbody input[type='checkbox']")
            boxes.nth(0).check()
            boxes.nth(1).check()
            page.locator(".codex-view-rail button").last.press("Enter")
            expect(page.locator(".codex-judge-card input:checked")).to_have_count(2)
            page.locator(".codex-compare-bar button").press("Enter")
            expect(page).to_have_url(__import__("re").compile(r"/judge-profiles/compare\?names="))
            for record in records[:2]:
                expect(page.get_by_role("heading", name=record.get("display_name") or record["name"], exact=True)).to_be_visible()
        finally:
            context.close()

    def test_text_reader_and_reduced_motion(self, browser, base_url):
        context = browser.new_context(
            base_url=base_url, viewport={"width": 390, "height": 844},
            reduced_motion="reduce", locale="en-AU",
        )
        page = context.new_page()
        payload = page.request.get(f"/api/v1{CASE_PATH}").json()
        # Exercise the retained reader with explicitly synthetic test text.
        payload["full_text"] = "INTRODUCTION\nSample fixture judgment for reader testing.\nREASONS\nSample fixture evidence.\nORDERS\nSample fixture order."
        page.route(f"**/api/v1{CASE_PATH}", lambda route: route.fulfill(json=payload))
        try:
            page.goto(CASE_PATH, wait_until="networkidle")
            reader = page.locator("#case-full-text")
            expect(reader).to_contain_text("Sample fixture judgment")
            page.locator(".codex-section-nav a[href='#case-full-text']").press("Enter")
            expect(reader).to_be_focused()
            search = reader.get_by_title("Search (Ctrl+F)", exact=True)
            search.click()
            reader.locator("input").fill("Sample")
            expect(reader.locator("mark").first).to_be_visible()
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            animation = page.locator(".codex-dossier-header").evaluate(
                "el => getComputedStyle(el).animationName"
            )
            assert animation == "none"
            page.screenshot(path=str(EVIDENCE / "case-mobile-reader-reduced.png"))
        finally:
            context.close()

    @pytest.mark.parametrize("dark", [False, True], ids=["light", "dark"])
    def test_biography_disclosures_keep_content_and_sources(self, browser, base_url, dark):
        context = browser.new_context(
            base_url=base_url, viewport={"width": 390, "height": 844}, locale="en-AU",
        )
        page = context.new_page()
        # Explicitly synthetic biography to exercise optional fields without
        # inventing biography data in the product or persisting it to storage.
        bio = {
            "found": True, "full_name": "Fixture Member", "role": "Test role",
            "court": "Test tribunal", "registry": "Test registry",
            "education": ["Fixture law degree"],
            "previously": "Fixture first role; Fixture second role",
            "current_role_desc": "Fixture current role description",
            "notable_cases": [{"citation": "[TEST] 1", "description": "Fixture case note"}],
            "social_media": {"university_page": "https://example.org/university-fixture"},
            "source_url": "https://example.org/source-fixture",
        }
        page.route("**/api/v1/analytics/judge-bio**", lambda route: route.fulfill(json=bio))
        try:
            page.goto(JUDGE_PATH, wait_until="networkidle")
            expect(page.get_by_role("heading", name="Fixture Member")).to_be_visible()
            hero = page.locator(".codex-judge-hero")
            expect(hero.locator(".codex-disclosure")).to_have_count(3)
            for text in ["Fixture law degree", "Fixture first role", "Fixture second role", "Fixture case note"]:
                expect(hero.get_by_text(text, exact=True)).to_be_visible()
            first = hero.locator(".codex-disclosure").first
            first.locator("summary").press("Enter")
            expect(first).not_to_have_attribute("open")
            first.locator("summary").press("Enter")
            expect(first).to_have_attribute("open", "")
            expect(hero.locator("a[href='https://example.org/source-fixture']")).to_have_count(1)
            expect(hero.locator("a[href='https://example.org/university-fixture']")).to_have_count(1)
            if dark:
                page.locator(".celestial-toggle").click()
            page.wait_for_function("dark => document.documentElement.classList.contains('dark') === dark && !document.documentElement.classList.contains('theme-transitioning')", arg=dark)
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            page.screenshot(path=str(EVIDENCE / f"judge-mobile-bio-{'dark' if dark else 'light'}.png"))
        finally:
            context.close()
