# progress.md — Active Task Queue

Contains only incomplete tasks. On completion a task moves to completed.md
(same commit) per ai/rule.md §8. Do not reorder; execute top-down.

## J. Final QA, Playwright & release protocol (post-plan acceptance round)

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
