/**
 * Editor toolbar (PRD §4.4): every control has an accessible name, groups
 * are labelled, and state (active/Disabled) is mirrored into aria. Colour
 * pickers are bounded swatch lists, never free-form fields, so notes stay
 * predictable and sanitisation stays trivial.
 */

import type { Editor } from '@tiptap/core';
import { FONT_SIZES, HIGHLIGHT_COLORS, TEXT_COLORS } from './extensions';

export interface ToolbarCallbacks {
  onInsertLink(): void;
  onInsertImage(): void;
  onToggleFindBar(): void;
  onToggleSourceView(): void;
  onImportMarkdown(): void;
  onExportMarkdown(): void;
  onShowDocumentation(): void;
}

export interface EditorToolbar {
  readonly element: HTMLElement;
  /** Reflects active states (marks in effect at the selection). */
  sync(): void;
}

type CommandButton = {
  label: string;
  title: string;
  group: string;
  kind: 'mark' | 'node' | 'block' | 'align' | 'list' | 'table' | 'action';
  run: () => void;
  active?: () => boolean;
  enabled?: () => boolean;
};

export function createEditorToolbar(
  editor: Editor,
  callbacks: ToolbarCallbacks,
): EditorToolbar {
  const element = document.createElement('div');
  element.className = 'editor-toolbar';
  element.setAttribute('role', 'toolbar');
  element.setAttribute('aria-label', 'Text formatting');
  const buttons: CommandButton[] = [];

  const add = (button: CommandButton): void => {
    buttons.push(button);
  };

  /* ------------------------- History group ------------------------- */
  add({
    label: 'Undo', title: 'Undo (Ctrl+Z)', group: 'history', kind: 'action',
    run: () => editor.chain().focus().undo().run(),
    enabled: () => editor.can().undo(),
  });
  add({
    label: 'Redo', title: 'Redo (Ctrl+Y)', group: 'history', kind: 'action',
    run: () => editor.chain().focus().redo().run(),
    enabled: () => editor.can().redo(),
  });

  /* -------------------------- Text group --------------------------- */
  add({
    label: 'B', title: 'Bold (Ctrl+B)', group: 'text', kind: 'mark',
    run: () => editor.chain().focus().toggleBold().run(),
    active: () => editor.isActive('bold'),
  });
  add({
    label: 'I', title: 'Italic (Ctrl+I)', group: 'text', kind: 'mark',
    run: () => editor.chain().focus().toggleItalic().run(),
    active: () => editor.isActive('italic'),
  });
  add({
    label: 'U', title: 'Underline (Ctrl+U)', group: 'text', kind: 'mark',
    run: () => editor.chain().focus().toggleUnderline().run(),
    active: () => editor.isActive('underline'),
  });
  add({
    label: 'S', title: 'Strikethrough', group: 'text', kind: 'mark',
    run: () => editor.chain().focus().toggleStrike().run(),
    active: () => editor.isActive('strike'),
  });
  add({
    label: '</>', title: 'Inline code', group: 'text', kind: 'mark',
    run: () => editor.chain().focus().toggleCode().run(),
    active: () => editor.isActive('code'),
  });
  add({
    label: 'x²', title: 'Superscript', group: 'text', kind: 'mark',
    run: () => editor.chain().focus().toggleSuperscript().run(),
    active: () => editor.isActive('superscript'),
  });
  add({
    label: 'x₂', title: 'Subscript', group: 'text', kind: 'mark',
    run: () => editor.chain().focus().toggleSubscript().run(),
    active: () => editor.isActive('subscript'),
  });

  /* -------------------------- Font group --------------------------- */
  add({
    label: 'Clear formatting', title: 'Clear formatting', group: 'font', kind: 'action',
    run: () => editor.chain().focus().unsetAllMarks().clearNodes().run(),
  });

  /* ------------------------- Blocks group -------------------------- */
  for (const level of [1, 2, 3, 4, 5, 6]) {
    add({
      label: `H${level}`, title: `Heading ${level}`, group: 'blocks', kind: 'block',
      run: () => editor.chain().focus().toggleHeading({ level: level as 1 }).run(),
      active: () => editor.isActive('heading', { level }),
    });
  }
  add({
    label: '¶', title: 'Paragraph', group: 'blocks', kind: 'block',
    run: () => editor.chain().focus().setParagraph().run(),
    active: () => editor.isActive('paragraph'),
  });
  add({
    label: '❝', title: 'Blockquote', group: 'blocks', kind: 'node',
    run: () => editor.chain().focus().toggleBlockquote().run(),
    active: () => editor.isActive('blockquote'),
  });
  add({
    label: '{;} Code block', title: 'Code block with language label', group: 'blocks', kind: 'node',
    run: () => editor.chain().focus().toggleCodeBlock().run(),
    active: () => editor.isActive('codeBlock'),
  });
  add({
    label: '—', title: 'Horizontal rule', group: 'blocks', kind: 'node',
    run: () => editor.chain().focus().setHorizontalRule().run(),
  });

  /* -------------------------- Lists group -------------------------- */
  add({
    label: '1. List', title: 'Ordered list', group: 'lists', kind: 'list',
    run: () => editor.chain().focus().toggleOrderedList().run(),
    active: () => editor.isActive('orderedList'),
  });
  add({
    label: '• List', title: 'Bullet list', group: 'lists', kind: 'list',
    run: () => editor.chain().focus().toggleBulletList().run(),
    active: () => editor.isActive('bulletList'),
  });
  add({
    label: '☑ Tasks', title: 'Task list', group: 'lists', kind: 'list',
    run: () => editor.chain().focus().toggleTaskList().run(),
    active: () => editor.isActive('taskList'),
  });
  add({
    label: '→ Indent', title: 'Indent list item', group: 'lists', kind: 'list',
    run: () => editor.chain().focus().sinkListItem('listItem').run(),
    enabled: () => editor.can().sinkListItem('listItem'),
  });
  add({
    label: '← Outdent', title: 'Outdent list item', group: 'lists', kind: 'list',
    run: () => editor.chain().focus().liftListItem('listItem').run(),
    enabled: () => editor.can().liftListItem('listItem'),
  });

  /* ------------------------- Alignment group ----------------------- */
  for (const align of ['left', 'center', 'right', 'justify'] as const) {
    add({
      label: align === 'justify' ? 'Justify' : `Align ${align}`,
      title: `Align ${align}`,
      group: 'align',
      kind: 'align',
      run: () => editor.chain().focus().setTextAlign(align).run(),
      active: () => editor.isActive({ textAlign: align }),
    });
  }

  /* -------------------------- Table group -------------------------- */
  add({
    label: 'Table', title: 'Insert table (2x2 with header)', group: 'table', kind: 'table',
    run: () =>
      editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run(),
  });
  add({
    label: '+ Row', title: 'Add row below', group: 'table', kind: 'table',
    run: () => editor.chain().focus().addRowAfter().run(),
    enabled: () => editor.can().addRowAfter(),
  });
  add({
    label: '- Row', title: 'Delete row', group: 'table', kind: 'table',
    run: () => editor.chain().focus().deleteRow().run(),
    enabled: () => editor.can().deleteRow(),
  });
  add({
    label: '+ Col', title: 'Add column after', group: 'table', kind: 'table',
    run: () => editor.chain().focus().addColumnAfter().run(),
    enabled: () => editor.can().addColumnAfter(),
  });
  add({
    label: '- Col', title: 'Delete column', group: 'table', kind: 'table',
    run: () => editor.chain().focus().deleteColumn().run(),
    enabled: () => editor.can().deleteColumn(),
  });
  add({
    label: 'Header cell', title: 'Toggle header cell', group: 'table', kind: 'table',
    run: () => editor.chain().focus().toggleHeaderCell().run(),
    enabled: () => editor.can().toggleHeaderCell(),
  });

  /* -------------------------- Media group -------------------------- */
  add({
    label: 'Link', title: 'Insert or edit link', group: 'media', kind: 'action',
    run: callbacks.onInsertLink,
  });
  add({
    label: 'Image', title: 'Insert image with alt text', group: 'media', kind: 'action',
    run: callbacks.onInsertImage,
  });

  /* --------------------------- Tools group ------------------------- */
  add({
    label: 'Find', title: 'Find in note (Ctrl+F)', group: 'tools', kind: 'action',
    run: callbacks.onToggleFindBar,
  });
  add({
    label: 'HTML source', title: 'Toggle HTML source view (sanitised)', group: 'tools', kind: 'action',
    run: callbacks.onToggleSourceView,
  });
  add({
    label: 'Import MD', title: 'Import Markdown into this note', group: 'tools', kind: 'action',
    run: callbacks.onImportMarkdown,
  });
  add({
    label: 'Export MD', title: 'Export this note as Markdown', group: 'tools', kind: 'action',
    run: callbacks.onExportMarkdown,
  });
  add({
    label: 'Editor help', title: 'Toolbar and document schema documentation', group: 'tools', kind: 'action',
    run: callbacks.onShowDocumentation,
  });

  /* ------------------------- DOM rendering ------------------------- */

  let currentGroup = '';
  for (const button of buttons) {
    if (button.group !== currentGroup) {
      currentGroup = button.group;
      const separator = document.createElement('span');
      separator.className = 'editor-toolbar__separator';
      separator.setAttribute('role', 'separator');
      separator.setAttribute('aria-label', `${button.group} tools`);
      element.append(separator);
    }
    const control = document.createElement('button');
    control.type = 'button';
    control.className = 'editor-toolbar__button';
    control.textContent = button.label;
    control.title = button.title;
    control.setAttribute('aria-label', button.title);
    control.dataset['group'] = button.group;
    control.addEventListener('click', () => button.run());
    (control as unknown as { __sync: () => void }).__sync = () => {
      control.setAttribute('aria-pressed', String(button.active?.() ?? false));
      control.disabled = button.enabled?.() === false;
    };
    element.append(control);
  }

  /* ----------------------- Font size select ------------------------ */

  const sizeSelect = document.createElement('select');
  sizeSelect.className = 'select editor-toolbar__select';
  sizeSelect.setAttribute('aria-label', 'Font size');
  const sizeDefault = document.createElement('option');
  sizeDefault.value = '';
  sizeDefault.textContent = 'Font size';
  sizeSelect.append(sizeDefault);
  for (const size of FONT_SIZES) {
    const option = document.createElement('option');
    option.value = String(size);
    option.textContent = `${size}px`;
    sizeSelect.append(option);
  }
  sizeSelect.addEventListener('change', () => {
    const value = sizeSelect.value;
    if (value === '') {
      editor.chain().focus().unsetFontSize().run();
      return;
    }
    editor.chain().focus().setFontSize(`${value}px`).run();
  });
  element.append(sizeSelect);

  /* -------------------------- Colour rows -------------------------- */

  const colorRow = document.createElement('span');
  colorRow.className = 'editor-toolbar__colors';
  colorRow.setAttribute('role', 'group');
  colorRow.setAttribute('aria-label', 'Text colour');
  for (const color of TEXT_COLORS) {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'editor-toolbar__swatch';
    swatch.style.background = color;
    swatch.title = `Text colour ${color}`;
    swatch.setAttribute('aria-label', `Text colour ${color}`);
    swatch.addEventListener('click', () => editor.chain().focus().setColor(color).run());
    colorRow.append(swatch);
  }
  const clearColor = document.createElement('button');
  clearColor.type = 'button';
  clearColor.className = 'editor-toolbar__button';
  clearColor.textContent = 'No colour';
  clearColor.title = 'Remove text colour';
  clearColor.addEventListener('click', () => editor.chain().focus().unsetColor().run());
  colorRow.append(clearColor);
  element.append(colorRow);

  const highlightRow = document.createElement('span');
  highlightRow.className = 'editor-toolbar__colors';
  highlightRow.setAttribute('role', 'group');
  highlightRow.setAttribute('aria-label', 'Highlight colour');
  for (const color of HIGHLIGHT_COLORS) {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'editor-toolbar__swatch editor-toolbar__swatch--highlight';
    swatch.style.background = color;
    swatch.title = `Highlight ${color}`;
    swatch.setAttribute('aria-label', `Highlight ${color}`);
    swatch.addEventListener('click', () => editor.chain().focus().toggleHighlight({ color }).run());
    highlightRow.append(swatch);
  }
  const clearHighlight = document.createElement('button');
  clearHighlight.type = 'button';
  clearHighlight.className = 'editor-toolbar__button';
  clearHighlight.textContent = 'No highlight';
  clearHighlight.title = 'Remove highlight';
  clearHighlight.addEventListener('click', () => editor.chain().focus().unsetHighlight().run());
  highlightRow.append(clearHighlight);
  element.append(highlightRow);

  function sync(): void {
    for (const control of element.querySelectorAll<HTMLElement>(
      '.editor-toolbar__button',
    )) {
      const bound = (control as HTMLElement & { __sync?: () => void }).__sync;
      bound?.();
    }
    const activeSize = editor.getAttributes('textStyle')['fontSize'] as string | undefined;
    sizeSelect.value = activeSize ? activeSize.replace('px', '') : '';
  }

  return { element, sync };
}
