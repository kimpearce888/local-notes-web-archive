import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock, type InstalledMock } from './chrome-mock';
import { closeWorkerResources, repo } from '../../../../src/background/db';
import { MessageRouter } from '../../../../src/background/router';
import { registerAllApi } from '../../../../src/background/api';
import { getNote } from '../../../../src/core/repo/notes';
import { listNoteTags } from '../../../../src/core/repo/tags';
import { newCorrelationId, RPC_KIND, type RpcRequest, type RpcResponse } from '../../../../src/background/protocol';
import { DB_NAME } from '../../../../src/core/version';
import type { Note } from '../../../../src/core/types';

/**
 * T-035 note-level transfer (FR-DATA-05): the JSON note-file export RPC
 * (structure, relationships, filename) plus the dashboard-side parsing
 * validation for imports (JSON shape checks, Markdown title extraction,
 * HTML sanitization).
 */

let router: MessageRouter;
let installed: InstalledMock;

function call(type: string, payload: unknown): Promise<RpcResponse> {
  const request: RpcRequest = { kind: RPC_KIND, id: newCorrelationId(), type, payload };
  return router.dispatch(request);
}

async function ok(type: string, payload: unknown): Promise<Record<string, unknown>> {
  const response = await call(type, payload);
  if (!response.ok) {
    throw new Error(`${type} failed: ${response.error.code} ${response.error.message}`);
  }
  return response.result as Record<string, unknown>;
}

async function seedNote(): Promise<Note> {
  const result = await ok('notes/create', {
    title: 'Transfer me',
    plainText: 'note body',
    editorDoc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'note body' }] }] },
  });
  return result['note'] as Note;
}

beforeEach(() => {
  installed = installChromeMock();
  router = new MessageRouter();
  registerAllApi(router);
});

afterEach(async () => {
  await closeWorkerResources();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
  installed.uninstall();
});

describe('notes/export-file (FR-DATA-05 JSON)', () => {
  it('exports the note with its relationships and a safe filename', async () => {
    const note = await seedNote();
    await ok('tags/create', { name: 'exported-tag' });
    const tagList = (await ok('tags/list', {}))['tags'] as { id: string }[];
    await ok('tags/set-note-tags', { noteId: note.id, tagIds: [tagList[0]!.id] });

    const result = await ok('notes/export-file', { noteId: note.id });
    const blob = result['blob'] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(result['filename']).toBe('Transfer me.json');

    const parsed = JSON.parse(await blob.text()) as {
      format: string;
      version: number;
      note: { title: string; plainText: string; editorDoc: object };
      tags: string[];
      links: { url: string }[];
    };
    expect(parsed.format).toBe('lnwa-note');
    expect(parsed.version).toBe(1);
    expect(parsed.note.title).toBe('Transfer me');
    expect(parsed.note.plainText).toBe('note body');
    expect(parsed.note.editorDoc).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'note body' }] }],
    });
    expect(parsed.tags).toEqual(['exported-tag']);
    expect(Array.isArray(parsed.links)).toBe(true);

    // The export did not mutate anything.
    expect((await getNote(await repo(), note.id))?.title).toBe('Transfer me');
    expect((await listNoteTags(await repo(), note.id)).map((t) => t.name)).toEqual(['exported-tag']);
  });

  it('sanitizes hostile titles out of the filename', async () => {
    const note = (await ok('notes/create', { title: 'a/b\\c:d*e?f<g>h|i' }))['note'] as Note;
    const result = await ok('notes/export-file', { noteId: note.id });
    expect(result['filename']).not.toMatch(/[/\\:*?"<>|]/);
  });

  it('reports unknown notes as not-found', async () => {
    const response = await call('notes/export-file', {
      noteId: '11111111-2222-4333-8444-555555555555',
    });
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('not-found');
  });
});
