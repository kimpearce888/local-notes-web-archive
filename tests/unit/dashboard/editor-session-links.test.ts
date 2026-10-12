// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApiClient } from '../../../src/dashboard/state/client';
import {
  openEditorSession,
  type EditorSessionCallbacks,
} from '../../../src/dashboard/state/editor-session';
import { createSnapshotsApi } from '../../../src/dashboard/state/snapshot-client';
import { clearRecoveryJournal } from '../../../src/dashboard/editor/recovery';
import { MessageRouter } from '../../../src/background/router';
import { registerAllApi } from '../../../src/background/api';
import { installChromeMock, type InstalledMock } from '../background/chrome-mock';
import { closeWorkerResources } from '../../../src/background/db';
import { DB_NAME } from '../../../src/core/version';
import type { Link, Note } from '../../../src/core/types';

/**
 * T-020 session integration: pasted URLs become link records with the
 * auto-capture policy applied in the background; typed URLs are detected
 * after autosave and never queued automatically.
 */

type Transport = Parameters<typeof createApiClient>[0];

let root: HTMLElement;
let router: MessageRouter;
let installed: InstalledMock;

const transport: Transport = async (message) => router.dispatch(message);
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
  installed = installChromeMock();
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
  installed.uninstall();
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

const announceRecorder = (): { messages: string[]; announce: (m: string) => void } => {
  const messages: string[] = [];
  return { messages, announce: (message: string) => messages.push(message) };
};

function makeCallbacks(announce: (message: string) => void): EditorSessionCallbacks {
  return {
    getRevisions: async (noteId) => (await client().request('notes/revisions', { noteId })).revisions,
    saveNoteDetailed: async (input) => {
      try {
        const { note } = await client().request('notes/save', input);
        return { ok: true, note };
      } catch (error) {
        return { ok: false, code: (error as { code?: 'conflict' }).code ?? 'internal-error' };
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
      add: async () => {
        throw new Error('no attachments in this suite');
      },
      list: async () => [],
      getBlob: async () => null,
      rename: async () => false,
      remove: async () => false,
    },
    snapshots: createSnapshotsApi(client()),
  };
}

/** Dispatch a plain-text paste carrying a URL onto the editor DOM. */
function pasteText(session: { editor: { view: { dom: HTMLElement } } }, text: string): void {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { files: [] as File[], types: ['text/plain'], getData: (mime: string) => (mime === 'text/plain' ? text : '') },
  });
  session.editor.view.dom.dispatchEvent(event);
}

async function linksOf(noteId: Note['id']): Promise<Link[]> {
  return (await client().request('links/list-for-note', { noteId })).links;
}

describe('pasted URL detection (FR-CAP-01)', () => {
  it('queues capture for pasted eligible URLs by default and announces it', async () => {
    const note = await seedNote('Paste link note');
    const { messages, announce } = announceRecorder();
    // The origin is granted (T-021): pasted URLs queue for capture.
    installed.permissions.grantedPatterns.add('https://example.com/*');
    const session = await openEditorSession({ mount: root, note, callbacks: makeCallbacks(announce) });

    pasteText(session, 'read this: https://example.com/article/9 great stuff');
    await waitFor(async () => (await linksOf(note.id)).length === 1);

    const links = await linksOf(note.id);
    expect(links[0]!.originalUrl).toBe('https://example.com/article/9');
    expect(links[0]!.captureState).toBe('queued');
    expect(messages.some((m) => m.includes('capture') && m.includes('queued'))).toBe(true);
    await session.close();
  });

  it('keeps the pasted URL in the document as a clickable autolink', async () => {
    const note = await seedNote('Autolink note');
    const session = await openEditorSession({ mount: root, note, callbacks: makeCallbacks(() => undefined) });
    pasteText(session, 'see https://example.com/keep');
    await waitFor(() => {
      const serialized = JSON.stringify(session.editor.getJSON());
      return serialized.includes('https://example.com/keep');
    });
    // Link marks live on the text runs inside paragraphs.
    const marks = (session.editor.getJSON().content ?? []).flatMap(
      (node) =>
        ((node as { content?: { marks?: { type: string }[] }[] }).content ?? []).flatMap(
          (child) => child.marks ?? [],
        ),
    );
    expect(marks.some((mark) => mark.type === 'link')).toBe(true);
    await session.close();
  });

  it('only detects pasted URLs when auto-capture is disabled', async () => {
    const note = await seedNote('Disabled note');
    await client().request('settings/patch', { patch: { autoCaptureOnPaste: false } });
    const session = await openEditorSession({ mount: root, note, callbacks: makeCallbacks(() => undefined) });
    pasteText(session, 'https://example.com/off');
    await waitFor(async () => (await linksOf(note.id)).length === 1);
    const links = await linksOf(note.id);
    expect(links[0]!.captureState).toBe('detected');
    await session.close();
  });
});

describe('typed URL detection (never auto-visited)', () => {
  it('creates a detected link after autosave without queuing', async () => {
    const note = await seedNote('Typed link note');
    const session = await openEditorSession({ mount: root, note, callbacks: makeCallbacks(() => undefined) });
    // Type a URL into the title (plain input) and body text.
    const title = root.querySelector('.editor-panel__title') as HTMLInputElement;
    title.value = 'Notes on https://example.com/typed-title';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    session.editor.commands.insertContent('body mentions https://example.com/typed-body too');

    await waitFor(async () => {
      const fresh = (await client().request('notes/get', { noteId: note.id })).note;
      return fresh.plainText.includes('typed-body');
    });
    await waitFor(async () => (await linksOf(note.id)).length === 2);

    const links = await linksOf(note.id);
    const states = links.map((link) => link.captureState);
    expect(states.every((state) => state === 'detected')).toBe(true);
    const urls = links.map((link) => link.originalUrl).sort();
    expect(urls).toEqual([
      'https://example.com/typed-body',
      'https://example.com/typed-title',
    ]);
    await session.close();
  });
});
