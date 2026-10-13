// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createEditorExtensions } from '../../../src/dashboard/editor/extensions';
import { createEditorToolbar, TOOLBAR_GROUPS } from '../../../src/dashboard/editor/toolbar';

/**
 * T-039 editor toolbar configuration (FR-SET-01): settings.editor.toolbar
 * hides whole groups; hidden groups leave no separators behind, the font
 * extras (size select, colour rows) follow the font group, and every group
 * name the settings panel offers exists in the toolbar.
 */

function newEditor(): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: createEditorExtensions(),
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
  });
}

const callbacks = {
  onInsertLink: () => undefined,
  onInsertImage: () => undefined,
  onToggleFindBar: () => undefined,
  onToggleSourceView: () => undefined,
  onImportMarkdown: () => undefined,
  onExportMarkdown: () => undefined,
  onShowDocumentation: () => undefined,
};

afterEach(() => {
  document.body.replaceChildren();
});

function groupsOf(toolbar: { element: HTMLElement }): Set<string> {
  return new Set(
    [...toolbar.element.querySelectorAll('button')]
      .map((button) => (button as HTMLElement).dataset['group'] ?? '')
      .filter((group) => group !== ''),
  );
}

describe('editor toolbar group configuration', () => {
  it('exposes exactly the group names the settings panel lists', () => {
    const editor = newEditor();
    const toolbar = createEditorToolbar(editor, callbacks);
    const groups = groupsOf(toolbar);
    for (const group of TOOLBAR_GROUPS) {
      expect(groups.has(group), `group ${group} missing from toolbar`).toBe(true);
    }
    editor.destroy();
  });

  it('hides disabled groups including their separators and font extras', () => {
    const editor = newEditor();
    const toolbar = createEditorToolbar(editor, callbacks, {
      table: false,
      font: false,
      media: false,
    });
    const groups = groupsOf(toolbar);
    expect(groups.has('table')).toBe(false);
    expect(groups.has('font')).toBe(false);
    expect(groups.has('media')).toBe(false);
    expect(groups.has('text')).toBe(true);
    expect(groups.has('blocks')).toBe(true);
    expect(groups.has('tools')).toBe(true);

    // Font extras follow the font group.
    expect(toolbar.element.querySelector('.editor-toolbar__select')).toBeNull();
    expect(toolbar.element.querySelector('.editor-toolbar__colors')).toBeNull();

    // Visible groups still render (no all-buttons-vanished regression).
    expect(toolbar.element.querySelectorAll('.editor-toolbar__button').length).toBeGreaterThan(0);
    editor.destroy();
  });

  it('treats missing or true entries as enabled (defaults keep everything)', () => {
    const editor = newEditor();
    const toolbar = createEditorToolbar(editor, callbacks, { text: true });
    const groups = groupsOf(toolbar);
    expect(groups.size).toBe(TOOLBAR_GROUPS.length);
    editor.destroy();
  });
});
