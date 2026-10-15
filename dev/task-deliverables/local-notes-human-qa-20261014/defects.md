# Defects — reproducible failures with evidence

Classification legend: **[FACT]** observed runtime behavior (reproduced); **[CODE]** code-inspection finding; **[REQ]** requirement mismatch vs PRD/FR; **[HYP]** hypothesis (not proven).

---

## D-01 — Favorites is unreachable: no UI control can set the favorite flag

- **Severity:** High (requirement mismatch; feature advertised in PRD and partially built)
- **Class:** [FACT] + [REQ]
- **Requirement:** PRD FR-NOTE-05 "Provide pinning, favorites, archive, trash, restore and duplicate." (§4.2/§4.1 also list favorites; the Favorites smart list and the card 'Favorite' badge exist.)
- **Repro (100% / 3 attempts):**
  1. Open the dashboard with at least one note.
  2. Enumerate every control on the card (DOM dump), in the bulk bar with the note selected, and in the editor session header.
  3. Observe: no control offers favorite/unfavorite. The only flag setters anywhere in the UI are Pin/Unpin (bulk bar + editor header), which call `notes/set-flags` with `pinned` only.
- **Expected:** a favorite toggle on card/bulk/editor (as pin has). **Actual:** the Favorites smart list renders an honest permanent empty state; `favorite` is only settable through import/AI code paths, never by a human user.
- **Evidence:** `evidence/pass-b-shell/session-evidence.json` — `card controls`, `bulk bar buttons`, `editor session header buttons` enumerations; `B3` test; screenshot `B2-pinned-list.png` context.
- **Root cause [CODE]:** `src/dashboard/views/bulk-bar.ts` action union has no favorite kind; `editor-session.ts` `setPinned` wires `pinned` only; the background (`notes/set-flags`, `search/query` filters, `is:favorite` operator) fully supports it — the UI layer never exposes it.
- **Suggested fix (for the maintainer; not applied):** add `{ kind: 'favorite'; value: boolean }` to the bulk action union + button, and a Favorite editor-header action mirroring Pin.

---

## D-02 — The Filters disclosure opens an empty region (FR-SEARCH-03 has no UI)

- **Severity:** High (requirement mismatch; misleading control)
- **Class:** [FACT] + [REQ]
- **Requirement:** PRD FR-SEARCH-03 (date ranges, tags, categories, pinned/favorite, states, reminder states, links/snapshot/attachment presence, capture date, source domain; combinable, savable as named views) and §4.1 "Global search field and filter controls."
- **Repro (100% / 4 attempts, with and without data):**
  1. Click the topbar **Filters** button.
  2. Observe: `aria-expanded="true"`, the `#filters-region` becomes visible — and contains **0 child elements** (innerHTML length 0).
  3. Type an operator search (`title:zebra`): the `#active-filters` chips region also stays empty (0 children).
- **Expected:** filter controls (checkboxes/ranges/selects) and combinable/saved views. **Actual:** a disclosure that visibly "opens" nothing — a control that implies function the product does not have.
- **Evidence:** `evidence/pass-a-discovery/session-evidence.json` ("Filters clicked: aria-expanded=true … region child elements=0"), `evidence/pass-b-shell/session-evidence.json` (same with data + chips=0); screenshots `A6-filters-disclosure-open.png`, `B5-filters-open-with-data.png`.
- **Root cause [CODE]:** `src/dashboard/shell.ts` creates `filtersRegion` (lines ~354-357) and toggles it, but nothing ever appends filter controls to it; `filtersToggle` is emitted with **no listener** in the controller (`rg "filtersToggle" src/dashboard/state/` → only shell.ts hits). Saved views likewise have no implementation anywhere in `src/dashboard/`.
- **Note (honesty):** the underlying filter engine exists (`Filters` in search API supports all FR fields; `is:`/`tag:`/`title:` operators work from the search box) — only the dedicated UI is missing.

---

## D-03 — Sort direction is fixed descending; no ascending control (FR-SEARCH-06)

- **Severity:** Medium (requirement mismatch)
- **Class:** [FACT] + [REQ]
- **Requirement:** PRD FR-SEARCH-06 "…ascending/descending where meaningful."
- **Repro (100%):** sort by Title with notes 'Audit Alpha zebra' and 'Audit Gamma xray' → first card is **Gamma** (reverse-alphabetical). No asc/desc control exists anywhere in the toolbar or settings (settings' default-sort radios also omit direction; `store.ts` hard-codes `direction: 'desc'`).
- **Evidence:** `evidence/pass-b-shell/session-evidence.json` — `sort=Title -> first card: Audit Gamma xray`; toolbar DOM dump shows only the 6-option field select; `B6-before-sort.png`.
- **Root cause [CODE]:** `DashboardStore` state `sort: { field: 'modified', direction: 'desc' }` with no UI mutation path for direction.

---

## D-04 — Attachments are broken end-to-end: File/Blob cannot cross the RPC transport

- **Severity:** Critical (feature completely broken in the built artifact)
- **Class:** [FACT] + [CODE]
- **Requirement:** PRD FR-NOTE-08/attachments pipeline (T-019); documented in README/PRD as working.
- **Repro (100% / 4 attempts across two sessions):**
  1. Open a note → **Attachments** panel → **Attach files…** → choose any real file (e.g. `audit-attachment-alpha.txt`, 40 bytes).
  2. Observe the panel status: **`attachments/add: data must be a Blob`**; no attachment row appears; the empty state remains.
- **Expected:** attachment listed with Download/Open/Rename/Delete actions. **Actual:** RPC rejection every time.
- **Downstream blast radius:** the image dialog's **file-picker path** (`onAttachImage` → same `attachFile` → raw File over the wire) is equally dead; only the data-URL paste path works (E6 PASS). Download/Open/Rename/Delete are unreachable because no attachment can exist. P2 recorded BLOCKED for the same reason.
- **Evidence:** `evidence/pass-b-panels/session-evidence.json` ("DEFECT D-04: after attaching a real file the panel says: … data must be a Blob"); screenshot `P1-DEFECT-attach-fails-blob-transport.png`; probe `evidence/probe-attach/session-evidence.json`.
- **Root cause [CODE, evidence-backed]:** `editor-session.ts:253-258` sends the raw `File` object as the `data` payload through `client.request('attachments/add', …)`, whose transport (`src/dashboard/state/client.ts:27-39`) is `chrome.runtime.sendMessage` — a structured-clone JSON channel that silently converts the `File` to `{}`. The background handler (`src/background/api/attachments.ts:88-90`) guards `data instanceof Blob` and truthfully rejects. Unit tests passed because they inject a fake transport that preserves objects.
- **Suggested fix (not applied):** read the file bytes client-side (e.g. base64 or ArrayBuffer in the JSON envelope) and rebuild a Blob in the service worker, or switch binary RPCs to a Blob-capable channel.

---

## D-05 — Re-shown onboarding's "Get started" is permanently disabled

- **Severity:** Medium (functional bug; Escape-only exit)
- **Class:** [FACT] + [CODE]
- **Requirement:** Settings advertises "Show the introduction again"; onboarding must be dismissible by its primary action.
- **Repro (100% / 3 attempts):**
  1. Settings → **Show the introduction again** (settings closes itself, onboarding re-opens).
  2. Inspect the primary button: `<button disabled …>Get started</button>` — and it stays disabled forever (waited 13 s + retried click).
  3. Only **Escape** closes the re-shown dialog.
- **Expected:** clicking Get started completes onboarding and closes the dialog. **Actual:** the button is disabled from the moment the dialog is re-presented.
- **Evidence:** `evidence/pass-b-panels/session-evidence.json` ("DEFECT D-05: re-shown onboarding 'Get started' enabled=false"); screenshots `P8-onboarding-reshown.png`, `P8-DEFECT-onboarding-get-started-disabled.png`; probe `evidence/probe-onboarding/` (locator resolved to `<button disabled …>`).
- **Root cause [CODE]:** `src/dashboard/views/onboarding.ts:105-118` — the click handler sets `startButton.disabled = true` and only re-enables it inside the `.catch()` failure branch. After the FIRST successful completion the overlay instance (and its button) persist in the DOM, so the re-show presents the already-spent disabled button.

---

## D-06 — Backup export and restore are broken (same RPC transport class as D-04)

- **Severity:** Critical (the documented durability path is dead in the built artifact)
- **Class:** [FACT] + [CODE]
- **Requirement:** PRD FR-DATA-01/02 (backup export/restore); KNOWN_LIMITATIONS.md names backup export → restore as "the supported path" for data safety.
- **Repro export (100% / 3 attempts):**
  1. Settings → **Export backup now**.
  2. Observe status: **`Backup failed: Failed to execute 'createObjectURL' on 'URL': Overload resolution failed.. Your notes are unchanged.`** — no download event ever fires.
- **Repro restore (100% / 1 attempt):**
  1. Settings → **Restore backup…** → choose any `.zip` file.
  2. The preview RPC fails: **`archive: expected the backup file (a Blob)`** — the review dialog never appears.
- **Expected:** a downloaded backup archive; a restore review dialog. **Actual:** both directions fail; the failures ARE reported honestly and the library stays intact (verified).
- **Evidence:** `evidence/pass-c-workflows/session-evidence.json` (D-06a/D-06b notes); screenshots `C4-DEFECT-backup-export-fails.png`, `C4-DEFECT-backup-restore-fails.png`; probe `evidence/probe-backup/session-evidence.json`.
- **Root cause [CODE, evidence-backed]:** same transport as D-04 in both directions — (a) export: the service worker builds the archive Blob and returns it through the JSON RPC channel; it arrives as `{}` and `URL.createObjectURL({})` throws; (b) restore: the dashboard sends the raw `File` as `archive`, and `backup/preview`'s `blob instanceof Blob` guard rejects it. The settings copy (`Backup failed: … Your notes are unchanged.`) is truthful.
- **Consequence note:** with D-04 also blocking attachments, **every binary-data feature in the product is non-functional in the shipped build** while every text feature works — a consistent, single-root-cause class.

---

## D-07 — Page-1 slice invariant breaks after rapid creation (state consistency)

- **Severity:** Low–Medium (no data loss; self-heals)
- **Class:** [FACT] + [CODE]
- **Repro (100% / 2 attempts):**
  1. From an empty library, click **New Note** 52 times (or 49 with 2 existing).
  2. Observe: **52 cards render on "Page 1 of 2"** with the pagination chrome claiming "Showing 1–52 of 52 · Page 1 of 2".
  3. Reload → correct "Showing 1–50 of 52" with exactly 50 cards; Next page shows 2.
- **Expected:** page 1 always renders at most `pageSize` (50) notes. **Actual:** every created note is prepended to the in-memory page slice regardless of the page boundary; the chrome text (computed from `notes.length`) contradicts the invariant until a requery happens.
- **Evidence:** `evidence/pass-b-shell/session-evidence.json` ("DEFECT: page-1 card count after rapid creation = 51 … pagination says …"); screenshots `B8-page-1-overflow-defect.png`, `B8-page-1-full.png`; probe `evidence/probe-b8/session-evidence.json`.
- **Root cause [CODE]:** `controller.ts createNote()` optimistically prepends the new note to `state.notes` (and later swaps the placeholder) without re-running the paginated `requery()` — correct for the first 50 notes, slice-violating beyond.

---

## G-07 — UX observation (not counted as a defect): theme preference reverts if Settings closed without saving

- Theme radios apply live, but persistence happens only through **Save changes**; closing the dialog discards the choice silently (the hint text does disclose: "Applies immediately; saved with the other changes."). A user who changes theme and presses Close (or Escape) loses the preference on next load. Verified in P7/F1 iterations (first F2 restart showed `system` until Save was added to the flow). Evidence: `evidence/pass-f-persistence/` history + `P7-settings-dark-live.png`.

## INCONCLUSIVE-1 — Input-stall phenomenon after rich-note revision restore (tooling)

- After restoring a revision of a heavily-formatted note, Playwright-dispatched pointer/keyboard input intermittently stalled (e.g. Reminders toggle, dialog primary) while `page.evaluate` kept working and the DOM was verified clean (no dialogs, buttons visible+enabled, hit-test passes). Reproduction rate ~2 of 6 sessions; the same interactions are fast in fresh sessions (probe-restore: 24–225 ms). The reminders lifecycle was re-run green in a dedicated session (R1–R6). Root cause undetermined [HYP]: renderer load or a product re-render loop — flagged for developer investigation, honestly NOT counted as a product defect. Evidence: `pass-b-panels` P4 record + `P4-start-state.png`; fallback notes across session logs.

---

## Explicitly NOT defects (verified honest behavior)

- `javascript:` link refusal, remote-image non-fetch, XSS title inertness (repo suites + E5).
- Malformed/empty import failures with library intact (C3/D8).
- LM Studio absence → input/send disabled + truthful test failures (P6/P8/P9).
- Offline operation fully working (pass-d D7).
- Multi-tab conflict surfacing (X3) and background-trash save failure (X4).
- Confirm-dialog cancel safety across every destructive operation (D3/E10/R5/P9).
