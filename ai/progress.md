# progress.md — Active Task Queue

Contains only incomplete tasks. On completion a task moves to completed.md
(same commit) per ai/rule.md §8. Do not reorder; execute top-down.

## K. User-reported bug-fix round

### T-055 Re-release v1.0.2 with the T-054 fixes
The v1.0.1 release artifact predates the T-054 user-reported fixes
(reminder dialog field sizing + editor pin/trash). Bump package.json +
public/manifest.json + src/core/version.ts to 1.0.2, update the version
pinning tests and README install links, rebuild dist, re-run the full
gate battery, regenerate the release zip, run the full Playwright suite
(including zip-acceptance against the NEW artifact), publish GitHub
Release v1.0.2 with the three assets, refresh the verification docs
numbers, and verify the uploaded asset digest through the REST API.
