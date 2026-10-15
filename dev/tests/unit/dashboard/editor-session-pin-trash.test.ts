// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApiClient } from '../../../../src/dashboard/state/client';
import { openEditorSession, type EditorSessionCallbacks } from '../../../../src/dashboard/state/editor-session';
import { createSnapshotsApi } from '../../../../src/dashboard/state/snapshot-client';
import { createRemindersApi } from '../../../../src/dashboard/state/reminders-client';
import { clearRecoveryJournal } from '../../../../src/dashboard/editor/recovery';
import { MessageRouter } from '../../../../src/background/router';
import { registerAllApi } from '../../../../src/background/api';
import { closeWorkerResources } from '../../../../src/background/db';
import { DB_NAME } from '../../../../src/core/version';
import type { EntityId, Note } from '../../../../src/core/types';

/**
 * T-054 (user report, 2026-10-13): pin and trash must work FROM THE
 * EDITOR. The editor header previously offered no pin or trash action at
 * all — a user inside a note could not pin it or move it to trash (the
 * reported "pin, trash is not working from editor"). These tests drive
 * the real session over the REAL router + repositories: the pin toggle
 * persists through notes/set-flags with an honest failure surface, and
 * the confirmed Move-to-trash flushes pending edits first, trashes
 * through notes/trash, announces, and closes through the controller flow.
 */

type Transport = Parameters<typeof createApiClient>[0];

let root: HTMLElement;
let router: MessageRouter;

const transport: Transport = async (message) => router.dispatch(message);
const client = () => createApiClient(transport);

function flush(millis = 10): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, millis));
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
  // jsdom dialog polyfill (same pattern as bulk-bar-dialogs.test.ts).
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
  clearRecoveryJournal();
  root = document.createElement('div');
  document.body.appendChild(root);
  router = new MessageRouter();
  registerAllApi(router);
});

afterEach(async () => {
  clearRecoveryJournal();
  root.remove();
  document.body.replaceChildren();
  await closeWorkerResources();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
});

async function seedNote(title: string, plainText: string): Promise<Note> {
  const { note } = await client().request('notes/create', { title, plainText });
  return note;
}

function makeCallbacks(overrides: Partial<EditorSessionCallbacks> = {}): EditorSessionCallbacks {
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
    announce: () => undefined,
    onOpenLink: () => undefined,
    detectLinks: async () => null,
    attachments: {
      add: async () => {
        throw new Error('attachments not exercised in this test');
      },
      list: async () => [],
      getBlob: async () => null,
      rename: async () => false,
      remove: async () => false,
    },
    snapshots: createSnapshotsApi(client()),
    reminders: createRemindersApi(client()),
    transfer: {
      exportFile: async () => {
        throw new Error('export not exercised in this test');
      },
    },
    ai: {
      chat: async () => ({
        reply: '',
        toolCalls: [],
        error: { code: 'disabled', message: 'AI is off in this test' },
        model: null,
      }),
      isEnabled: async () => false,
    },
    ...overrides,
  };
}

/** The production wiring: set-flags and trash through the real RPC. */
const realSetPinned = async (noteId: EntityId, pinned: boolean): Promise<boolean> => {
  try {
    await client().request('notes/set-flags', { noteId, pinned });
    return true;
  } catch {
    return false;
  }
};

const realTrashNote = async (noteId: EntityId): Promise<boolean> => {
  try {
    await client().request('notes/trash', { noteId });
    return true;
  } catch {
    return false;
  }
};

function headerButton(session: { element: HTMLElement }, label: string): HTMLButtonElement {
  const button = [...session.element.querySelectorAll('.editor-session__header button')].find(
    (candidate) => candidate.textContent === label,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`header button "${label}" not found`);
  }
  return button;
}

describe('pin from the editor (T-054)', () => {
  it('pins and unpins through notes/set-flags with honest announcements', async () => {
    const note = await seedNote('Pin me', 'pin target');
    const mount = document.createElement('div');
    root.append(mount);
    const announced: string[] = [];
    const session = await openEditorSession({
      mount,
      note,
      callbacks: makeCallbacks({
        setPinned: realSetPinned,
        announce: (message) => announced.push(message),
      }),
    });

    const pinButton = headerButton(session, 'Pin');
    pinButton.click();
    await waitFor(() => announced.includes('Note pinned.'));
    expect((await client().request('notes/get', { noteId: note.id })).note.pinned).toBe(true);
    expect(headerButton(session, 'Unpin').disabled).toBe(false);

    headerButton(session, 'Unpin').click();
    await waitFor(() => announced.includes('Note unpinned.'));
    expect((await client().request('notes/get', { noteId: note.id })).note.pinned).toBe(false);
    expect(headerButton(session, 'Pin').textContent).toBe('Pin');

    await session.close();
  });

  it('reflects the pinned state on open and announces failures honestly', async () => {
    const note = await seedNote('Already pinned', 'pinned body');
    await client().request('notes/set-flags', { noteId: note.id, pinned: true });
    const mount = document.createElement('div');
    root.append(mount);
    const announced: string[] = [];
    const session = await openEditorSession({
      mount,
      note: (await client().request('notes/get', { noteId: note.id })).note,
      callbacks: makeCallbacks({
        setPinned: async () => false, // controller reports failure
        announce: (message) => announced.push(message),
      }),
    });

    // Label mirrors the persisted state on open.
    expect(headerButton(session, 'Unpin').textContent).toBe('Unpin');

    headerButton(session, 'Unpin').click();
    await waitFor(() => announced.includes('Updating the pin failed — please try again.'));
    // The flag was NOT flipped and the label still mirrors the truth.
    expect((await client().request('notes/get', { noteId: note.id })).note.pinned).toBe(true);
    expect(headerButton(session, 'Unpin').textContent).toBe('Unpin');

    await session.close();
  });

  it('hides the pin action when no controller wiring provides it', async () => {
    const note = await seedNote('No pin wiring', 'body');
    const mount = document.createElement('div');
    root.append(mount);
    const session = await openEditorSession({
      mount,
      note,
      callbacks: makeCallbacks(), // isolated-test shape: no setPinned
    });

    const pin = [...session.element.querySelectorAll<HTMLButtonElement>('.editor-session__header button')].find(
      (candidate) => candidate.textContent === 'Pin' || candidate.textContent === 'Unpin',
    );
    expect(pin?.hidden).toBe(true);

    await session.close();
  });
});

describe('move to trash from the editor (T-054)', () => {
  async function confirmVisibleTrashDialog(): Promise<void> {
    const dialog = await waitFor(
      () => document.querySelector<HTMLDialogElement>('.dialog--confirm'),
    );
    if (!dialog) throw new Error('confirm dialog not found');
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain('Move this note to trash?');
    const confirm = [...dialog.querySelectorAll('button')].find(
      (button) => button.textContent === 'Move to trash',
    );
    if (!(confirm instanceof HTMLButtonElement)) throw new Error('confirm button not found');
    confirm.click();
  }

  it('flushes pending edits, trashes, announces and closes through the controller', async () => {
    const note = await seedNote('Trash from editor', 'initial text');
    const mount = document.createElement('div');
    root.append(mount);
    const announced: string[] = [];
    const closeCalls: number[] = [];
    const session = await openEditorSession({
      mount,
      note,
      callbacks: makeCallbacks({
        trashNote: realTrashNote,
        announce: (message) => announced.push(message),
        onRequestClose: () => closeCalls.push(Date.now()),
      }),
    });

    // Uns edit that must be flushed BEFORE the note is trashed.
    session.editor.commands.insertContent(' typed before trashing');
    await waitFor(() => session.editor.getText().includes('typed before trashing'));

    headerButton(session, 'Move to trash…').click();
    await confirmVisibleTrashDialog();

    await waitFor(() => closeCalls.length === 1);
    await waitFor(() => announced.includes('Note moved to trash.'));

    const trashed = (await client().request('notes/get', { noteId: note.id })).note;
    expect(trashed.state).toBe('trashed');
    // The flush-before-trash contract: the trashed note keeps the newest edit.
    expect(trashed.plainText).toContain('typed before trashing');
  });

  it('keeps the note and the editor when the confirmation is cancelled', async () => {
    const note = await seedNote('Cancel trash', 'stays');
    const mount = document.createElement('div');
    root.append(mount);
    const closeCalls: number[] = [];
    const session = await openEditorSession({
      mount,
      note,
      callbacks: makeCallbacks({
        trashNote: realTrashNote,
        onRequestClose: () => closeCalls.push(Date.now()),
      }),
    });

    headerButton(session, 'Move to trash…').click();
    const dialog = await waitFor(
      () => document.querySelector<HTMLDialogElement>('.dialog--confirm'),
    );
    if (!dialog) throw new Error('confirm dialog not found');
    const cancel = [...dialog.querySelectorAll('button')].find(
      (button) => button.textContent === 'Cancel',
    );
    if (!(cancel instanceof HTMLButtonElement)) throw new Error('cancel button not found');
    cancel.click();
    await waitFor(() => document.querySelector('.dialog--confirm') === null);

    expect((await client().request('notes/get', { noteId: note.id })).note.state).not.toBe('trashed');
    expect(closeCalls).toHaveLength(0);
    expect(session.element.isConnected).toBe(true);

    await session.close();
  });

  it('announces failure honestly and keeps the editor open when trash fails', async () => {
    const note = await seedNote('Failing trash', 'target');
    const mount = document.createElement('div');
    root.append(mount);
    const announced: string[] = [];
    const closeCalls: number[] = [];
    const session = await openEditorSession({
      mount,
      note,
      callbacks: makeCallbacks({
        trashNote: async () => false, // controller reports failure
        announce: (message) => announced.push(message),
        onRequestClose: () => closeCalls.push(Date.now()),
      }),
    });

    headerButton(session, 'Move to trash…').click();
    await confirmVisibleTrashDialog();

    await waitFor(() =>
      announced.includes('Moving the note to trash failed — please try again.'),
    );
    expect((await client().request('notes/get', { noteId: note.id })).note.state).not.toBe('trashed');
    expect(closeCalls).toHaveLength(0);
    // The button re-enables so the user can retry.
    expect(headerButton(session, 'Move to trash…').disabled).toBe(false);

    await session.close();
  });

  it('hides the trash action when no controller wiring provides it', async () => {
    const note = await seedNote('No trash wiring', 'body');
    const mount = document.createElement('div');
    root.append(mount);
    const session = await openEditorSession({
      mount,
      note,
      callbacks: makeCallbacks(), // isolated-test shape: no trashNote
    });

    const trash = [...session.element.querySelectorAll<HTMLButtonElement>('.editor-session__header button')].find(
      (candidate) => candidate.textContent === 'Move to trash…',
    );
    expect(trash?.hidden).toBe(true);

    await session.close();
  });
});

describe('favorite from the editor (T-064, audit D-01)', () => {
  const realSetFavorite = async (noteId: EntityId, favorite: boolean): Promise<boolean> => {
    try {
      await client().request('notes/set-flags', { noteId, favorite });
      return true;
    } catch {
      return false;
    }
  };

  it('favorites and unfavorites through notes/set-flags with honest announcements', async () => {
    const note = await seedNote('Favorite me', 'favorite target');
    const mount = document.createElement('div');
    root.append(mount);
    const announced: string[] = [];
    const session = await openEditorSession({
      mount,
      note,
      callbacks: makeCallbacks({
        setFavorite: realSetFavorite,
        announce: (message) => announced.push(message),
      }),
    });

    const favoriteButton = headerButton(session, 'Favorite');
    favoriteButton.click();
    await waitFor(() => announced.includes('Note favorited.'));
    expect((await client().request('notes/get', { noteId: note.id })).note.favorite).toBe(true);
    expect(headerButton(session, 'Unfavorite').disabled).toBe(false);

    headerButton(session, 'Unfavorite').click();
    await waitFor(() => announced.includes('Note unfavorited.'));
    expect((await client().request('notes/get', { noteId: note.id })).note.favorite).toBe(false);
    expect(headerButton(session, 'Favorite').textContent).toBe('Favorite');

    await session.close();
  });

  it('reflects the favorite state on open and announces failures honestly', async () => {
    const note = await seedNote('Already favorite', 'favorited body');
    await client().request('notes/set-flags', { noteId: note.id, favorite: true });
    const mount = document.createElement('div');
    root.append(mount);
    const announced: string[] = [];
    const session = await openEditorSession({
      mount,
      note: (await client().request('notes/get', { noteId: note.id })).note,
      callbacks: makeCallbacks({
        setFavorite: async () => false, // controller reports failure
        announce: (message) => announced.push(message),
      }),
    });

    // Label mirrors the persisted state on open.
    expect(headerButton(session, 'Unfavorite').textContent).toBe('Unfavorite');

    headerButton(session, 'Unfavorite').click();
    await waitFor(() => announced.includes('Updating the favorite failed — please try again.'));
    // The flag was NOT flipped and the label still mirrors the truth.
    expect((await client().request('notes/get', { noteId: note.id })).note.favorite).toBe(true);
    expect(headerButton(session, 'Unfavorite').textContent).toBe('Unfavorite');

    await session.close();
  });

  it('hides the favorite action when no controller wiring provides it', async () => {
    const note = await seedNote('No favorite wiring', 'body');
    const mount = document.createElement('div');
    root.append(mount);
    const session = await openEditorSession({
      mount,
      note,
      callbacks: makeCallbacks(), // isolated-test shape: no setFavorite
    });

    const favorite = [...session.element.querySelectorAll<HTMLButtonElement>('.editor-session__header button')].find(
      (candidate) => candidate.textContent === 'Favorite' || candidate.textContent === 'Unfavorite',
    );
    expect(favorite?.hidden).toBe(true);

    await session.close();
  });
});
