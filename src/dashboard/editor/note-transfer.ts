/**
 * Dashboard-side note file transfer (FR-DATA-05): parsing, validation and
 * sanitization for note-level import/export as JSON, Markdown and sanitized
 * HTML. Runs where DOMPurify and turndown operate; the background only ever
 * receives validated structures.
 *
 * Import safety: HTML is sanitized BEFORE it becomes editor content; JSON
 * note files are validated field-by-field (title/plainText bounds, editorDoc
 * shape, tag/category name bounds); nothing executes.
 */

import { markdownToEditorHtml, editorHtmlToMarkdown } from './markdown';
import { sanitizeEditorHtml } from './sanitize';

export type NoteFileKind = 'json' | 'markdown' | 'html';

export interface ParsedNoteFile {
  readonly kind: NoteFileKind;
  readonly title: string;
  /** Sanitized HTML for the note body (markdown converted first). */
  readonly bodyHtml: string | null;
  /** Pre-validated editor document for JSON imports. */
  readonly editorDoc: object | null;
  readonly plainText: string;
  readonly tags: string[];
  readonly categories: string[];
  /** Sanitization findings surfaced to the user (truthful imports). */
  readonly removed: string[];
}

const TITLE_MAX = 500;
const BODY_MAX = 1_000_000; // ~1MB of text is far beyond any sane note
const TAG_LIST_MAX = 50;

export function noteFileKind(filename: string): NoteFileKind | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.txt')) return 'markdown';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  return null;
}

function htmlToPlainText(html: string): string {
  const host = document.createElement('div');
  host.innerHTML = html;
  return (host.textContent ?? '').replace(/\s+\n/g, '\n').trim();
}

function bounded(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  if (value.length > max) return null;
  return value;
}

/** Parse and validate an imported note file's text content. */
export function parseNoteFile(filename: string, text: string): { ok: true; file: ParsedNoteFile } | { ok: false; error: string } {
  if (text.length > BODY_MAX) {
    return { ok: false, error: 'the file is too large to import as a note' };
  }
  const kind = noteFileKind(filename);
  if (kind === null) {
    return { ok: false, error: 'supported note files are .json, .md/.markdown/.txt and .html/.htm' };
  }

  if (kind === 'json') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, error: 'the JSON file could not be parsed' };
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: 'the JSON file is not a note export object' };
    }
    const record = parsed as Record<string, unknown>;
    if (record['format'] !== 'lnwa-note' || record['version'] !== 1) {
      return { ok: false, error: 'this is not a note export from this extension (format/version mismatch)' };
    }
    const note = record['note'];
    if (typeof note !== 'object' || note === null) {
      return { ok: false, error: 'the note export has no note object' };
    }
    const noteRecord = note as Record<string, unknown>;
    const title = bounded(noteRecord['title'], TITLE_MAX);
    const plainText = bounded(noteRecord['plainText'], BODY_MAX);
    if (title === null || plainText === null) {
      return { ok: false, error: 'the note title or body text is missing or too large' };
    }
    const editorDoc = noteRecord['editorDoc'];
    const validDoc =
      (typeof editorDoc === 'object' && editorDoc !== null && !Array.isArray(editorDoc)) || editorDoc === null;
    if (!validDoc) {
      return { ok: false, error: 'the editor document in the file is malformed' };
    }
    const tagList = record['tags'];
    const tags =
      Array.isArray(tagList)
        ? tagList.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0 && tag.length <= 100).slice(0, TAG_LIST_MAX)
        : [];
    const categoryList = record['categories'];
    const categories =
      Array.isArray(categoryList)
        ? categoryList.filter((name): name is string => typeof name === 'string' && name.length > 0 && name.length <= 100).slice(0, TAG_LIST_MAX)
        : [];
    return {
      ok: true,
      file: {
        kind,
        title,
        bodyHtml: null,
        editorDoc: editorDoc as object | null,
        plainText,
        tags,
        categories,
        removed: [],
      },
    };
  }

  if (kind === 'markdown') {
    // First heading (or first non-empty line) becomes the title.
    const heading = /^#{1,3}\s+(.+)$/m.exec(text);
    const title = (heading?.[1] ?? 'Imported note').slice(0, TITLE_MAX);
    const bodyMarkdown = heading !== null ? text.slice((heading.index ?? 0) + heading[0]!.length).trim() : text;
    const html = markdownToEditorHtml(bodyMarkdown);
    const { html: sanitized, removed } = sanitizeEditorHtml(html);
    return {
      ok: true,
      file: {
        kind,
        title,
        bodyHtml: sanitized,
        editorDoc: null,
        plainText: htmlToPlainText(sanitized),
        tags: [],
        categories: [],
        removed,
      },
    };
  }

  // HTML: sanitized before it can ever become editor content.
  const titleMatch = /<title>([^<]*)<\/title>/i.exec(text);
  const title = (titleMatch?.[1]?.trim() || 'Imported note').slice(0, TITLE_MAX);
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(text);
  const bodyHtml = bodyMatch !== null ? bodyMatch[1]! : text;
  const { html: sanitized, removed } = sanitizeEditorHtml(bodyHtml);
  return {
    ok: true,
    file: {
      kind,
      title,
      bodyHtml: sanitized,
      editorDoc: null,
      plainText: htmlToPlainText(sanitized),
      tags: [],
      categories: [],
      removed,
    },
  };
}

/** Markdown file content for a note export (title + body). */
export function noteMarkdownExport(title: string, subtitle: string, editorHtml: string): string {
  const lines: string[] = [];
  const cleanTitle = title.trim().length > 0 ? title.trim() : 'Untitled note';
  lines.push(`# ${cleanTitle}`);
  if (subtitle.trim().length > 0) lines.push('', `> ${subtitle.trim()}`);
  const body = editorHtmlToMarkdown(editorHtml);
  if (body.trim().length > 0) lines.push('', body);
  return lines.join('\n');
}

/** Standalone sanitized HTML document for a note export. */
export function noteHtmlExport(title: string, subtitle: string, editorHtml: string): string {
  const { html: sanitized } = sanitizeEditorHtml(editorHtml);
  const cleanTitle = title.trim().length > 0 ? title.trim() : 'Untitled note';
  const escaped = cleanTitle.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const subtitleBlock =
    subtitle.trim().length > 0
      ? `    <p class="subtitle">${subtitle.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>\n`
      : '';
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${escaped}</title>
  </head>
  <body>
    <h1>${escaped}</h1>
${subtitleBlock}    <div class="note-body">
${sanitized}
    </div>
  </body>
</html>
`;
}

/** Safe file stem for exports. */
export function exportFileStem(title: string): string {
  const base = (title.trim() || 'untitled-note')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 60)
    .trim();
  return base.length > 0 ? base : 'untitled-note';
}
