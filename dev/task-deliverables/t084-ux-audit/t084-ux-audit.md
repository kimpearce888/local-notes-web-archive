# T-084 — Comprehensive UX Cluelessness Audit (2026-10-14)

**Directive from maintainer:** image insert "is not taking pictures from the pc"; attachment/reminder/etc. buttons "pops out a bar but those does not have close button"; "a lot of areas where a person does not have any clue what they are supposed to do or use that feature" — **find ALL such areas, not a few issues, everything.**

**Method:** five-dimension discovery — (A) closability of every disclosure surface, (B) file-picker flows end-to-end, (C) developer jargon in user-facing copy, (D) guidance/discoverability, (E) dead ends. Static source sweep of every user-facing string + live Playwright walk of every screen and control against the real v1.0.6 dist/ build (the exact code shipped on the releases page), with focused probes and screenshots.

**Result: 8 critical, 7 moderate, 2 low findings.** Every disclosure surface in the product was tested; the complete matrix is below.

---

## SEVERE — a normal user is stuck or blocked

### UX-01 · Attachments panel pops out with no way to close it
The bar that appears under the editor header when you click **Attachments** contains only "Attach files…" — no ×, no Close, no Escape handling, no click-outside dismissal. Verified live: `inSurface=false esc=false reClick=true outside=false`. The ONLY way to dismiss it is clicking the small "Attachments" toggle again — which a user looking at the bar has no reason to know. *(Exactly the maintainer's report.)*
Evidence: `t084-attachments-open.png`

### UX-02 · Snapshots panel — same pattern
No close control, no Escape, no click-outside. Toggle re-click only.

### UX-03 · Reminders panel — same pattern
No close control, no Escape, no click-outside. Toggle re-click only. *(The maintainer's "reminder" report.)*

### UX-04 · AI panel — same pattern
No close control, no Escape, no click-outside. Toggle re-click only.

### UX-05 · Filters panel — no close AND it never goes away after use
The Filters bar below the search box has "Apply filters / Clear all / Save as view…" but no close control and no Escape handling. Worse: clicking **Apply filters** keeps the bar open — after filtering, the bar keeps occupying the screen with no dismiss affordance.

### UX-06 · Insert-image dialog literally asks users for blobs
The Image dialog's second field says *"…or paste a data:image URL"* with placeholder `data:image/png;base64,…`. A normal user reads this as the app asking them for encoded blob data — exactly the maintainer's "it is asking me for blobs" report. The field is useless to ~100% of real users.
Evidence: `t084-insert-image-dialog.png`

### UX-07 · Image picker rejects the most common photo format (HEIC/HEIF)
The file input's accept list is `image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml` — no `heic`/`heif`. iPhone photos (the default camera format, and what Windows "Pictures" libraries commonly contain) are **greyed out in the OS picker**, so for those users "it does not take pictures from the pc." The insert flow itself works correctly with PNG/JPEG (verified live end-to-end) — the format gate is what blocks real photos.

### UX-08 · Tags and categories are unreachable from the editor
The ONLY way to create a tag or category is: go to the list → select note checkbox(es) → bulk bar → "New tags (comma-separated)" / "Or create a new category". There is **no tag UI in the note editor at all** — a user writing a note who wants to tag it will never find this. No tag chips on cards either. (Assign category same path.)

---

## MODERATE — confusing but survivable

### UX-09 · Revisions view ignores Escape
Has a Close button (the only panel that does) but Escape does not dismiss it — inconsistent with every modal dialog in the app.

### UX-10 · AI panel disclosure is developer documentation
Shown to end users verbatim: *"This extension uses an internal, versioned tool contract over LM Studio tool calling. It is not the Model Context Protocol: no server is bound, no stdio or native messaging host is registered, and external MCP clients cannot call…"* — stdio/native-host/MCP vocabulary means nothing to a notes user.
Evidence: `t084-ai-open.png`

### UX-11 · Attachment rows show raw MIME types
Each row displays `image/png · 70 B` — MIME type jargon where users expect "PNG image". Same in the delete confirmation.

### UX-12 · Snapshots copy leans on "MHTML" without explanation
"Export MHTML…", "The full MHTML archive is never rendered inside the dashboard", "The MHTML artifact was not saved in this snapshot." The term is never humanized ("complete saved copy of the page").

### UX-13 · The web-archive feature has no visible entry point
Capturing a page is triggered by **pasting a URL into a note** — the only feedback is a transient toast ("Link saved — 1 capture queued"), onboarding never teaches it, and the Snapshots panel's empty state says links "appear here" without saying how they get there. A user who wants to archive a page has no clue.

### UX-14 · Onboarding explains privacy, not the product
Five points about data locality and no accounts — but no concrete first action ("Create your first note"), no feature tour for notes/tags/capture/reminders/AI.

### UX-15 · Insert-image dialog hides its easier alternatives
Drag-and-drop onto the editor and paste-image both work in the product, but the dialog presents the intimidating data-URL field instead of mentioning them.

---

## LOW

### UX-16 · Empty notes list lacks an inline create button
Says "Notes you create and pages you save will appear here" — guidance text exists, but the obvious "Create your first note" action button is only in the header.

### UX-17 · Diagnostics page uses technical vocabulary
(MHTML/PNG/attachment byte breakdowns.) Acceptable — that page's audience opts into diagnostics.

---

## Verified NOT broken (checked so you don't have to wonder)

| Area | Result |
|---|---|
| Image insert from PC with PNG/JPEG | **Works end-to-end** (live-verified; image node + attachment row + dedup all correct) |
| Attach files → list, download, open | Works (live-verified, real .txt round-trip) |
| Find bar | Has Close button + Escape ✓ |
| Settings dialog | Has Close ✓ |
| Command palette | Native dialog, Escape ✓, "Type a command…" guidance ✓ |
| All modal dialogs (link, import/export MD, rename, delete confirms, snapshot preview, backup) | Cancel/Close in every one ✓ |
| Toolbar controls | Every one of 40+ has a tooltip/accessible name (0 unnamed icon buttons) |
| Reminders / attachments / snapshots empty states | Explain what to do ✓ |
| Dead-end buttons | None found — formatting no-ops on empty notes are standard editor semantics |
| Onboarding re-show | Works (fixed in T-067, re-verified) |

---

## Closability matrix (every disclosure surface in the product)

| Surface | In-surface close | Escape | Re-click toggle | Click outside |
|---|---|---|---|---|
| Attachments panel | ✗ | ✗ | ✓ | ✗ |
| Snapshots panel | ✗ | ✗ | ✓ | ✗ |
| Reminders panel | ✗ | ✗ | ✓ | ✗ |
| AI panel | ✗ | ✗ | ✓ | ✗ |
| Revisions view | ✓ | ✗ | ✓ | ✗ |
| Filters panel | ✗ | ✗ | ✓ | ✗ |
| Find bar | ✓ | ✓ | ✓ | — |
| Settings dialog | ✓ | ✓ | — | — |
| Command palette | ✓ (native) | ✓ | — | — |
| HTML source view | ✓ (toggle) | — | ✓ | — |

## Root pattern

Four editor panels + the filters bar share one design: **toggle-only disclosure with no dismissal affordance in the surfaced bar**. That single systemic pattern accounts for 5 of the 8 severe findings and both of the maintainer's "bar" reports. The fix family is one mechanism (close button in every popped-out surface + Escape handling + close-on-apply for filters), not five separate patches.

## Evidence

- `t084-ux-audit.json` — machine-readable register (40 raw findings incl. filtered false positives)
- `t084-attachments-open.png`, `t084-insert-image-dialog.png`, `t084-ai-open.png`, `t084-revisions-open.png`
- Live run log: closability matrix + file-flow probes printed above (reproducible via `qa-audit/specs/t084-ux-audit.spec.ts` + `t084-probe.mjs`)
