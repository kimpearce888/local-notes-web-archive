# progress.md — Active Task Queue

Contains only incomplete tasks. On completion a task moves to completed.md
(same commit) per ai/rule.md §8. Do not reorder; execute top-down.

## J. Final QA, Playwright & release protocol (post-plan acceptance round)


### T-049 Complete repository audit
Full audit: structure/stats, commit history, secrets scan (worktree + git
history), npm audit over pinned deps, permission/CSP verification re-run,
docs completeness, release artifact integrity re-verification.

### T-050 Professional screenshots from the live extension
Load the built extension, seed realistic demo data through the real UI,
capture retina screenshots (dashboard light/dark, editor, search, diagnostics)
plus a 1280x640 social banner into docs/screenshots/.

### T-051 Marketing-ready README and GitHub metadata
Production-first README rewrite (badges, screenshots, features, install,
quality numbers, FAQ, SEO/SMO) + GitHub repo description/topics/homepage via
the REST API; docs tests green.
