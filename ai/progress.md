# progress.md — Active Task Queue

Contains only incomplete tasks. On completion a task moves to completed.md
(same commit) per ai/rule.md §8. Do not reorder; execute top-down.

## Queue

### T-061 Re-release v1.0.4 with the T-060 fixes
See ai/plan.md §J for the full task description. Version bump 1.0.3 -> 1.0.4
in all five authoritative places + three version-pinning tests + docs zip pins;
release-notes template gains the v1.0.4 section with corrected gate numbers
(797/797 vitest, 58/58 Playwright); full gate battery on the final code
(including zip-acceptance against the NEW artifact); npm run release; publish
GitHub Release v1.0.4 with three assets and verify the digest byte-identical;
re-verify docs/RELEASE_VERIFICATION.md for 1.0.4; regenerate
docs/REPOSITORY_AUDIT.md at the final HEAD; move to completed.md same commit.
