/**
 * Production artifact steps for the capture queue (FR-CAP-05/07/08/09).
 *
 * T-023: the snapshot record (source URL, validated final URL, title,
 * timestamp, content hash, format, per-artifact states, warnings) plus the
 * MHTML archive itself — `chrome.pageCapture.saveAsMHTML` on the queue's
 * temporary tab, stored as a content-addressed blob.
 * T-024: the extracted visible text — a narrowly scoped, self-contained
 * extractor injected through `chrome.scripting` after a brief post-load
 * settle, its untrusted result re-validated field by field, stored
 * separately from the archive so search never parses MHTML (FR-CAP-09);
 * the page-declared canonical URL and a refined title ride along, and the
 * note's search projection is re-indexed after artifacts land
 * (FR-SEARCH-01/05).
 * The CDP full-page PNG (T-025, FR-CAP-10) rides the temporary tab through
 * a hard-allowlisted debugger session with tiled capture under the pixel
 * budget; its failures keep the MHTML archive and extracted text intact
 * and are explained on the record.
 *
 * Truthfulness rules this module guarantees:
 *
 * - The snapshot record exists before any artifact work starts, so a cancel
 *   or timeout always has a record to finalize.
 * - A failed artifact NEVER overwrites a previously saved one: artifact
 *   writes are per-field and the record is only advanced `pending → saved`
 *   on verified bytes.
 * - Cancellation wins over failure reporting: if the queue already canceled
 *   the job, a step that never concluded stays `pending`/`canceled` instead
 *   of being relabeled `failed`.
 * - Saved bytes survive a late cancellation: if the MHTML blob arrives after
 *   the user canceled, it is still stored — the record then truthfully shows
 *   a partial capture rather than discarding data.
 */

import { repo, searchEngine } from '../db';
import type { CaptureSteps, CaptureRunContext, CaptureStepOutcome } from './queue';
import type { DrivenTab } from './tab-driver';
import {
  addSnapshotWarning,
  createSnapshot,
  getSnapshot,
  markMhtmlArtifact,
  markPngArtifact,
  markTextArtifact,
  renameSnapshot,
  saveMhtmlArtifact,
  savePngArtifact,
  saveTextArtifact,
  setSnapshotCanonicalUrl,
} from '../../core/repo/snapshots';
import { getNote } from '../../core/repo/notes';
import { extractReadableTextInPage, MAX_TEXT_CHARS } from './extract-core';
import { capturePngArtifact } from './cdp';
import type { CaptureWarning, EntityId, Snapshot } from '../../core/types';

const MAX_RECORDED_WARNING_DETAIL = 300;

/** Post-load settle before text extraction (late hydration/lazy layout). */
const SETTLE_MS = 300;

/** Title refinement bound — pages can carry enormous <title> junk. */
const TITLE_MAX = 500;

export interface ProductionCaptureStepsOptions {
  /** Settle override (tests use 0 to keep the suite fast). */
  readonly settleMs?: number;
}

/** Warnings keep their detail bounded even when Chrome hands us a novel error. */
function boundedDetail(detail: string): string {
  return detail.length <= MAX_RECORDED_WARNING_DETAIL
    ? detail
    : `${detail.slice(0, MAX_RECORDED_WARNING_DETAIL)}…`;
}

/** Only advance an artifact out of `pending`; a cancel that already landed wins. */
async function markIfPending(
  snapshotId: Snapshot['id'],
  field: 'mhtml' | 'png' | 'text',
  state: 'failed' | 'not-attempted',
): Promise<void> {
  const current = await getSnapshot(await repo(), snapshotId);
  if (!current) return; // record gone (deleted) — nothing to relabel
  if (current[field] !== 'pending') return;
  if (field === 'mhtml') await markMhtmlArtifact(await repo(), snapshotId, state);
  else if (field === 'png') await markPngArtifact(await repo(), snapshotId, state);
  else await markTextArtifact(await repo(), snapshotId, state);
}

/**
 * Capture the MHTML archive of the driven tab and persist it.
 * Returns the warning recorded for a failed attempt, or null on success.
 */
async function captureMhtml(
  context: CaptureRunContext,
  tab: DrivenTab,
  snapshotId: Snapshot['id'],
): Promise<{ saved: boolean; warning: CaptureWarning | null; detail: string }> {
  let blob: Blob | undefined;
  try {
    blob = await chrome.pageCapture.saveAsMHTML({ tabId: tab.tabId });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await markIfPending(snapshotId, 'mhtml', 'failed');
    return {
      saved: false,
      warning: { kind: 'resource-failure', detail: boundedDetail(`pageCapture failed: ${reason}`) },
      detail: `the MHTML capture failed (${boundedDetail(reason)})`,
    };
  }

  if (blob === undefined || blob.size === 0) {
    await markIfPending(snapshotId, 'mhtml', 'failed');
    return {
      saved: false,
      warning: { kind: 'resource-failure', detail: 'Chrome returned an empty MHTML archive' },
      detail: 'the MHTML archive was empty',
    };
  }

  const budget = context.settings.capture.maxArchiveBytes;
  if (blob.size > budget) {
    // FR-CAP-03 size budget: refuse to store, keep the record truthful.
    await markIfPending(snapshotId, 'mhtml', 'failed');
    return {
      saved: false,
      warning: {
        kind: 'oversized',
        detail: `the archive (${blob.size} bytes) exceeds the capture size budget (${budget} bytes)`,
      },
      detail: `the MHTML archive exceeded the size budget (${blob.size} > ${budget} bytes)`,
    };
  }

  try {
    const saved = await saveMhtmlArtifact(await repo(), snapshotId, blob);
    return { saved: true, warning: null, detail: `MHTML archive saved (${saved.mhtmlSize} bytes)` };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await markIfPending(snapshotId, 'mhtml', 'failed');
    return {
      saved: false,
      warning: { kind: 'resource-failure', detail: boundedDetail(`storing the archive failed: ${reason}`) },
      detail: `storing the MHTML archive failed (${boundedDetail(reason)})`,
    };
  }
}

const EXTRACTION_WARNING_KINDS: readonly CaptureWarning['kind'][] = [
  'resource-failure',
  'unsupported-frame',
  'lazy-content',
  'oversized',
  'access-restricted',
  'redirect',
  'screenshot-limits',
];

/** Extraction result after allowlist validation — kinds are narrowed here. */
interface ValidatedExtraction {
  readonly text: string;
  readonly title: string;
  readonly canonicalUrl: string | null;
  readonly warnings: CaptureWarning[];
}

/**
 * Re-validate the in-page extraction result: page content is untrusted
 * input (prompt-injection surface, PRD §9) — every field is bounded and
 * allowlisted before it reaches storage.
 */
function validateExtraction(raw: unknown): ValidatedExtraction | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate['text'] !== 'string' || candidate['text'].length > MAX_TEXT_CHARS + 1024) return null;
  if (typeof candidate['title'] !== 'string' || candidate['title'].length > TITLE_MAX + 1024) return null;
  const canonical = candidate['canonicalUrl'];
  if (canonical !== null && typeof canonical !== 'string') return null;
  if (typeof canonical === 'string' && (!/^https?:\/\//i.test(canonical) || canonical.length > 2000)) return null;
  const rawWarnings = candidate['warnings'];
  if (!Array.isArray(rawWarnings) || rawWarnings.length > 32) return null;
  const warnings: Array<{ kind: CaptureWarning['kind']; detail: string }> = [];
  for (const entry of rawWarnings) {
    if (typeof entry !== 'object' || entry === null) continue;
    const kind = (entry as Record<string, unknown>)['kind'];
    const detail = (entry as Record<string, unknown>)['detail'];
    if (typeof kind !== 'string' || !EXTRACTION_WARNING_KINDS.includes(kind as CaptureWarning['kind'])) continue;
    if (typeof detail !== 'string') continue;
    warnings.push({ kind: kind as CaptureWarning['kind'], detail: boundedDetail(detail) });
  }
  return {
    text: candidate['text'],
    title: candidate['title'].slice(0, TITLE_MAX),
    canonicalUrl: typeof canonical === 'string' ? canonical : null,
    warnings,
  } as ValidatedExtraction;
}

/** Injected-script failure text (Chrome error shapes vary). */
function scriptFailureDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Extract the visible readable text from the driven tab (FR-CAP-09):
 * settle briefly after load, inject the self-contained extractor through
 * chrome.scripting in the page's ISOLATED world, validate the untrusted
 * result and store it separately from the archive so search never parses
 * MHTML. Title refinement and the page-declared canonical URL ride along.
 */
async function extractText(
  context: CaptureRunContext,
  tab: DrivenTab,
  snapshotId: Snapshot['id'],
  settleMs: number,
): Promise<{ saved: boolean; warnings: CaptureWarning[]; details: string[] }> {
  const warnings: CaptureWarning[] = [];
  const details: string[] = [];

  // Post-load settle, always inside the remaining job budget.
  const settle = Math.min(settleMs, Math.max(context.remainingMs() - 2000, 0));
  if (settle > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, settle));
    if (context.isCanceled()) return { saved: false, warnings, details: ['text extraction skipped (canceled)'] };
  }

  let extraction: ValidatedExtraction | null;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.tabId },
      func: extractReadableTextInPage,
      args: [MAX_TEXT_CHARS],
    });
    extraction = validateExtraction(results[0]?.result);
    if (extraction === null) {
      details.push('the page returned an unusable extraction result');
    }
  } catch (error) {
    const reason = scriptFailureDetail(error);
    await markIfPending(snapshotId, 'text', 'failed');
    warnings.push({ kind: 'resource-failure', detail: boundedDetail(`text extraction failed: ${reason}`) });
    details.push(`text extraction failed (${boundedDetail(reason)})`);
    return { saved: false, warnings, details };
  }

  if (extraction === null) {
    await markIfPending(snapshotId, 'text', 'failed');
    warnings.push({ kind: 'resource-failure', detail: 'the extraction result failed validation' });
    return { saved: false, warnings, details };
  }

  for (const warning of extraction.warnings) warnings.push(warning);

  try {
    await saveTextArtifact(await repo(), snapshotId, extraction.text);
    details.push(`extracted text saved (${extraction.text.length} characters)`);
  } catch (error) {
    const reason = scriptFailureDetail(error);
    await markIfPending(snapshotId, 'text', 'failed');
    warnings.push({ kind: 'resource-failure', detail: boundedDetail(`storing the extracted text failed: ${reason}`) });
    details.push(`storing the extracted text failed (${boundedDetail(reason)})`);
    return { saved: false, warnings, details };
  }

  // Canonical URL and title refinement are metadata refinements — their
  // failure must never fail the text artifact itself.
  if (extraction.canonicalUrl !== null) {
    try {
      await setSnapshotCanonicalUrl(await repo(), snapshotId, extraction.canonicalUrl);
    } catch (error) {
      console.error('[capture] recording the canonical URL failed', error);
    }
  }
  const refinedTitle = extraction.title.trim();
  if (refinedTitle.length > 0) {
    try {
      const current = await getSnapshot(await repo(), snapshotId);
      if (current !== null && current.title !== refinedTitle) {
        await renameSnapshot(await repo(), snapshotId, refinedTitle);
      }
    } catch (error) {
      console.error('[capture] refining the snapshot title failed', error);
    }
  }

  return { saved: true, warnings, details };
}

/** Keep the search projection consistent with the saved snapshot (FR-SEARCH-05). */
async function reindexNote(noteId: EntityId): Promise<void> {
  try {
    const note = await getNote(await repo(), noteId);
    if (note !== null) {
      const engine = await searchEngine();
      await engine.indexNote(note);
    }
  } catch (error) {
    console.error('[capture] re-indexing the note after capture failed', error);
  }
}

/**
 * Full-page PNG through the debugger API on the temporary tab (T-025,
 * FR-CAP-10): hard CDP allowlist, tiling under the pixel budget, honest
 * failure states that never disturb the saved MHTML/text artifacts.
 */
async function capturePng(
  context: CaptureRunContext,
  tab: DrivenTab,
  snapshotId: Snapshot['id'],
): Promise<{ saved: boolean; warnings: CaptureWarning[]; details: string[] }> {
  const warnings: CaptureWarning[] = [];
  const details: string[] = [];
  if (context.isCanceled()) {
    await markIfPending(snapshotId, 'png', 'not-attempted');
    return { saved: false, warnings, details: ['screenshot skipped (canceled)'] };
  }

  const result = await capturePngArtifact(tab.tabId, context.settings);
  warnings.push(...result.warnings);
  details.push(result.detail);

  if (result.png === null) {
    await markIfPending(snapshotId, 'png', 'failed');
    return { saved: false, warnings, details };
  }

  try {
    await savePngArtifact(await repo(), snapshotId, result.png);
    details.push(`PNG saved (${result.png.size} bytes)`);
    return { saved: true, warnings, details };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await markIfPending(snapshotId, 'png', 'failed');
    warnings.push({ kind: 'resource-failure', detail: boundedDetail(`storing the PNG failed: ${reason}`) });
    details.push(`storing the PNG failed (${boundedDetail(reason)})`);
    return { saved: false, warnings, details };
  }
}

export function createProductionCaptureSteps(options: ProductionCaptureStepsOptions = {}): CaptureSteps {
  const settleMs = options.settleMs ?? SETTLE_MS;
  return {
    async run(context: CaptureRunContext, tab: DrivenTab): Promise<CaptureStepOutcome> {
      let snapshot: Snapshot | null = null;
      const warnings: CaptureWarning[] = [];
      const details: string[] = [];

      try {
        // 1. The snapshot record precedes any artifact work (FR-CAP-05) so
        //    cancels/timeouts always have a record to finalize. A recapture
        //    chains to the link's previous snapshot (new revision by
        //    default, FR-CAP-08).
        snapshot = await createSnapshot(await repo(), {
          noteId: context.job.noteId,
          linkId: context.job.linkId,
          sourceUrl: context.job.url,
          finalUrl: tab.finalUrl,
          title: tab.title.trim().length > 0 ? tab.title.trim() : tab.finalUrl,
          previousSnapshotId: context.job.existingSnapshotId,
        });
        context.snapshotCreated(snapshot.id);
        context.report('capturing', 'saving the MHTML archive');

        // 2. MHTML artifact (T-023).
        const mhtml = await captureMhtml(context, tab, snapshot.id);
        details.push(mhtml.detail);
        if (mhtml.warning) warnings.push(mhtml.warning);

        // 3. Extracted visible text (T-024, FR-CAP-09) — stored separately
        //    so search never parses the MHTML archive.
        const text = await extractText(context, tab, snapshot.id, settleMs);
        details.push(...text.details);
        warnings.push(...text.warnings);

        // 4. Full-page PNG through the debugger API (T-025, FR-CAP-10) —
        //    the tab is never activated; failures keep MHTML+text intact.
        const png = await capturePng(context, tab, snapshot.id);
        details.push(...png.details);
        warnings.push(...png.warnings);

        // 5. Warnings belong to the record (FR-CAP-05) — appended after the
        //    artifacts so a partial record is never left warning-less.
        for (const warning of warnings) {
          try {
            await addSnapshotWarning(await repo(), snapshot.id, warning);
          } catch (error) {
            console.error('[capture] failed to record a warning', error);
          }
        }

        // 6. Snapshot text is searchable (FR-SEARCH-01/05): keep the note's
        //    search projection consistent with what was just saved.
        if (text.saved || mhtml.saved) await reindexNote(context.job.noteId);

        // 7. The outcome mirrors the persisted record — the source of truth.
        const final = await getSnapshot(await repo(), snapshot.id);
        const status = final
          ? final.status === 'complete'
            ? 'complete'
            : final.status === 'partial'
              ? 'partial'
              : 'failed'
          : 'failed';
        return { snapshotId: snapshot.id, status, warnings, detail: details.join('; ') };
      } catch (error) {
        // Infrastructure failure (database unavailable, store error): never
        // throw — the queue owns failure semantics and an unhandled
        // rejection inside the race would crash the worker.
        const reason = error instanceof Error ? error.message : String(error);
        return {
          snapshotId: snapshot?.id ?? null,
          status: 'failed',
          warnings,
          detail: `the capture steps failed before completing (${boundedDetail(reason)})`,
        };
      }
    },
  };
}
