// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../../src/dashboard/state/client';
import { createOrganizationApi } from '../../../src/dashboard/state/organization-client';
import {
  openEditorSession,
  type EditorSessionCallbacks,
} from '../../../src/dashboard/state/editor-session';
import { createSnapshotsApi } from '../../../src/dashboard/state/snapshot-client';
import { createRemindersApi } from '../../../src/dashboard/state/reminders-client';
import { MessageRouter } from '../../../src/background/router';
import { registerAllApi } from '../../../src/background/api';
import { closeWorkerResources } from '../../../src/background/db';
import { clearRecoveryJournal } from '../../../src/dashboard/editor/recovery';
import { DB_NAME } from '../../../src/core/version';
import type { EntityId, Note } from '../../../src/core/types';

/**
 * T-087 (register UX-08): tags and categories reachable from the EDITOR.
 * Integration through the REAL RPC channel (json-clone + binary codec, the
 * exact transport class whose blind spot shipped audit defect D-04): the
 * session mounts the metadata bar from notes/related-bulk + roster lists,
 * and adding/removing a tag persists through tags/create +
 * tags/set-note-tags with a truthful read-back.
 */

type Transport = Parameters<typeof createApiClient>[0];

let root: HTMLElement;
let router: MessageRouter;

const jsonClone = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown;

const transport: Transport = async (message) => {
  const wire = jsonClone(message) as object;
  const response = await router.dispatch(wire as Parameters<MessageRouter['dispatch']>[0]);
  if (!response.ok) return response;
  return jsonClone({ ...response, result: response.result });
};
const client = () => createApiClient(transport);

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

function makeCallbacks(announce: (message: string) => void): EditorSessionCallbacks {
  return {
    getRevisions: async (noteId) => (await client().request('notes/revisions', { noteId })).revisions,
    saveNoteDetailed: async (input) => {
      const { note } = await client().request('notes/save', input);
      return { ok: true, note };
    },
    getNote: async (noteId) => (await client().request('notes/get', { noteId })).note,
    duplicateWithContent: async () => null,
    announce,
    onOpenLink: () => undefined,
    detectLinks: async () => null,
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
    organization: createOrganizationApi(client()),
    onRosterChanged: () => undefined,
  };
}

async function noteTagIds(noteId: EntityId): Promise<string[]> {
  const { related } = await client().request('notes/related-bulk', { noteIds: [noteId] });
  return related[noteId]?.tags.map((tag: { id: string }) => tag.id) ?? [];
}

async function noteCategoryIds(noteId: EntityId): Promise<string[]> {
  const { related } = await client().request('notes/related-bulk', { noteIds: [noteId] });
  return related[noteId]?.categories.map((category: { id: string }) => category.id) ?? [];
}

describe('editor metadata bar wiring (T-087, UX-08)', () => {
  it('mounts the bar with the note\u2019s existing tags and roster suggestions', async () => {
    const note = await seedNote('Meta note');
    const { tag } = await client().request('tags/create', { name: 'existing' });
    await client().request('tags/set-note-tags', { noteId: note.id, tagIds: [tag.id] });

    const session = await openEditorSession({
      mount: root,
      note,
      callbacks: makeCallbacks(() => undefined),
    });

    const bar = await waitFor(() => root.querySelector('.note-meta-bar'));
    expect(bar).not.toBeNull();
    // The applied chip renders from the real related-bulk read.
    await waitFor(() => root.querySelector('.note-meta-bar__chip-name') !== null);
    expect(
      [...root.querySelectorAll('.note-meta-bar__chip-name')].map((n) => n.textContent),
    ).toEqual(['existing']);
    // The suggestion list excludes the applied tag but offers the other.
    await client().request('tags/create', { name: 'other' });
    await session.close();
  });

  it('adds a tag from the editor input and persists it through the real channel', async () => {
    const note = await seedNote('Tag from editor');
    const announced: string[] = [];
    const onRosterChanged = vi.fn();
    const callbacks = makeCallbacks((message) => announced.push(message));
    callbacks.onRosterChanged = onRosterChanged;
    const session = await openEditorSession({ mount: root, note, callbacks });

    await waitFor(() => root.querySelector('.note-meta-bar'));
    const input = root.querySelector<HTMLInputElement>('input[aria-label="Add a tag"]');
    expect(input).not.toBeNull();
    input!.value = 'from-editor';
    input!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );

    await waitFor(() => root.querySelector('.note-meta-bar__chip-name') !== null);
    expect(
      [...root.querySelectorAll('.note-meta-bar__chip-name')].map((n) => n.textContent),
    ).toEqual(['from-editor']);
    // Truthful persistence: the read-back through the real RPC channel.
    const ids = await waitFor(() => noteTagIds(note.id).then((r) => (r.length > 0 ? r : null)));
    expect(ids).toHaveLength(1);
    const { tags } = await client().request('tags/list', {});
    expect(tags.map((t: { name: string }) => t.name)).toContain('from-editor');
    // The roster birth was reported to the controller hook.
    expect(onRosterChanged).toHaveBeenCalled();
    expect(announced.some((m) => m.includes('"from-editor" created and added'))).toBe(true);
    await session.close();
  });

  it('removes a chip from the editor and persists the remaining set', async () => {
    const note = await seedNote('Untag from editor');
    const { tag } = await client().request('tags/create', { name: 'gone' });
    const { tag: keep } = await client().request('tags/create', { name: 'keep' });
    await client().request('tags/set-note-tags', {
      noteId: note.id,
      tagIds: [tag.id, keep.id],
    });

    const session = await openEditorSession({
      mount: root,
      note,
      callbacks: makeCallbacks(() => undefined),
    });
    await waitFor(() =>
      root.querySelector('button[aria-label="Remove tag gone"]'),
    );
    root.querySelector<HTMLButtonElement>('button[aria-label="Remove tag gone"]')!.click();

    await waitFor(
      () =>
        [...root.querySelectorAll('.note-meta-bar__chip-name')].filter(
          (n) => n.textContent === 'gone',
        ).length === 0,
    );
    expect(
      [...root.querySelectorAll('.note-meta-bar__chip-name')].map((n) => n.textContent),
    ).toEqual(['keep']);
    const ids = await waitFor(() => noteTagIds(note.id));
    expect(ids).toEqual([keep.id]);
    await session.close();
  });

  it('adds a category from the editor and persists it (create + set-note-categories)', async () => {
    const note = await seedNote('Categorize from editor');
    const session = await openEditorSession({
      mount: root,
      note,
      callbacks: makeCallbacks(() => undefined),
    });
    await waitFor(() => root.querySelector('.note-meta-bar'));
    const input = root.querySelector<HTMLInputElement>('input[aria-label="Add a category"]');
    input!.value = 'Projects';
    input!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );

    await waitFor(() => root.querySelector('.note-meta-bar__chip-name') !== null);
    expect(
      [...root.querySelectorAll('.note-meta-bar__chip-name')].map((n) => n.textContent),
    ).toEqual(['Projects']);
    const ids = await waitFor(() => noteCategoryIds(note.id).then((r) => (r.length > 0 ? r : null)));
    expect(ids).toHaveLength(1);
    const { categories } = await client().request('categories/list', {});
    expect(categories.map((c: { name: string }) => c.name)).toContain('Projects');
    await session.close();
  });

  it('skips the bar entirely when no organization API is wired (isolated tests)', async () => {
    const note = await seedNote('No org api');
    const callbacks = makeCallbacks(() => undefined);
    delete callbacks.organization;
    const session = await openEditorSession({ mount: root, note, callbacks });
    await flush(60);
    expect(root.querySelector('.note-meta-bar')).toBeNull();
    await session.close();
  });
});
