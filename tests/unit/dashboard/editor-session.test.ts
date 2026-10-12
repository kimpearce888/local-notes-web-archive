// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApiClient } from '../../../src/dashboard/state/client';
import { openEditorSession, type EditorSessionCallbacks } from '../../../src/dashboard/state/editor-session';
import { createSnapshotsApi } from '../../../src/dashboard/state/snapshot-client';
import { clearRecoveryJournal } from '../../../src/dashboard/editor/recovery';
import type { ConflictChoice, ConflictSnapshot } from '../../../src/dashboard/editor/revisions';
import { MessageRouter } from '../../../src/background/router';
import { registerAllApi } from '../../../src/background/api';
import { closeWorkerResources } from '../../../src/background/db';
import { DB_NAME } from '../../../src/core/version';
import type { EntityId, Note } from '../../../src/core/types';

/**
 * T-018 end-to-end: the editor session over the REAL router + repositories —
 * autosaved edits persist with the plain-text projection, the crash journal
 * recovers the newest unsaved edit, revision history restores as a new
 * revision, and conflicts surface the three PRD options.
 */

type Transport = Parameters<typeof createApiClient>[0];

let root: HTMLElement;
let router: MessageRouter;

const transport: Transport = async (message) => router.dispatch(message);
const client = () => createApiClient(transport);

async function flush(millis = 20): Promise<void> {
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
    duplicateWithContent: async (input) => {
      const { note: duplicate } = await client().request('notes/duplicate', {
        noteId: input.sourceNoteId,
      });
      await client().request('notes/save', {
        noteId: duplicate.id,
        title: input.title,
        subtitle: input.subtitle,
        editorDoc: input.editorDoc,
        plainText: input.plainText,
        expectedRevisionId: duplicate.revisionId,
        changeSummary: 'duplicate',
      });
      return duplicate.id;
    },
    announce: () => undefined,
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
      list: async (noteId) => (await client().request('attachments/list-for-note', { noteId })).attachments,
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
    ...overrides,
  };
}

describe('autosave through the real save pipeline', () => {
  it('persists edits with the plain-text projection and clears the journal', async () => {
    const note = await seedNote('Autosave note', 'initial');
    const mount = document.createElement('div');
    root.append(mount);
    const announced: string[] = [];
    const session = await openEditorSession({
      mount,
      note,
      callbacks: makeCallbacks({ announce: (message) => announced.push(message) }),
    });

    // Type through the session's live editor.
    session.editor.commands.insertContent(' typed words');
    await waitFor(async () => {
      const fresh = (await client().request('notes/get', { noteId: note.id })).note;
      return fresh.plainText.includes('typed words');
    });

    const saved = (await client().request('notes/get', { noteId: note.id })).note;
    expect(saved.plainText).toContain('typed words');
    expect(saved.revisionId).not.toBe(note.revisionId);

    // Successful autosave clears the crash journal for this note. The
    // clear happens in the same async continuation that observed the
    // committed save, so wait for it rather than racing the microtask.
    const { readRecoveryEntry } = await import('../../../src/dashboard/editor/recovery');
    await waitFor(() => readRecoveryEntry(note.id, '2020-01-01T00:00:00.000Z' as never) === null);
    expect(readRecoveryEntry(note.id, '2020-01-01T00:00:00.000Z' as never)).toBeNull();

    // The save is recorded in the revision history (first revision).
    const { revisions } = await client().request('notes/revisions', { noteId: note.id });
    expect(revisions.length).toBeGreaterThanOrEqual(1);

    await session.close();
    void announced;
  });
});

describe('recovery of the most recent unsaved edit', () => {
  it('restores a newer journal snapshot into the editor on open', async () => {
    const note = await seedNote('Recovery note', 'saved text');
    // Journal entry newer than the saved note (simulated crash).
    const { writeRecoveryEntry } = await import('../../../src/dashboard/editor/recovery');
    writeRecoveryEntry({
      noteId: note.id,
      title: 'Recovery note (recovered)',
      subtitle: '',
      editorDoc: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'unsaved text' }] }],
      },
      plainText: 'unsaved text',
      at: new Date(Date.now() + 5000).toISOString() as never,
    });

    const mount = document.createElement('div');
    root.append(mount);
    const announced: string[] = [];
    const session = await openEditorSession({
      mount,
      note,
      callbacks: makeCallbacks({ announce: (message) => announced.push(message) }),
    });

    // The recovered title is in the title input.
    const titleInput = session.element.querySelector<HTMLInputElement>('.editor-panel__title');
    expect(titleInput?.value).toBe('Recovery note (recovered)');
    expect(announced[0]).toContain('Recovered your most recent unsaved edit');

    await session.close();
  });
});

describe('revision history (FR-NOTE-06)', () => {
  it('lists revisions and restores one as a new revision', async () => {
    const note = await seedNote('Revisions', 'v1');
    // Create a second revision.
    await client().request('notes/save', {
      noteId: note.id,
      title: 'Revisions',
      subtitle: '',
      editorDoc: null,
      plainText: 'v2',
      expectedRevisionId: note.revisionId,
      changeSummary: 'second',
    });

    const fresh = (await client().request('notes/get', { noteId: note.id })).note;
    const mount = document.createElement('div');
    root.append(mount);
    const session = await openEditorSession({ mount, note: fresh, callbacks: makeCallbacks() });

    const revisionsButton = [...session.element.querySelectorAll('button')].find(
      (button) => button.textContent === 'Revision history',
    );
    revisionsButton?.click();
    const list = await waitFor(() =>
      session.element.querySelector('.revision-panel__list') as HTMLElement | null,
    );
    expect(list).not.toBeNull();
    if (!list) return;
    const items = list.querySelectorAll('.revision-panel__item');
    expect(items.length).toBeGreaterThanOrEqual(1);

    // Restore the first listed revision.
    const restore = items[0]?.querySelector<HTMLButtonElement>('button');
    restore?.click();
    await waitFor(async () => {
      const { revisions } = await client().request('notes/revisions', { noteId: note.id });
      return revisions.length >= 2; // original + restored-as-new
    });
    const after = (await client().request('notes/get', { noteId: note.id })).note;
    expect(after.revisionId).not.toBe(note.revisionId);

    await session.close();
  });
});

describe('multi-tab conflict (FR-NOTE-07)', () => {
  it('surfaces the three options with both versions when a save goes stale', async () => {
    const note = await seedNote('Conflict', 'base');
    const mount = document.createElement('div');
    root.append(mount);

    const presented: Array<{ local: ConflictSnapshot; remote: ConflictSnapshot }> = [];
    const choices: ConflictChoice[] = [];
    const session = await openEditorSession({
      mount,
      note,
      callbacks: makeCallbacks(),
      conflictPresenter: (local, remote, choose) => {
        presented.push({ local, remote });
        choices.push('reload');
        choose('reload');
      },
    });

    // The session's local edit.
    session.editor.commands.insertContent(' local edit');
    await flush(50);

    // Another tab saves first — the session's revision head is now stale.
    await client().request('notes/save', {
      noteId: note.id,
      title: 'Conflict (other tab)',
      subtitle: '',
      editorDoc: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'written elsewhere' }] }],
      },
      plainText: 'written elsewhere',
      expectedRevisionId: note.revisionId,
      changeSummary: 'other tab',
    });

    // Wait for the session's autosave to hit the conflict and reload.
    await waitFor(() => presented.length > 0);
    expect(presented[0]?.remote.plainText).toContain('written elsewhere');
    expect(presented[0]?.local.plainText).toContain('local edit');
    expect(choices).toEqual(['reload']);

    // The reload choice loads the newer version into the editor.
    await waitFor(() => session.editor.getText().includes('written elsewhere'));
    const titleInput = session.element.querySelector<HTMLInputElement>('.editor-panel__title');
    await waitFor(() => titleInput?.value === 'Conflict (other tab)');

    // The duplicate escape hatch works end to end.
    const callbacks = makeCallbacks();
    const duplicateId = await callbacks.duplicateWithContent({
      sourceNoteId: note.id,
      title: 'Conflict (mine)',
      subtitle: '',
      editorDoc: null,
      plainText: 'mine',
    });
    expect(duplicateId).not.toBeNull();
    const duplicate = await client().request('notes/get', { noteId: duplicateId as EntityId });
    expect(duplicate.note.plainText).toBe('mine');

    await session.close();
  });
});

describe('session teardown', () => {
  it('flushes pending autosave on close', async () => {
    const note = await seedNote('Flush', 'before');
    const mount = document.createElement('div');
    root.append(mount);
    const session = await openEditorSession({ mount, note, callbacks: makeCallbacks() });
    // An edit is pending in the debounce window when the user goes back.
    session.editor.commands.insertContent(' flushed');
    await session.close(); // close() flushes before tearing down
    await waitFor(async () => {
      const after = (await client().request('notes/get', { noteId: note.id })).note;
      return after.plainText.includes('flushed');
    });
  });
});
