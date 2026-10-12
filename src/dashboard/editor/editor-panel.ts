/**
 * Editor panel (PRD §4.3/§4.4): title/subtitle fields, the Tiptap editor
 * with the exact §4.4 matrix, accessible toolbar, link and image dialogs
 * with safe external opening, find/replace bar, sanitised HTML source view,
 * Markdown import/export and in-app schema documentation. Content changes
 * are reported through callbacks — the autosave cadence is owned by T-018.
 */

import { Editor } from '@tiptap/core';
import { createEditorExtensions, PLACEHOLDER_TEXT } from './extensions';
import { createEditorToolbar, type EditorToolbar } from './toolbar';
import { sanitizeEditorHtml, isSafeLinkHref } from './sanitize';
import { markdownToEditorHtml, editorHtmlToMarkdown } from './markdown';
import { findMatches, nextMatch, previousMatch, replaceAllInText, type FindState } from './find-replace';
import { EDITOR_DOCUMENTATION } from './documentation';

export interface EditorPanelCallbacks {
  /** Content or metadata changed (dirty). */
  onChange(input: { title: string; subtitle: string }): void;
  /** Link activation must go through the app's safe-open policy. */
  onOpenLink(url: string): void;
}

export interface EditorPanelOptions {
  initial?: {
    title?: string;
    subtitle?: string;
    editorDoc?: object | null;
  };
}

export interface EditorPanel {
  readonly element: HTMLElement;
  readonly editor: Editor;
  getTitle(): string;
  getSubtitle(): string;
  getDocument(): object | null;
  getPlainText(): string;
  isDirty(): boolean;
  markSaved(): void;
  dispose(): void;
}

export function createEditorPanel(
  mount: HTMLElement,
  callbacks: EditorPanelCallbacks,
  options: EditorPanelOptions = {},
): EditorPanel {
  const element = document.createElement('div');
  element.className = 'editor-panel';

  /* ------------------------ Title/subtitle ------------------------- */

  const titleInput = document.createElement('input');
  titleInput.className = 'editor-panel__title';
  titleInput.type = 'text';
  titleInput.value = options.initial?.title ?? '';
  titleInput.placeholder = 'Untitled note';
  titleInput.setAttribute('aria-label', 'Note title');
  const subtitleInput = document.createElement('input');
  subtitleInput.className = 'editor-panel__subtitle';
  subtitleInput.type = 'text';
  subtitleInput.value = options.initial?.subtitle ?? '';
  subtitleInput.placeholder = 'Optional subtitle';
  subtitleInput.setAttribute('aria-label', 'Note subtitle');

  /* --------------------------- The editor -------------------------- */

  const editorHost = document.createElement('div');
  editorHost.className = 'editor-panel__host';

  let dirty = false;
  const markDirty = (): void => {
    dirty = true;
  };

  const editor = new Editor({
    element: editorHost,
    extensions: createEditorExtensions(),
    content: options.initial?.editorDoc ?? { type: 'doc', content: [{ type: 'paragraph' }] },
    editorProps: {
      // Rich paste is retained (ProseMirror parses the clipboard HTML
      // against our constrained schema); plain-text paste arrives when the
      // clipboard has no text/html flavour. Both paths pass the schema gate.
      handleClick: (view, pos, event) => {
        const target = event.target as HTMLElement | null;
        const anchor = target?.closest('a');
        if (anchor instanceof HTMLAnchorElement) {
          // Links open only through the app's safe-open callback.
          event.preventDefault();
          const href = anchor.getAttribute('href') ?? '';
          if (isSafeLinkHref(href)) callbacks.onOpenLink(href);
        }
        return false;
      },
    },
    onUpdate: () => {
      markDirty();
      callbacks.onChange({ title: titleInput.value, subtitle: subtitleInput.value });
    },
  });

  titleInput.addEventListener('input', () => {
    markDirty();
    callbacks.onChange({ title: titleInput.value, subtitle: subtitleInput.value });
  });
  subtitleInput.addEventListener('input', () => {
    markDirty();
    callbacks.onChange({ title: titleInput.value, subtitle: subtitleInput.value });
  });

  /* ------------------------- Find bar ------------------------------ */

  const findBar = document.createElement('div');
  findBar.className = 'editor-find';
  findBar.hidden = true;
  findBar.setAttribute('role', 'region');
  findBar.setAttribute('aria-label', 'Find and replace in note');
  const findInput = document.createElement('input');
  findInput.type = 'search';
  findInput.className = 'search-input';
  findInput.placeholder = 'Find in note';
  findInput.setAttribute('aria-label', 'Find in note');
  const caseBox = document.createElement('input');
  caseBox.type = 'checkbox';
  caseBox.id = 'find-case';
  const caseLabel = document.createElement('label');
  caseLabel.htmlFor = 'find-case';
  caseLabel.textContent = 'Match case';
  caseLabel.append(caseBox);
  const findStatus = document.createElement('span');
  findStatus.className = 'editor-find__status';
  findStatus.setAttribute('aria-live', 'polite');
  const replaceInput = document.createElement('input');
  replaceInput.type = 'text';
  replaceInput.className = 'search-input';
  replaceInput.placeholder = 'Replace with';
  replaceInput.setAttribute('aria-label', 'Replace with');
  const replaceOne = document.createElement('button');
  replaceOne.type = 'button';
  replaceOne.className = 'btn';
  replaceOne.textContent = 'Replace';
  const replaceAllButton = document.createElement('button');
  replaceAllButton.type = 'button';
  replaceAllButton.className = 'btn';
  replaceAllButton.textContent = 'Replace all';
  const prevButton = document.createElement('button');
  prevButton.type = 'button';
  prevButton.className = 'btn';
  prevButton.textContent = 'Previous';
  const nextButton = document.createElement('button');
  nextButton.type = 'button';
  nextButton.className = 'btn';
  nextButton.textContent = 'Next';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'btn btn--ghost';
  closeButton.textContent = 'Close';
  findBar.append(
    findInput, caseLabel, prevButton, nextButton, replaceInput, replaceOne,
    replaceAllButton, findStatus, closeButton,
  );

  let findState: FindState = { matches: [], activeIndex: -1 };
  const refreshFind = (): void => {
    findState = {
      matches: findMatches(editor.getText(), findInput.value, {
        caseSensitive: caseBox.checked,
      }),
      activeIndex: 0,
    };
    findStatus.textContent =
      findInput.value.length === 0
        ? ''
        : findState.matches.length === 0
          ? 'No matches'
          : `${findState.matches.length} match${findState.matches.length === 1 ? '' : 'es'}`;
    highlightActive();
  };
  const highlightActive = (): void => {
    const match = findState.matches[findState.activeIndex];
    if (!match) return;
    findStatus.textContent = `${findState.activeIndex + 1} of ${findState.matches.length}`;
  };
  findInput.addEventListener('input', refreshFind);
  caseBox.addEventListener('change', refreshFind);
  nextButton.addEventListener('click', () => {
    findState = nextMatch(findState);
    highlightActive();
  });
  prevButton.addEventListener('click', () => {
    findState = previousMatch(findState);
    highlightActive();
  });
  replaceOne.addEventListener('click', () => {
    const match = findState.matches[findState.activeIndex];
    if (!match) return;
    // Replace through the text projection, then reload as sanitised HTML
    // (small, correct, and schema-gated).
    const text = editor.getText();
    const updated =
      text.slice(0, match.from) + replaceInput.value + text.slice(match.to);
    editor.commands.setContent(`<p>${escapeHtml(updated)}</p>`, { emitUpdate: true });
    refreshFind();
  });
  replaceAllButton.addEventListener('click', () => {
    if (findInput.value.length === 0) return;
    const updated = replaceAllInText(
      editor.getText(),
      findInput.value,
      replaceInput.value,
      caseBox.checked,
    );
    editor.commands.setContent(`<p>${escapeHtml(updated)}</p>`, { emitUpdate: true });
    refreshFind();
  });
  closeButton.addEventListener('click', () => {
    findBar.hidden = true;
  });

  /* ------------------------ Source view ---------------------------- */

  const sourceView = document.createElement('textarea');
  sourceView.className = 'editor-source';
  sourceView.hidden = true;
  sourceView.setAttribute('aria-label', 'HTML source view (sanitised)');
  sourceView.spellcheck = false;

  const applySource = (): void => {
    const { html, removed } = sanitizeEditorHtml(sourceView.value);
    editor.commands.setContent(html, { emitUpdate: true });
    if (removed.length > 0 || sourceView.value !== html) {
      findStatus.textContent = 'Some unsafe content was removed.';
    }
    sourceView.value = html;
  };
  sourceView.addEventListener('blur', applySource);

  /* --------------------------- Dialogs ----------------------------- */

  function dialogShell(title: string): { dialog: HTMLDialogElement; body: HTMLElement; actions: HTMLElement } {
    const dialog = document.createElement('dialog');
    dialog.className = 'dialog';
    const heading = document.createElement('h2');
    heading.textContent = title;
    const body = document.createElement('div');
    const actions = document.createElement('div');
    actions.className = 'dialog__actions';
    dialog.append(heading, body, actions);
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    return { dialog, body, actions };
  }

  const insertLinkDialog = (): void => {
    const { dialog, body, actions } = dialogShell('Insert or edit link');
    const field = document.createElement('label');
    field.className = 'dialog__field';
    field.textContent = 'Link URL (https://, http:// or mailto:)';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'search-input';
    input.value = editor.getAttributes('link')['href'] as string | undefined ?? '';
    field.append(input);
    const labelField = document.createElement('label');
    labelField.className = 'dialog__field';
    labelField.textContent = 'Link text (empty keeps the selection)';
    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'search-input';
    labelField.append(labelInput);
    const warning = document.createElement('p');
    warning.className = 'dialog__warning';
    warning.hidden = true;
    warning.textContent = 'That URL is not an approved link protocol.';
    body.append(field, labelField, warning);

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => dialog.close());
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'btn btn--primary';
    apply.textContent = 'Apply';
    apply.addEventListener('click', () => {
      const url = input.value.trim();
      if (!isSafeLinkHref(url)) {
        warning.hidden = false;
        return;
      }
      const text = labelInput.value;
      if (text.length > 0 && editor.state.selection.empty) {
        editor
          .chain()
          .focus()
          .insertContent({ type: 'text', text, marks: [{ type: 'link', attrs: { href: url } }] })
          .run();
      } else {
        editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
      }
      dialog.close();
    });
    actions.append(cancel, apply);
    dialog.showModal();
    input.focus();
  };

  const insertImageDialog = (): void => {
    const { dialog, body, actions } = dialogShell('Insert image');
    const srcField = document.createElement('label');
    srcField.className = 'dialog__field';
    srcField.textContent = 'Image source (data: URL or local file in T-019)';
    const srcInput = document.createElement('input');
    srcInput.type = 'text';
    srcInput.className = 'search-input';
    srcInput.placeholder = 'data:image/png;base64,…';
    srcField.append(srcInput);
    const altField = document.createElement('label');
    altField.className = 'dialog__field';
    altField.textContent = 'Alt text (describe the image)';
    const altInput = document.createElement('input');
    altInput.type = 'text';
    altInput.className = 'search-input';
    altField.append(altInput);
    const captionField = document.createElement('label');
    captionField.className = 'dialog__field';
    captionField.textContent = 'Caption (optional)';
    const captionInput = document.createElement('input');
    captionInput.type = 'text';
    captionInput.className = 'search-input';
    captionField.append(captionInput);
    body.append(srcField, altField, captionField);

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => dialog.close());
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'btn btn--primary';
    apply.textContent = 'Insert';
    apply.addEventListener('click', () => {
      const src = srcInput.value.trim();
      if (!src.startsWith('data:image/')) return; // files arrive with T-019
      editor.chain().focus().setImage({ src, alt: altInput.value }).run();
      dialog.close();
    });
    actions.append(cancel, apply);
    dialog.showModal();
  };

  const showDocumentation = (): void => {
    const { dialog, body, actions } = dialogShell('Editor documentation');
    const content = document.createElement('div');
    content.className = 'editor-docs';
    content.innerHTML = EDITOR_DOCUMENTATION; // static trusted constant
    body.append(content);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn btn--primary';
    close.textContent = 'Close';
    close.addEventListener('click', () => dialog.close());
    actions.append(close);
    dialog.showModal();
  };

  const importMarkdownDialog = (): void => {
    const { dialog, body, actions } = dialogShell('Import Markdown');
    const field = document.createElement('label');
    field.className = 'dialog__field';
    field.textContent = 'Markdown to insert at the end of this note';
    const textarea = document.createElement('textarea');
    textarea.className = 'editor-source';
    textarea.rows = 10;
    field.append(textarea);
    body.append(field);
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => dialog.close());
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'btn btn--primary';
    apply.textContent = 'Import';
    apply.addEventListener('click', () => {
      const html = markdownToEditorHtml(textarea.value);
      editor.commands.insertContent(html);
      dialog.close();
    });
    actions.append(cancel, apply);
    dialog.showModal();
  };

  const exportMarkdown = (): void => {
    const markdown = editorHtmlToMarkdown(editor.getHTML());
    const { dialog, body, actions } = dialogShell('Export Markdown');
    const field = document.createElement('label');
    field.className = 'dialog__field';
    field.textContent = 'Markdown output (copy or save via the note export actions)';
    const textarea = document.createElement('textarea');
    textarea.className = 'editor-source';
    textarea.rows = 14;
    textarea.readOnly = true;
    textarea.value = markdown;
    field.append(textarea);
    body.append(field);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn btn--primary';
    close.textContent = 'Close';
    close.addEventListener('click', () => dialog.close());
    actions.append(close);
    dialog.showModal();
  };

  /* --------------------------- Toolbar ----------------------------- */

  const toolbar: EditorToolbar = createEditorToolbar(editor, {
    onInsertLink: insertLinkDialog,
    onInsertImage: insertImageDialog,
    onToggleFindBar: () => {
      findBar.hidden = !findBar.hidden;
      if (!findBar.hidden) {
        findInput.focus();
        refreshFind();
      }
    },
    onToggleSourceView: () => {
      if (sourceView.hidden) {
        sourceView.value = editor.getHTML();
        sourceView.hidden = false;
        editorHost.hidden = true;
        sourceView.focus();
      } else {
        applySource();
        sourceView.hidden = true;
        editorHost.hidden = false;
        editor.commands.focus();
      }
    },
    onImportMarkdown: importMarkdownDialog,
    onExportMarkdown: exportMarkdown,
    onShowDocumentation: showDocumentation,
  });
  const syncToolbar = (): void => toolbar.sync();
  editor.on('selectionUpdate', syncToolbar);
  editor.on('transaction', syncToolbar);

  /* ------------------------ Keyboard: Ctrl+F ----------------------- */

  const onKeyDown = (event: KeyboardEvent): void => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      findBar.hidden = false;
      findInput.focus();
      findInput.select();
    }
  };
  element.addEventListener('keydown', onKeyDown);

  /* --------------------------- Assemble ---------------------------- */

  element.append(titleInput, subtitleInput, toolbar.element, findBar, editorHost, sourceView);
  mount.append(element);

  return {
    element,
    editor,
    getTitle: () => titleInput.value,
    getSubtitle: () => subtitleInput.value,
    getDocument: () => (editor.isEmpty ? null : editor.getJSON()),
    getPlainText: () => editor.getText(),
    isDirty: () => dirty,
    markSaved: () => {
      dirty = false;
    },
    dispose(): void {
      editor.off('selectionUpdate', syncToolbar);
      editor.off('transaction', syncToolbar);
      editor.destroy();
      element.removeEventListener('keydown', onKeyDown);
      element.remove();
    },
  };
}

function escapeHtml(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    )
    .join('</p><p>');
}

export { PLACEHOLDER_TEXT };
