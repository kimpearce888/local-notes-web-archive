# progress.md — Active Task Queue

Contains only incomplete tasks. On completion a task moves to completed.md
(same commit) per ai/rule.md §8. Do not reorder; execute top-down.

## J. Final QA, Playwright & release protocol (post-plan acceptance round)

### T-053 Re-release v1.0.1 with the T-052 fix and final protocol re-run
The v1.0.0 release artifact predates the T-052 hidden-attribute bug fix (dist
was rebuilt but the zip was not regenerated). Bump package.json +
public/manifest.json to 1.0.1, rebuild the production dist, re-run the full
gate battery (eslint, tsc strict, vitest, perf), regenerate the release zip
via npm run release (new sha256), run the full Playwright suite (including
zip-acceptance against the NEW artifact), publish GitHub Release v1.0.1 with
the three assets via npm run publish-release, update README install links and
docs pins to 1.0.1, regenerate docs/REPOSITORY_AUDIT.md at the final HEAD,
and verify the uploaded asset digest through the REST API.
