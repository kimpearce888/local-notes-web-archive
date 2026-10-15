// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  noteFileKind,
  parseNoteFile,
  noteMarkdownExport,
  noteHtmlExport,
  exportFileStem,
} from '../../../../src/dashboard/editor/note-transfer';

/**
 * T-035 dashboard-side note file parsing (FR-DATA-05): JSON note-file
 * validation, Markdown title extraction + sanitization, HTML sanitization
 * (script stripping), export builders and safe filenames.
 */

describe('noteFileKind', () => {
  it('maps extensions to kinds', () => {
    expect(noteFileKind('note.json')).toBe('json');
    expect(noteFileKind('note.MD')).toBe('markdown');
    expect(noteFileKind('note.markdown')).toBe('markdown');
    expect(noteFileKind('note.txt')).toBe('markdown');
    expect(noteFileKind('note.html')).toBe('html');
    expect(noteFileKind('note.htm')).toBe('html');
    expect(noteFileKind('note.zip')).toBeNull();
    expect(noteFileKind('note.exe')).toBeNull();
  });
});

describe('parseNoteFile: JSON', () => {
  const validFile = JSON.stringify({
    format: 'lnwa-note',
    version: 1,
    note: {
      title: 'Imported title',
      subtitle: '',
      editorDoc: { type: 'doc', content: [] },
      plainText: 'imported body',
    },
    tags: ['alpha', 'beta'],
    categories: ['Projects'],
  });

  it('accepts a valid note file', () => {
    const parsed = parseNoteFile('note.json', validFile);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.file.title).toBe('Imported title');
      expect(parsed.file.plainText).toBe('imported body');
      expect(parsed.file.editorDoc).toEqual({ type: 'doc', content: [] });
      expect(parsed.file.tags).toEqual(['alpha', 'beta']);
      expect(parsed.file.categories).toEqual(['Projects']);
    }
  });

  it('rejects broken JSON, wrong formats and missing fields', () => {
    for (const [name, text, needle] of [
      ['note.json', '{broken', 'parsed'],
      ['note.json', '{"format":"other","version":1}', 'format/version'],
      ['note.json', JSON.stringify({ format: 'lnwa-note', version: 2 }), 'format/version'],
      ['note.json', JSON.stringify({ format: 'lnwa-note', version: 1 }), 'no note object'],
      ['note.json', JSON.stringify({ format: 'lnwa-note', version: 1, note: { title: 5, plainText: 'x' } }), 'title'],
      ['note.json', JSON.stringify({ format: 'lnwa-note', version: 1, note: { title: 'x', plainText: 'y', editorDoc: 'nope' } }), 'malformed'],
      ['note.exe', 'anything', 'supported note files'],
    ] as [string, string, string][]) {
      const parsed = parseNoteFile(name, text);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.error).toContain(needle);
    }
  });

  it('drops oversized tag arrays and non-string entries', () => {
    const file = JSON.stringify({
      format: 'lnwa-note',
      version: 1,
      note: { title: 't', plainText: 'b', editorDoc: null },
      tags: ['ok', 42, null, ...Array.from({ length: 100 }, () => 'x')],
    });
    const parsed = parseNoteFile('note.json', file);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      // Non-strings dropped; the list is capped at 50 entries.
      expect(parsed.file.tags[0]).toBe('ok');
      expect(parsed.file.tags.every((tag) => typeof tag === 'string')).toBe(true);
      expect(parsed.file.tags.length).toBeLessThanOrEqual(50);
    }
  });
});

describe('parseNoteFile: Markdown and HTML', () => {
  it('extracts the first heading as the title and sanitizes the body', () => {
    const markdown = '# Trip plans\n\nVisit **Rome** and keep notes.\n\n<script>alert(1)</script>\n';
    const parsed = parseNoteFile('trip.md', markdown);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.file.title).toBe('Trip plans');
      expect(parsed.file.bodyHtml).toContain('Rome');
      // No executable script survives (escaped as text or stripped).
      expect(parsed.file.bodyHtml).not.toMatch(/<script[\s>]/);
      expect(parsed.file.plainText).toContain('Rome');
    }
  });

  it('treats extensionless markdown bodies as untitled notes', () => {
    const parsed = parseNoteFile('note.txt', 'just plain text lines');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.file.title).toBe('Imported note');
  });

  it('sanitizes HTML imports and extracts <title>/<body>', () => {
    const html =
      '<html><head><title>Clipped page</title></head><body><h1>Hello</h1><script>steal()</script><iframe src="evil"></iframe><p onclick="x()">World</p></body></html>';
    const parsed = parseNoteFile('page.html', html);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.file.title).toBe('Clipped page');
      expect(parsed.file.bodyHtml).toContain('<h1>Hello</h1>');
      expect(parsed.file.bodyHtml).not.toMatch(/<script[\s>]/);
      expect(parsed.file.bodyHtml).not.toContain('<iframe');
      expect(parsed.file.bodyHtml).not.toContain('onclick');
      expect(parsed.file.plainText).toContain('World');
      expect(parsed.file.removed.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('export builders (FR-DATA-05)', () => {
  it('builds markdown exports with title and subtitle', () => {
    const md = noteMarkdownExport('My note', 'a subtitle', '<h2>Section</h2><p>Body <strong>text</strong></p>');
    expect(md.startsWith('# My note')).toBe(true);
    expect(md).toContain('> a subtitle');
    expect(md).toContain('## Section');
    expect(md).toContain('**text**');
  });

  it('builds sanitized standalone HTML exports', () => {
    const html = noteHtmlExport('My < note', '', '<p>safe</p><script>bad()</script>');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>My &lt; note</title>');
    expect(html).toContain('<p>safe</p>');
    expect(html).not.toContain('<script');
  });

  it('derives safe file stems', () => {
    expect(exportFileStem('Hello: world/next?')).toBe('Hello world next');
    expect(exportFileStem('   ')).toBe('untitled-note');
    expect(exportFileStem('x'.repeat(100)).length).toBeLessThanOrEqual(60);
  });
});
