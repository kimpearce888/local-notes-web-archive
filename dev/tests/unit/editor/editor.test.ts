// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createEditorExtensions, SCHEMA_MARKS, SCHEMA_NODES } from '../../../../src/dashboard/editor/extensions';
import { sanitizeEditorHtml, isSafeLinkHref } from '../../../../src/dashboard/editor/sanitize';
import { markdownToEditorHtml, editorHtmlToMarkdown } from '../../../../src/dashboard/editor/markdown';
import {
  findMatches,
  nextMatch,
  previousMatch,
  replaceAllInText,
  replaceInDocument,
  type FindState,
} from '../../../../src/dashboard/editor/find-replace';

/**
 * T-017 validation: the schema is exactly the PRD §4.4 matrix, documents
 * round-trip through the editor, sanitisation gates strip unsafe content,
 * Markdown converts both ways, and find/replace is correct.
 */

function newEditor(content?: object | string): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: createEditorExtensions(),
    content: content ?? { type: 'doc', content: [{ type: 'paragraph' }] },
  });
}

describe('schema: exactly the PRD §4.4 matrix', () => {
  it('contains every required node and no extras', () => {
    const editor = newEditor();
    const nodes = Object.keys(editor.state.schema.nodes).sort();
    for (const required of SCHEMA_NODES) {
      expect(nodes).toContain(required);
    }
    editor.destroy();
  });

  it('contains every required mark and no extras', () => {
    const editor = newEditor();
    const marks = Object.keys(editor.state.schema.marks).sort();
    expect(marks).toEqual([...SCHEMA_MARKS].sort());
    editor.destroy();
  });

  it('limits headings to levels 1 through 6', () => {
    const editor = newEditor();
    for (const level of [1, 2, 3, 4, 5, 6]) {
      editor.commands.setHeading({ level: level as 1 });
      expect(editor.isActive('heading', { level })).toBe(true);
    }
    editor.destroy();
  });
});

describe('document round-trips', () => {
  /** Removes null-valued default attrs so authored JSON compares cleanly. */
  function normalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(normalize);
    if (typeof value === 'object' && value !== null) {
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        if (inner === null) continue;
        out[key] = normalize(inner);
      }
      // Empty attrs objects (defaulted textAlign) are not authored content.
      if (out['attrs'] !== undefined && Object.keys(out['attrs'] as object).length === 0) {
        delete out['attrs'];
      }
      return out;
    }
    return value;
  }

  it('JSON → editor → JSON is stable', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Round trip' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'styled', marks: [{ type: 'bold' }, { type: 'italic' }] },
            { type: 'text', text: ' plain' },
          ],
        },
      ],
    };
    const editor = newEditor(doc);
    expect(normalize(editor.getJSON())).toEqual(normalize(doc));
    editor.destroy();
  });

  it('commands produce the full inline mark set', () => {
    const editor = newEditor();
    const toggles: Array<[string, () => void]> = [
      ['bold', () => editor.commands.toggleBold()],
      ['italic', () => editor.commands.toggleItalic()],
      ['underline', () => editor.commands.toggleUnderline()],
      ['strike', () => editor.commands.toggleStrike()],
      ['code', () => editor.commands.toggleCode()],
      ['superscript', () => editor.commands.toggleSuperscript()],
      ['subscript', () => editor.commands.toggleSubscript()],
    ];
    for (const [mark, toggle] of toggles) {
      editor.commands.clearContent();
      editor.commands.insertContent('x');
      editor.commands.selectAll();
      toggle();
      expect(editor.isActive(mark), `mark ${mark}`).toBe(true);
    }
    editor.destroy();
  });

  it('applies font size, colour, highlight and alignment', () => {
    const editor = newEditor();
    editor.commands.insertContent('styled');
    editor.commands.selectAll();
    editor.commands.setFontSize('20px');
    editor.commands.setColor('#a4262c');
    editor.commands.setHighlight({ color: '#fef08a' });
    editor.commands.setTextAlign('center');
    const json = editor.getJSON();
    const marks = (json.content?.[0]?.content?.[0]?.marks ?? []).map((mark) => mark.type);
    const textStyle = json.content?.[0]?.content?.[0]?.marks?.find(
      (mark) => mark.type === 'textStyle',
    );
    expect(marks).toContain('textStyle');
    expect(marks).toContain('highlight');
    expect(textStyle?.attrs).toMatchObject({ fontSize: '20px', color: '#a4262c' });
    expect(json.content?.[0]?.attrs?.textAlign).toBe('center');
    editor.destroy();
  });

  it('creates tables, task lists, code blocks and images', () => {
    const editor = newEditor();
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
    expect(editor.isActive('table') || editor.getHTML().includes('<table')).toBe(true);

    editor.commands.clearNodes();
    editor.commands.toggleTaskList();
    expect(editor.getHTML()).toContain('data-type="taskList"');

    editor.commands.clearNodes();
    editor.commands.toggleCodeBlock();
    editor.commands.updateAttributes('codeBlock', { language: 'typescript' });
    expect(editor.getHTML()).toContain('language-typescript');

    editor.commands.clearNodes();
    editor.commands.setImage({ src: 'data:image/png;base64,AAAA', alt: 'dot' });
    expect(editor.getHTML()).toContain('<img');
    editor.destroy();
  });

  it('undoes and redoes reliably', () => {
    const editor = newEditor();
    editor.commands.insertContent('one');
    editor.commands.insertContent(' two');
    expect(editor.getText()).toContain('one two');
    editor.commands.undo();
    editor.commands.undo();
    expect(editor.getText()).not.toContain('one');
    editor.commands.redo();
    editor.commands.redo();
    expect(editor.getText()).toContain('one two');
    editor.destroy();
  });
});

describe('sanitisation gates (PRD §10)', () => {
  it('strips scripts, handlers and unsafe protocols', () => {
    const evil =
      '<p onclick="steal()">hi</p><script>alert(1)</script>' +
      '<a href="javascript:alert(1)">bad</a><a href="https://ok.example">good</a>';
    const { html } = sanitizeEditorHtml(evil);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('https://ok.example');
  });

  it('keeps only the editor style vocabulary in inline styles', () => {
    const { html } = sanitizeEditorHtml(
      '<span style="color: red; position: fixed; top: 0">x</span>',
    );
    expect(html).toContain('color');
    expect(html).not.toContain('position');
    expect(html).not.toContain('top:');
  });

  it('removes styles entirely when nothing allowed remains', () => {
    const { html } = sanitizeEditorHtml('<span style="position: fixed">x</span>');
    expect(html).not.toContain('style');
  });

  it('preserves task-list checkbox inputs (PRD §4.4 task lists)', () => {
    const { html } = sanitizeEditorHtml(
      '<ul><li><input checked="" type="checkbox"> done</li></ul>',
    );
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked');
  });

  it('blocks base64 payloads other than images', () => {
    const { html } = sanitizeEditorHtml(
      '<a href="data:text/html;base64,PHNjcmlwdD4=">bad</a>',
    );
    expect(html).not.toContain('data:text/html');
  });

  it('validates link targets against approved protocols', () => {
    expect(isSafeLinkHref('https://example.org')).toBe(true);
    expect(isSafeLinkHref('mailto:a@b.c')).toBe(true);
    expect(isSafeLinkHref('javascript:alert(1)')).toBe(false);
    expect(isSafeLinkHref('ftp://x')).toBe(false);
  });
});

describe('Markdown import/export', () => {
  it('converts Markdown to sanitised editor HTML', () => {
    const html = markdownToEditorHtml('# Title\n\n**bold** and `code`');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
  });

  it('sanitises dangerous Markdown link targets', () => {
    const html = markdownToEditorHtml('[x](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
  });

  it('exports editor HTML back to Markdown', () => {
    const markdown = editorHtmlToMarkdown(
      '<h2>Head</h2><p><strong>bold</strong> <em>it</em> <del>gone</del></p>',
    );
    expect(markdown).toContain('## Head');
    expect(markdown).toContain('**bold**');
    expect(markdown).toContain('*it*');
    expect(markdown).toContain('~gone~'); // single-tilde is valid GFM strikethrough
  });

  it('round-trips GFM tables and task lists', () => {
    const source = '| H |\n| --- |\n| 1 |\n\n- [x] done\n- [ ] todo';
    const html = markdownToEditorHtml(source);
    const markdown = editorHtmlToMarkdown(html);
    expect(markdown).toContain('| H |');
    expect(markdown).toContain('[x]');
    expect(markdown).toContain('[ ]');
  });
});

describe('find and replace', () => {
  it('finds all matches case-insensitively by default', () => {
    const matches = findMatches('The needle in the needle stack', 'NEEDLE');
    expect(matches).toHaveLength(2);
    expect(matches[0]?.from).toBe(4);
    expect(matches[1]?.from).toBe(18);
  });

  it('honours case sensitivity', () => {
    expect(findMatches('Aa aa AA', 'AA', { caseSensitive: true })).toHaveLength(1);
    expect(findMatches('Aa aa AA', 'AA')).toHaveLength(3);
  });

  it('returns empty for empty queries', () => {
    expect(findMatches('anything', '')).toEqual([]);
  });

  it('cycles through matches forwards and backwards', () => {
    let state: FindState = { matches: findMatches('a a a', 'a'), activeIndex: 0 };
    state = nextMatch(state);
    expect(state.activeIndex).toBe(1);
    state = previousMatch(state);
    expect(state.activeIndex).toBe(0);
    state = previousMatch(state);
    expect(state.activeIndex).toBe(2); // wraps
  });

  it('replaces all occurrences', () => {
    expect(replaceAllInText('cat hat bat', 'at', 'og', false)).toBe('cog hog bog');
    expect(replaceAllInText('AT at', 'at', 'x', true)).toBe('AT x');
  });

  it('escapes regex metacharacters in replacements', () => {
    expect(replaceAllInText('a.c a.c', 'a.c', 'x', false)).toBe('x x');
  });
});

/** Loose JSON accessor: tiptap's getJSON union types don't expose .text directly. */
function textOf(node: unknown): string | undefined {
  return (node as { text?: string } | undefined)?.text;
}

/** Descend .content[i] repeatedly over the loosely-typed editor JSON. */
function at(node: unknown, ...path: number[]): unknown {
  let cur: unknown = node;
  for (const i of path) {
    cur = (cur as { content?: unknown[] } | undefined | null)?.content?.[i];
  }
  return cur;
}

describe('replace preserves document structure (QA-D08)', () => {
  function richEditor(): Editor {
    return newEditor({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Needle heading' }] },
        { type: 'bulletList', content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'needle item one' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'plain item' }] }] },
        ] },
        { type: 'paragraph', content: [
          { type: 'text', text: 'A needle with ' },
          { type: 'text', marks: [{ type: 'bold' }], text: 'bold needle' },
          { type: 'text', text: ' after.' },
        ] },
        { type: 'codeBlock', content: [{ type: 'text', text: 'const needle = 1;' }] },
        { type: 'image', attrs: { src: 'attachment:test-img', alt: 'needle art' } },
      ],
    });
  }

  it('replace-all keeps headings, lists, marks, code blocks and images (structure is never flattened)', () => {
    const editor = richEditor();
    const replaced = replaceInDocument(editor, 'needle', 'NEEDLE', false, 'all');
    expect(replaced).toBe(5); // heading + list item + plain + bold + code block texts
    const doc = editor.getJSON();
    expect(doc.content?.[0]?.type).toBe('heading');
    expect(textOf(doc.content?.[0]?.content?.[0])).toBe('NEEDLE heading');
    expect(doc.content?.[1]?.type).toBe('bulletList');
    expect(textOf(at(doc.content?.[1], 1, 0, 0))).toBe('plain item');
    expect((at(doc.content?.[2], 1) as { marks?: { type?: string }[] } | undefined)?.marks?.[0]?.type).toBe('bold');
    expect(textOf(doc.content?.[2]?.content?.[1])).toBe('bold NEEDLE');
    expect(doc.content?.[3]?.type).toBe('codeBlock');
    expect(textOf(doc.content?.[3]?.content?.[0])).toBe('const NEEDLE = 1;');
    expect(doc.content?.[4]?.type).toBe('image');
    expect(doc.content?.[4]?.attrs?.alt).toBe('needle art'); // untouched attrs
    editor.destroy();
  });

  it('replace-one targets only the Nth occurrence in document order', () => {
    const editor = richEditor();
    const replaced = replaceInDocument(editor, 'needle', 'PIN', false, 2); // 3rd occurrence = the unbolded 'A needle'
    expect(replaced).toBe(1);
    const doc = editor.getJSON();
    expect(textOf(doc.content?.[0]?.content?.[0])).toBe('Needle heading'); // 0th untouched
    expect(textOf(doc.content?.[2]?.content?.[0])).toBe('A PIN with ');
    expect(textOf(doc.content?.[3]?.content?.[0])).toBe('const needle = 1;'); // later ones untouched
    editor.destroy();
  });

  it('case-sensitive replace-all honours case and empty queries replace nothing', () => {
    const editor = richEditor();
    expect(replaceInDocument(editor, 'Needle', 'X', true, 'all')).toBe(1); // only the heading's capital-N
    expect(replaceInDocument(editor, '', 'X', false, 'all')).toBe(0);
    const doc = editor.getJSON();
    expect(textOf(doc.content?.[0]?.content?.[0])).toBe('X heading');
    editor.destroy();
  });

  it('survives autosave-style round-trips: getHTML keeps structure after replace-all', () => {
    const editor = richEditor();
    replaceInDocument(editor, 'needle', 'REDACTED', false, 'all');
    const html = editor.getHTML();
    expect(html).toContain('<h2>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<pre>');
    expect(html).toContain('<img');
    expect(html).toContain('REDACTED');
    // Text replacement must not rewrite attributes: the image's alt stays
    // 'needle art' (asserted above); the TEXT projection has no 'needle' left.
    expect(editor.getText()).not.toContain('needle');
    expect(html).toContain('alt="needle art"');
    editor.destroy();
  });
});

