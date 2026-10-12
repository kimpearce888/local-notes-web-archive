// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../../src/dashboard/state/client';
import {
  openEditorSession,
  type EditorSessionCallbacks,
} from '../../../src/dashboard/state/editor-session';
import { createSnapshotsApi } from '../../../src/dashboard/state/snapshot-client';
import { createRemindersApi } from '../../../src/dashboard/state/reminders-client';
import { clearRecoveryJournal } from '../../../src/dashboard/editor/recovery';
import { MessageRouter } from '../../../src/background/router';
import { registerAllApi } from '../../../src/background/api';
import { closeWorkerResources } from '../../../src/background/db';
import { DB_NAME } from '../../../src/core/version';
import { DEFAULT_MAX_ATTACHMENT_BYTES } from '../../../src/core/repo/attachments';
import type { Attachment, Note } from '../../../src/core/types';

/**
 * T-019 end-to-end over the real router: pasted/dropped image files become
 * blob-store attachments referenced by durable `attachment:` srcs (never
 * session blob: URLs), non-image files attach as note files with truthful
 * outcomes, the attachments panel lists/renames/deletes/downloads them, and
 * oversized files are rejected before any write.
 */

type Transport = Parameters<typeof createApiClient>[0];

let root: HTMLElement;
let router: MessageRouter;
let objectUrlCounter = 0;
const revokedUrls: string[] = [];

const transport: Transport = async (message) => router.dispatch(message);
const client = () => createApiClient(transport);

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x00]);

async function flush(millis = 15): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, millis));
}

async function waitFor<T>(probe: () => T | Promise<T>, timeoutMs = 4000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await flush(10);
  }
}

beforeEach(() => {
  (window as unknown as { matchMedia: unknown }).matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as MediaQueryList;
  // jsdom 30 knows <dialog> and its reflected `open` flag but not
  // showModal/close — polyfill exactly those two (the app uses the real
  // methods in Chrome; E2E exercises the native behaviour).
  const dialogProto = HTMLDialogElement.prototype as HTMLDialogElement & {
    showModal?: () => void;
    close?: () => void;
  };
  dialogProto.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  dialogProto.close ??= function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
  // jsdom has no object URLs — stub them for the resolver and downloads.
  objectUrlCounter = 0;
  revokedUrls.length = 0;
  (window as unknown as { URL: typeof URL }).URL.createObjectURL = vi.fn(
    () => `blob:object-${++objectUrlCounter}`,
  );
  (window as unknown as { URL: typeof URL }).URL.revokeObjectURL = vi.fn((url: string) => {
    revokedUrls.push(url);
  });
  clearRecoveryJournal();
  root = document.createElement('div');
  document.body.appendChild(root);
  router = new MessageRouter();
  registerAllApi(router);
});

afterEach(async () => {
  clearRecoveryJournal();
  root.remove();
  await closeWorkerResources();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
});

async function seedNote(title: string): Promise<Note> {
  const { note } = await client().request('notes/create', { title, plainText: 'seed' });
  return note;
}

function makeCallbacks(announce: (message: string) => void = () => undefined): EditorSessionCallbacks {
  return {
    getRevisions: async (noteId) => (await client().request('notes/revisions', { noteId })).revisions,
    saveNoteDetailed: async (input) => {
      try {
        const { note } = await client().request('notes/save', input);
        return { ok: true, note };
      } catch (error) {
        return {
          ok: false,
          code: (error as { code?: 'conflict' }).code ?? 'internal-error',
        };
      }
    },
    getNote: async (noteId) => (await client().request('notes/get', { noteId })).note,
    duplicateWithContent: async () => null,
    announce,
    onOpenLink: () => undefined,
    detectLinks: async (input) => {
      try {
        const { results } = await client().request('links/detect-and-queue', {
          noteId: input.noteId,
          urls: [...input.urls],
          source: input.source,
        });
        return {
          created: results.filter((r) => r.outcome === 'created').length,
          queued: results.filter((r) => r.link?.captureState === 'queued').length,
          existing: results.filter((r) => r.outcome === 'existing').length,
          rejected: results.filter((r) => r.outcome === 'rejected').length,
        };
      } catch {
        return null;
      }
    },
    attachments: {
      add: async (input) =>
        client().request('attachments/add', {
          noteId: input.noteId,
          filename: input.filename,
          declaredMimeType: input.declaredMimeType,
          data: input.data,
        }),
      list: async (noteId) =>
        (await client().request('attachments/list-for-note', { noteId })).attachments,
      getBlob: async (attachmentId) =>
        (await client().request('attachments/get-blob', { attachmentId })).blob,
      rename: async (attachmentId, filename) => {
        try {
          await client().request('attachments/rename', { attachmentId, filename });
          return true;
        } catch {
          return false;
        }
      },
      remove: async (attachmentId) => {
        try {
          await client().request('attachments/delete', { attachmentId });
          return true;
        } catch {
          return false;
        }
      },
    },
    snapshots: createSnapshotsApi(client()),
    reminders: createRemindersApi(client()),
  };
}

/** Dispatch a paste event carrying files onto the editor's editable DOM. */
function pasteFiles(session: { editor: { view: { dom: HTMLElement } } }, files: File[]): void {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  // ProseMirror parses the clipboard BEFORE handlePaste runs, so the stub
  // needs the text accessors (all empty — only files matter here).
  Object.defineProperty(event, 'clipboardData', {
    value: {
      files: files as unknown as FileList,
      types: ['Files'],
      getData: () => '',
    },
  });
  session.editor.view.dom.dispatchEvent(event);
}

function imageFile(name = 'pasted.png'): File {
  return new File([PNG_BYTES], name, { type: 'image/png' });
}

function documentNode(session: {
  editor: { getJSON: () => { content?: { type: string; attrs?: Record<string, unknown> }[] } };
}): { type: string; attrs?: Record<string, unknown> } | undefined {
  return session.editor.getJSON().content?.find((node) => node.type === 'image');
}

describe('pasting and dropping image files', () => {
  it('stores the binary and inserts a durable attachment reference', async () => {
    const note = await seedNote('Paste image note');
    const announced: string[] = [];
    const session = await openEditorSession({
      mount: root,
      note,
      callbacks: makeCallbacks((message) => announced.push(message)),
    });

    pasteFiles(session, [imageFile()]);
    await waitFor(() => documentNode(session) !== undefined);

    const image = documentNode(session);
    expect(image?.attrs?.src).toMatch(/^attachment:[0-9a-f-]{36}$/);

    const { attachments } = await client().request('attachments/list-for-note', {
      noteId: note.id,
    });
    expect(attachments).toHaveLength(1);
    expect(attachments[0]!.mimeType).toBe('image/png');
    expect(attachments[0]!.size).toBe(PNG_BYTES.byteLength);

    // The image renders through a resolved object URL…
    await waitFor(() => {
      const img = root.querySelector('figure.editor-image img') as HTMLImageElement | null;
      return img !== null && img.src.startsWith('blob:object-');
    });
    // …and the announcement is truthful.
    expect(announced.some((message) => message.includes('Inserted pasted.png'))).toBe(true);
    await session.close();
  });

  it('reuses stored content when the same image is pasted twice', async () => {
    const note = await seedNote('Dedup paste note');
    const session = await openEditorSession({ mount: root, note, callbacks: makeCallbacks() });
    pasteFiles(session, [imageFile('same.png')]);
    await waitFor(() => documentNode(session) !== undefined);
    pasteFiles(session, [imageFile('same.png')]);
    await waitFor(() => {
      const content = session.editor.getJSON().content ?? [];
      return content.filter((node) => node.type === 'image').length === 2;
    });
    const { attachments } = await client().request('attachments/list-for-note', {
      noteId: note.id,
    });
    expect(attachments).toHaveLength(1);
    await session.close();
  });

  it('attaches non-image files as note attachments instead of nodes', async () => {
    const note = await seedNote('Paste pdf note');
    const announced: string[] = [];
    const session = await openEditorSession({
      mount: root,
      note,
      callbacks: makeCallbacks((message) => announced.push(message)),
    });
    const pdf = new File([PDF_BYTES], 'report.pdf', { type: 'application/pdf' });
    pasteFiles(session, [pdf]);
    await waitFor(() =>
      announced.some((message) => message.includes('Attached report.pdf')),
    );
    expect(documentNode(session)).toBeUndefined();
    const { attachments } = await client().request('attachments/list-for-note', {
      noteId: note.id,
    });
    expect(attachments).toHaveLength(1);
    expect(attachments[0]!.mimeType).toBe('application/pdf');
    await session.close();
  });

  it('reports a verified non-image honestly when pasted as an image', async () => {
    const note = await seedNote('Mislabelled note');
    const announced: string[] = [];
    const session = await openEditorSession({
      mount: root,
      note,
      callbacks: makeCallbacks((message) => announced.push(message)),
    });
    // Declared image/png but the bytes are a PDF — the verifier decides.
    const disguised = new File([PDF_BYTES], 'fake.png', { type: 'image/png' });
    pasteFiles(session, [disguised]);
    await waitFor(() =>
      announced.some((message) => message.includes('was verified as application/pdf')),
    );
    expect(documentNode(session)).toBeUndefined();
    const { attachments } = await client().request('attachments/list-for-note', {
      noteId: note.id,
    });
    expect(attachments).toHaveLength(1);
    expect(attachments[0]!.mimeType).toBe('application/pdf');
    await session.close();
  });

  it('rejects oversized images before storing anything', async () => {
    const note = await seedNote('Too large note');
    const announced: string[] = [];
    const session = await openEditorSession({
      mount: root,
      note,
      callbacks: makeCallbacks((message) => announced.push(message)),
    });
    const huge = new File(
      [new Uint8Array(DEFAULT_MAX_ATTACHMENT_BYTES + 1)],
      'huge.png',
      { type: 'image/png' },
    );
    pasteFiles(session, [huge]);
    await waitFor(() =>
      announced.some((message) => message.includes('the limit is')),
    );
    expect(documentNode(session)).toBeUndefined();
    const { attachments } = await client().request('attachments/list-for-note', {
      noteId: note.id,
    });
    expect(attachments).toHaveLength(0);
    await session.close();
  });

  it('never writes session blob: URLs into the saved document', async () => {
    const note = await seedNote('Durable src note');
    const session = await openEditorSession({ mount: root, note, callbacks: makeCallbacks() });
    pasteFiles(session, [imageFile('durable.png')]);
    await waitFor(() => documentNode(session) !== undefined);
    await waitFor(async () => {
      const fresh = (await client().request('notes/get', { noteId: note.id })).note;
      const content = (fresh.editorDoc as { content?: unknown[] } | null)?.content ?? [];
      return content.some((node) => (node as { type?: string }).type === 'image');
    });
    const fresh = (await client().request('notes/get', { noteId: note.id })).note;
    const serialized = JSON.stringify(fresh.editorDoc);
    expect(serialized).toContain('attachment:');
    expect(serialized).not.toContain('blob:object-');
    await session.close();
    // Closing the session revokes the object URLs it created.
    await waitFor(() => revokedUrls.length > 0);
  });
});

describe('attachments panel', () => {
  async function openSessionWithAttachment(): Promise<{
    session: Awaited<ReturnType<typeof openEditorSession>>;
    note: Note;
    attachment: Attachment;
  }> {
    const note = await seedNote('Panel note');
    const session = await openEditorSession({ mount: root, note, callbacks: makeCallbacks() });
    pasteFiles(session, [imageFile('panel-image.png')]);
    await waitFor(() => documentNode(session) !== undefined);
    const { attachments } = await client().request('attachments/list-for-note', {
      noteId: note.id,
    });
    return { session, note, attachment: attachments[0]! };
  }

  function toggleButton(session: { element: HTMLElement }): HTMLButtonElement {
    const button = session.element.querySelector(
      '.editor-session__header button',
    ) as HTMLButtonElement | null;
    const all = Array.from(
      session.element.querySelectorAll('.editor-session__header button'),
    ) as HTMLButtonElement[];
    const found = all.find((candidate) => candidate.textContent?.startsWith('Attachments'));
    return found ?? (button as HTMLButtonElement);
  }

  it('lists attachments with filename/type/size and download/open actions', async () => {
    const { session, note } = await openSessionWithAttachment();
    await waitFor(() => toggleButton(session).textContent?.includes('(1)'));

    toggleButton(session).click();
    await waitFor(() => root.querySelector('.attachments-panel__row') !== null);

    const row = root.querySelector('.attachments-panel__row') as HTMLElement;
    expect(row.querySelector('.attachments-panel__name')?.textContent).toBe('panel-image.png');
    expect(row.querySelector('.attachments-panel__meta')?.textContent).toContain('image/png');
    const actionLabels = Array.from(row.querySelectorAll('button')).map((b) => b.textContent);
    expect(actionLabels).toContain('Download');
    expect(actionLabels).toContain('Open');
    expect(actionLabels).toContain('Rename');
    expect(actionLabels).toContain('Delete…');
    void note;
    await session.close();
  });

  it('renames an attachment through the dialog', async () => {
    const { session, note } = await openSessionWithAttachment();
    toggleButton(session).click();
    await waitFor(() => root.querySelector('.attachments-panel__row') !== null);

    const renameButton = Array.from(
      root.querySelectorAll('.attachments-panel__row button'),
    ).find((button) => button.textContent === 'Rename') as HTMLButtonElement;
    renameButton.click();
    const dialog = (await waitFor(
      () => document.querySelector('dialog') as HTMLDialogElement | null,
    ))!;
    const input = dialog.querySelector('input.search-input') as HTMLInputElement;
    input.value = 'renamed-image.png';
    const save = Array.from(dialog.querySelectorAll('button')).find(
      (button) => button.textContent === 'Rename',
    ) as HTMLButtonElement;
    save.click();
    await waitFor(async () => {
      const { attachments } = await client().request('attachments/list-for-note', {
        noteId: note.id,
      });
      return attachments[0]?.filename === 'renamed-image.png';
    });

    const { attachments } = await client().request('attachments/list-for-note', {
      noteId: note.id,
    });
    expect(attachments[0]!.filename).toBe('renamed-image.png');
    await waitFor(
      () =>
        root.querySelector('.attachments-panel__name')?.textContent === 'renamed-image.png',
    );
    await session.close();
  });

  it('deletes an attachment after explicit confirmation', async () => {
    const { session, note } = await openSessionWithAttachment();
    toggleButton(session).click();
    await waitFor(() => root.querySelector('.attachments-panel__row') !== null);

    const deleteButton = Array.from(
      root.querySelectorAll('.attachments-panel__row button'),
    ).find((button) => button.textContent === 'Delete…') as HTMLButtonElement;
    deleteButton.click();
    const dialog = (await waitFor(
      () => document.querySelector('dialog') as HTMLDialogElement | null,
    ))!;
    const confirm = Array.from(dialog.querySelectorAll('button')).find(
      (button) => button.textContent === 'Delete attachment',
    ) as HTMLButtonElement;
    confirm.click();
    await waitFor(async () => {
      const { attachments } = await client().request('attachments/list-for-note', {
        noteId: note.id,
      });
      return attachments.length === 0;
    });

    const { attachments } = await client().request('attachments/list-for-note', {
      noteId: note.id,
    });
    expect(attachments).toHaveLength(0);
    await session.close();
  });

  it('downloads through an object-URL anchor in the dashboard context', async () => {
    const { session } = await openSessionWithAttachment();
    toggleButton(session).click();
    await waitFor(() => root.querySelector('.attachments-panel__row') !== null);

    const clicks: { download: string | null; href: string }[] = [];
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicks.push({ download: this.getAttribute('download'), href: this.href });
      });

    const downloadButton = Array.from(
      root.querySelectorAll('.attachments-panel__row button'),
    ).find((button) => button.textContent === 'Download') as HTMLButtonElement;
    downloadButton.click();
    await waitFor(() => clicks.length > 0);

    expect(clicks[0]!.download).toBe('panel-image.png');
    expect(clicks[0]!.href).toMatch(/^blob:object-/);
    clickSpy.mockRestore();
    await session.close();
  });
});
