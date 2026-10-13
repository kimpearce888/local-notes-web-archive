# progress.md — Active Task Queue

Contains only incomplete tasks. On completion a task moves to completed.md
(same commit) per ai/rule.md §8. Do not reorder; execute top-down.

## J. Final QA, Playwright & release protocol (post-plan acceptance round)

### T-044 Production rebuild and full-suite baseline
Fresh `npm run build`; `npm run verify` (lint + tsc strict + full vitest);
`npm run test:e2e` over the real dist/ in persistent Chromium — re-verify every
existing gate before new coverage lands. Zero failures allowed.

### T-045 Human-simulation and adversarial Playwright suite
New E2E spec driving the app exactly like a real user: fast/repeated clicks,
invalid and empty inputs, malicious inputs (XSS payloads via real clipboard
paste, javascript: URL in the link dialog), multiple dashboard tabs, full
browser-restart persistence, navigation sweep, permanent delete from Trash,
theme persistence across reload, zero uncaught page errors and zero
non-loopback network requests. Persona coverage: new/returning/power/
invalid-malicious users (auth N/A — account-less by design, PRD §1).

### T-046 ZIP package acceptance test (extract → load → use)
Extract `release/local-notes-web-archive-1.0.0.zip` into a scratch directory
with fflate, verify inventory against RELEASE_MANIFEST.txt, load the EXTRACTED
folder (not dist/) as an unpacked extension in a fresh persistent context,
verify installation, service worker, dashboard shell, note create/save/search,
settings dialog — no build steps, usable immediately after extraction.

### T-047 Release packaging and GitHub Release with ZIP upload
Regenerate the release artifact (`npm run release`); create GitHub Release
v1.0.0 (tag on main) via the GitHub REST API using credentials read at runtime
from the local git credential store (never committed); upload the ZIP +
checksum + manifest as release assets; verify release and asset URLs; add the
download/install workflow to README.
