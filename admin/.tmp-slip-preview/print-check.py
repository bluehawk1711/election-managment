"""Live print-path check for the voter slip (run with Python 3.14 + playwright).

Logs into the panel, opens a slip from the voter list, switches the page to
PRINT media (which is what window.print() snapshots), then reports:

  * whether the slip paper is visible while the list behind it is gone
  * a screenshot of exactly what the print dialog will put on paper
  * the real printed PDF, page count included (via page.pdf())

`print_background=False` mirrors Chrome's default ("Background graphics"
unticked), which is the case the slip's print-color-adjust has to survive.
"""
import json
import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
EMAIL = "gauravdadhich34@gmail.com"
PASSWORD = "1234567890"

PROBE = """
() => {
  const q = (s) => document.querySelector(s);
  const info = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { display: cs.display, visibility: cs.visibility,
             rect: [r.x, r.y, r.width, r.height].map(Math.round) };
  };
  return {
    slip: info(q('.slip-slip')),
    overlay: info(q('.slip-overlay')),
    modal: info(q('.slip-modal')),
    toolbar: info(q('.slip-toolbar')),
    header: info(q('.slip-header')),
    statusBar: info(q('.slip-statusBar')),
    firstRow: info(q('main [role="button"]')),
    sidebar: info(q('aside')),
    badge: info(q('.slip-badge')),
    badgeBg: q('.slip-badge') ? getComputedStyle(q('.slip-badge')).backgroundColor : null,
    heading: q('.slip-slip h1') ? q('.slip-slip h1').textContent : null,
    hasCandidate: !!q('[class*="candidate"]'),
  };
}
"""


def main() -> int:
    out = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        ctx = browser.new_context(viewport={"width": 1400, "height": 900})
        page = ctx.new_page()

        page.goto(f"{BASE}/login", wait_until="domcontentloaded")
        page.fill("input[type=email]", EMAIL)
        page.fill("input[type=password]", PASSWORD)
        page.click("button[type=submit]")
        page.wait_for_selector("aside", timeout=60000)

        page.goto(f"{BASE}/voters", wait_until="domcontentloaded")
        page.wait_for_selector('button:has-text("पर्ची")', timeout=120000)
        page.locator('button:has-text("पर्ची")').first.click()
        page.wait_for_selector('[role=dialog]', timeout=30000)

        # What window.print() will snapshot.
        page.emulate_media(media="print")
        page.wait_for_timeout(400)
        out["print"] = page.evaluate(PROBE)

        page.screenshot(path="print-screen.png")

        page.pdf(path="slip-live.pdf", format="A4", print_background=False)
        browser.close()

    data = open("slip-live.pdf", "rb").read()
    out["pdf"] = {
        "bytes": len(data),
        "pages": data.count(b"/Type /Page") - data.count(b"/Type /Pages"),
        "header": data[:8].decode("latin-1"),
    }
    print(json.dumps(out, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
