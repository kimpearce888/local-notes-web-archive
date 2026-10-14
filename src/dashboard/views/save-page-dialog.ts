/**
 * Save-a-web-page dialog (T-089, T-084 register UX-13): the visible entry
 * point for the web-archive feature. Before this dialog the ONLY ways to
 * capture a page were pasting a URL into a note (a transient toast as the
 * sole feedback) or the context menu — a user who wanted to archive a page
 * had no discoverable action. This dialog: paste an http(s) link → a note
 * is created linking the page and the capture is queued through the exact
 * same pipeline the context menu and paste-into-note use. The per-origin
 * permission ask happens in the capture pipeline afterwards (FR-CAP-04).
 */

export interface SavePageDialogCallbacks {
  /** Save the URL (capture/save-url). Resolves queued=false when the link
   * gate rejected the URL — the note still exists. Rejects on failure. */
  saveUrl(url: string): Promise<{ queued: boolean }>;
  announce(message: string): void;
}

export interface SavePageDialog {
  open(): void;
  dispose(): void;
}

export function createSavePageDialog(callbacks: SavePageDialogCallbacks): SavePageDialog {
  const dialog = document.createElement('dialog');
  dialog.className = 'dialog dialog--save-page';
  dialog.setAttribute('aria-labelledby', 'save-page-title');

  const heading = document.createElement('h2');
  heading.id = 'save-page-title';
  heading.textContent = 'Save a web page';

  const intro = document.createElement('p');
  intro.className = 'save-page__intro';
  intro.textContent =
    'Paste a link (http or https). A note is created for the page and a complete offline copy is captured — you will be asked before the extension accesses that site.';

  const field = document.createElement('label');
  field.className = 'dialog__field';
  field.textContent = 'Page link';
  const input = document.createElement('input');
  input.type = 'url';
  input.className = 'search-input';
  input.id = 'save-page-input';
  input.placeholder = 'https://example.com/article';
  input.setAttribute('aria-label', 'Page link to save');
  input.spellcheck = false;
  field.append(input);

  const status = document.createElement('p');
  status.className = 'save-page__status';
  status.setAttribute('aria-live', 'polite');
  status.hidden = true;

  const actions = document.createElement('div');
  actions.className = 'dialog__actions';

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn';
  cancelButton.textContent = 'Cancel';
  cancelButton.addEventListener('click', () => dialog.close());

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'btn btn--primary';
  saveButton.textContent = 'Save page';
  saveButton.addEventListener('click', () => void submit());

  async function submit(): Promise<void> {
    const url = input.value.trim();
    if (url.length === 0) {
      status.textContent = 'Paste a page link first.';
      status.hidden = false;
      return;
    }
    if (!/^https?:\/\/.+/i.test(url)) {
      status.textContent = 'Only http(s) links can be saved — the address should start with http:// or https://.';
      status.hidden = false;
      input.focus();
      return;
    }
    saveButton.disabled = true;
    status.textContent = 'Saving…';
    status.hidden = false;
    try {
      const { queued } = await callbacks.saveUrl(url);
      dialog.close();
      callbacks.announce(
        queued
          ? `Saved ${url} as a note — the page capture is being prepared.`
          : `Saved ${url} as a note, but the link was not accepted for capture.`,
      );
    } catch {
      status.textContent = 'Saving the page failed — nothing was created. Try again.';
      status.hidden = false;
    } finally {
      saveButton.disabled = false;
    }
  }

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void submit();
    }
  });
  dialog.addEventListener('close', () => {
    // Reset for the next open — a dialog that remembers a stale error (or a
    // stale URL) is exactly the "no clue what to do" pattern T-084 flagged.
    input.value = '';
    status.textContent = '';
    status.hidden = true;
    saveButton.disabled = false;
  });

  actions.append(cancelButton, saveButton);
  dialog.append(heading, intro, field, status, actions);
  document.body.append(dialog);

  return {
    open(): void {
      if (!dialog.open) dialog.showModal();
      input.focus();
    },
    dispose(): void {
      dialog.remove();
    },
  };
}
