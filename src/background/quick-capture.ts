/**
 * Quick capture (PRD §4.1): context-menu invocations save the current page
 * or the current selection as a note. Only the data the user's click
 * explicitly provides (page URL, page title, selected text) is ever read —
 * no browsing history, no tab scanning, no background observation.
 */

import { repo, searchEngine } from './db';
import { createNote } from '../core/repo/notes';
import { createLink, setLinkCaptureState, type CreateLinkResult } from '../core/repo/links';
import { appendLog } from '../core/repo/logs';
import { notifyLinkQueued } from './capture/queue';
import type { EntityId } from '../core/types';

const TITLE_MAX = 200;

export interface QuickCaptureInput {
  /** Page URL supplied by the context-menu click payload. */
  readonly pageUrl: string;
  /** Page title supplied by the context-menu click payload (may be empty). */
  readonly pageTitle: string;
  /** Selected text (save-selection flow). */
  readonly selectionText?: string;
}

export interface QuickCaptureResult {
  readonly noteId: string;
  /** Link id when a capturable http(s) URL was recorded for the page. */
  readonly linkId: string | null;
}

/** Derive a sensible untitled-style label (PRD §4.3). */
function deriveTitle(input: QuickCaptureInput): string {
  const fromPage = input.pageTitle.trim();
  if (fromPage.length > 0) return fromPage.slice(0, TITLE_MAX);
  const selection = (input.selectionText ?? '').trim();
  if (selection.length > 0) {
    const firstLine = selection.split('\n')[0] ?? selection;
    const label = firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine;
    return label.length > 0 ? label : 'Saved from page';
  }
  return 'Saved from page';
}

/**
 * Build a schema-valid Tiptap document from plain text: each non-empty line
 * becomes one paragraph (the §4.4 matrix has no hard-break node, so single
 * newlines separate paragraphs). Selections keep their line structure.
 */
export function plainTextToEditorDoc(text: string): object {
  const paragraphs = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] }));
  return { type: 'doc', content: paragraphs };
}

/** Paragraph containing a single link-marked text node (source URL). */
export function linkParagraph(url: string, anchorText: string): object {
  const text = anchorText.trim().length > 0 ? anchorText.trim() : url;
  return {
    type: 'paragraph',
    content: [{ type: 'text', text, marks: [{ type: 'link', attrs: { href: url } }] }],
  };
}

async function attachSourceLink(noteId: EntityId, url: string, anchor: string): Promise<string | null> {
  try {
    // QA-D05 fix: a page the user EXPLICITLY saved must actually queue its
    // capture ("a complete offline copy is captured automatically" — the
    // dialog's own copy). The link is created directly (not through the
    // links API), so it must be queued here AND the capture queue must be
    // notified — previously the link stayed 'detected' forever while
    // capture/save-url still reported queued: true (dishonest success).
    const result: CreateLinkResult = await createLink(await repo(), noteId, url, anchor, 'queued');
    let link = result.link;
    if (!result.created && link.captureState === 'detected') {
      // An earlier-detected link for the same URL: the explicit save
      // upgrades it to queued (the user asked for the archive now).
      link = await setLinkCaptureState(await repo(), link.id, 'queued');
    }
    if (link.captureState === 'queued') notifyLinkQueued(link);
    return link.id;
  } catch {
    // The URL failed the link gate (FR-CAP-04); the note survives with the
    // URL as plain text and no capture is queued. Logged truthfully below.
    return null;
  }
}

/**
 * Save the current page: a note titled after the page whose body links the
 * page URL, plus a link record queued for capture (capture pipeline T-022).
 */
export async function saveCurrentPageAsNote(input: QuickCaptureInput): Promise<QuickCaptureResult> {
  const url = input.pageUrl.trim();
  if (url.length === 0) throw new Error('save-current-page: pageUrl is empty');
  const title = deriveTitle(input);
  const ctx = await repo();
  const note = await createNote(ctx, {
    title,
    subtitle: '',
    editorDoc: { type: 'doc', content: [linkParagraph(url, title)] },
    plainText: url,
  });
  const linkId = await attachSourceLink(note.id, url, title);
  await (await searchEngine()).indexNote(note);
  await appendLog(ctx, {
    level: 'info',
    component: 'quick-capture',
    operationId: 'save-current-page',
    resultCode: linkId ? 'ok' : 'link-rejected',
    message: linkId
      ? 'page saved as note with source link'
      : 'page saved as note; source URL rejected by link gate (FR-CAP-04)',
  });
  return { noteId: note.id, linkId };
}

/**
 * Save the current selection: a note whose body is the selected text, with
 * the source page recorded as a link for later capture.
 */
export async function saveSelectionAsNote(input: QuickCaptureInput): Promise<QuickCaptureResult> {
  const selection = (input.selectionText ?? '').trim();
  if (selection.length === 0) throw new Error('save-selection: selectionText is empty');
  const title = deriveTitle(input);
  const ctx = await repo();
  const note = await createNote(ctx, {
    title,
    subtitle: '',
    editorDoc: plainTextToEditorDoc(input.selectionText ?? ''),
    plainText: selection,
  });
  const url = input.pageUrl.trim();
  const linkId = url.length > 0 ? await attachSourceLink(note.id, url, title) : null;
  await (await searchEngine()).indexNote(note);
  await appendLog(ctx, {
    level: 'info',
    component: 'quick-capture',
    operationId: 'save-selection',
    resultCode: 'ok',
    message: linkId
      ? 'selection saved as note with source link'
      : 'selection saved as note without link record',
  });
  return { noteId: note.id, linkId };
}
