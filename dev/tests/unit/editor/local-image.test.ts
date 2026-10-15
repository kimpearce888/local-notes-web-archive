// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { createEditorExtensions } from '../../../../src/dashboard/editor/extensions';
import {
  ATTACHMENT_SRC_PREFIX,
  attachmentIdFromSrc,
  isAttachmentSrc,
} from '../../../../src/dashboard/editor/local-image';
import { sanitizeEditorHtml } from '../../../../src/dashboard/editor/sanitize';

/**
 * T-019 LocalImage: caption + width attributes survive schema round-trips,
 * attachment references resolve through the injected resolver (never the
 * network), the node view renders figure/caption/resize controls, and the
 * sanitisation gate keeps `attachment:` sources alive while stripping
 * everything unsafe.
 */

function newEditor(resolver?: (src: string) => Promise<string | null>): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: createEditorExtensions(
      resolver ? { resolveImageSrc: resolver } : undefined,
    ),
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
  });
}

function insertImage(editor: Editor, attrs: Record<string, unknown>): void {
  editor.commands.insertContent({ type: 'image', attrs });
}

function imageNode(editor: Editor): (Record<string, unknown> | undefined) {
  const doc = editor.getJSON();
  const node = doc.content?.find((item) => item.type === 'image');
  return node?.attrs as Record<string, unknown> | undefined;
}

const UUID = '0f0e0d0c-1b2a-4c3d-9e8f-0a1b2c3d4e5f';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('reference scheme helpers', () => {
  it('recognises attachment sources and extracts ids', () => {
    expect(isAttachmentSrc(`${ATTACHMENT_SRC_PREFIX}${UUID}`)).toBe(true);
    expect(isAttachmentSrc('data:image/png;base64,AAA')).toBe(false);
    expect(attachmentIdFromSrc(`${ATTACHMENT_SRC_PREFIX}${UUID}`)).toBe(UUID);
    expect(attachmentIdFromSrc('attachment:')).toBeNull();
    expect(attachmentIdFromSrc('https://example.com/a.png')).toBeNull();
  });
});

describe('schema round-trips', () => {
  it('persists width and caption attributes through getJSON', () => {
    const editor = newEditor();
    insertImage(editor, {
      src: `${ATTACHMENT_SRC_PREFIX}${UUID}`,
      alt: 'A chart',
      width: 50,
      caption: 'Q3 growth',
    });
    const attrs = imageNode(editor);
    expect(attrs?.src).toBe(`${ATTACHMENT_SRC_PREFIX}${UUID}`);
    expect(attrs?.width).toBe(50);
    expect(attrs?.caption).toBe('Q3 growth');
    editor.destroy();
  });

  it('round-trips data-width and data-caption through HTML', () => {
    const editor = newEditor();
    insertImage(editor, {
      src: `${ATTACHMENT_SRC_PREFIX}${UUID}`,
      alt: 'A chart',
      width: 75,
      caption: 'Team photo',
    });
    const html = editor.getHTML();
    expect(html).toContain('data-width="75"');
    expect(html).toContain('data-caption="Team photo"');
    expect(html).toContain(`src="${ATTACHMENT_SRC_PREFIX}${UUID}"`);

    // Parse the serialised HTML back into a fresh editor.
    const second = newEditor();
    second.commands.setContent(html);
    const attrs = imageNode(second);
    expect(attrs?.src).toBe(`${ATTACHMENT_SRC_PREFIX}${UUID}`);
    expect(attrs?.width).toBe(75);
    expect(attrs?.caption).toBe('Team photo');
    editor.destroy();
    second.destroy();
  });

  it('ignores out-of-range widths when parsing HTML', () => {
    const editor = newEditor();
    editor.commands.setContent(
      `<img src="${ATTACHMENT_SRC_PREFIX}${UUID}" data-width="500" data-caption="x">`,
    );
    const attrs = imageNode(editor);
    expect(attrs?.width).toBeNull();
    editor.destroy();
  });
});

describe('node view rendering', () => {
  it('renders a figure with caption and resolves attachment sources', async () => {
    const resolver = vi.fn(async () => 'blob:resolved-url');
    const editor = newEditor(resolver);
    insertImage(editor, {
      src: `${ATTACHMENT_SRC_PREFIX}${UUID}`,
      alt: 'A chart',
      caption: 'Sunset over the bay',
    });

    const figure = editor.view.dom.querySelector('figure.editor-image');
    expect(figure).not.toBeNull();
    const caption = figure?.querySelector('figcaption.editor-image__caption');
    expect(caption?.textContent).toBe('Sunset over the bay');

    await vi.waitFor(() => {
      expect((figure?.querySelector('img') as HTMLImageElement).src).toContain('blob:resolved-url');
    });
    expect(resolver).toHaveBeenCalledWith(`${ATTACHMENT_SRC_PREFIX}${UUID}`);
    editor.destroy();
  });

  it('passes data: URLs straight through without the resolver', () => {
    const resolver = vi.fn(async () => 'blob:should-not-be-called');
    const editor = newEditor(resolver);
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    insertImage(editor, { src: dataUrl });
    const img = editor.view.dom.querySelector('img') as HTMLImageElement;
    expect(img.src).toBe(dataUrl);
    expect(resolver).not.toHaveBeenCalled();
    editor.destroy();
  });

  it('shows a truthful error when the resolver cannot load the content', async () => {
    const editor = newEditor(async () => null);
    insertImage(editor, { src: `${ATTACHMENT_SRC_PREFIX}${UUID}` });
    const figure = editor.view.dom.querySelector('figure.editor-image');
    await vi.waitFor(() => {
      expect(figure?.classList.contains('editor-image--error')).toBe(true);
    });
    expect(figure?.querySelector('.editor-image__status')?.textContent).toContain(
      'could not be loaded',
    );
    editor.destroy();
  });

  it('commits caption edits back to the node on blur', () => {
    const editor = newEditor(async () => 'blob:x');
    insertImage(editor, { src: `${ATTACHMENT_SRC_PREFIX}${UUID}` });
    const caption = editor.view.dom.querySelector(
      'figcaption.editor-image__caption',
    ) as HTMLElement;
    caption.textContent = 'Edited caption';
    caption.dispatchEvent(new Event('blur'));
    const attrs = imageNode(editor);
    expect(attrs?.caption).toBe('Edited caption');
    editor.destroy();
  });

  it('updates the width attribute from the resize controls when selected', () => {
    const editor = newEditor(async () => 'blob:x');
    insertImage(editor, { src: `${ATTACHMENT_SRC_PREFIX}${UUID}` });
    const figure = editor.view.dom.querySelector('figure.editor-image') as HTMLElement;

    // Selecting the node reveals the controls (selectNode path). jsdom has
    // no layout: point elementFromPoint at the figure for ProseMirror's own
    // mousedown handling.
    document.elementFromPoint = () => figure;
    try {
      figure.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    } finally {
      delete (document as { elementFromPoint?: unknown }).elementFromPoint;
    }
    const controls = figure.querySelector('.editor-image__controls') as HTMLElement;
    expect(controls.hidden).toBe(false);

    const fiftyPercent = Array.from(controls.querySelectorAll('button')).find(
      (button) => button.textContent === '50%',
    ) as HTMLButtonElement;
    fiftyPercent.click();
    const attrs = imageNode(editor);
    expect(attrs?.width).toBe(50);

    const reset = Array.from(controls.querySelectorAll('button')).find(
      (button) => button.textContent === 'Full',
    ) as HTMLButtonElement;
    reset.click();
    const updated = imageNode(editor);
    expect(updated?.width).toBeNull();
    editor.destroy();
  });
});

describe('sanitisation gate', () => {
  it('keeps attachment references and image attributes, strips the rest', () => {
    const dirty = `<img src="${ATTACHMENT_SRC_PREFIX}${UUID}" data-caption="kept" data-width="50" alt="ok" onerror="steal()">`;
    const { html } = sanitizeEditorHtml(dirty);
    expect(html).toContain(`src="${ATTACHMENT_SRC_PREFIX}${UUID}"`);
    expect(html).toContain('data-caption="kept"');
    expect(html).toContain('data-width="50"');
    // Event handlers never survive the gate.
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('steal()');
  });

  it('rejects attachment-like schemes that are not exact UUID references', () => {
    const { html } = sanitizeEditorHtml('<img src="attachment:not-a-uuid">');
    expect(html).not.toContain('attachment:not-a-uuid');
  });
});

describe('image-source privacy guard (T-048)', () => {
  it('strips remote image srcs at sanitisation time and reports the removal', () => {
    const dirty = '<p>text <img src="https://tracker.example/pixel.gif" alt="x"> more</p>';
    const { html, removed } = sanitizeEditorHtml(dirty);
    expect(html).not.toContain('https://tracker.example');
    expect(removed.some((entry) => entry.startsWith('img:src:'))).toBe(true);
  });

  it('strips relative image srcs (they would resolve against the extension origin)', () => {
    // Relative srcs fail DOMPurify's generic URI gate (no approved scheme),
    // so they are removed silently by that layer; the T-048 hook catches the
    // remote-src case (previous test) and reports it. Either way the src never
    // survives the gate.
    const { html } = sanitizeEditorHtml('<img src="x" alt="rel">');
    expect(html).not.toContain('src="x"');
  });

  it('keeps inline data: image srcs through the gate', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    const { html, removed } = sanitizeEditorHtml(`<img src="${dataUrl}" alt="ok">`);
    expect(html).toContain(`src="${dataUrl}"`);
    expect(removed.some((entry) => entry.startsWith('img:src:'))).toBe(false);
  });

  it('keeps http(s) hrefs for links while stripping them for images (split policies)', () => {
    const { html } = sanitizeEditorHtml(
      '<p><a href="https://example.com/page">link</a> <img src="https://example.com/img.png"></p>',
    );
    expect(html).toContain('href="https://example.com/page"');
    expect(html).not.toContain('img src');
  });

  it('refuses remote and relative srcs at render time — never assigns them to the DOM', () => {
    const editor = newEditor();
    for (const src of ['https://example.com/pixel.gif', 'x']) {
      insertImage(editor, { src });
      const figure = editor.view.dom.querySelector('figure.editor-image');
      expect(figure).not.toBeNull();
      const img = figure?.querySelector('img') as HTMLImageElement;
      // The src attribute is never set on the live element...
      expect(img.getAttribute('src')).toBeNull();
      // ...and the honest error status is shown instead.
      const status = figure?.querySelector('.editor-image__status') as HTMLElement;
      expect(status?.hidden).toBe(false);
      expect(status?.textContent).toContain('never fetched');
      editor.commands.clearContent();
    }
    editor.destroy();
  });

  it('still renders inline data: images directly', () => {
    const editor = newEditor();
    const dataUrl = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='; // 1x1 transparent GIF
    insertImage(editor, { src: dataUrl });
    const img = editor.view.dom.querySelector('img') as HTMLImageElement;
    expect(img.src).toBe(dataUrl);
    editor.destroy();
  });
});
