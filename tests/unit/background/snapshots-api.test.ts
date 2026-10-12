import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock, type InstalledMock } from './chrome-mock';
import { closeWorkerResources, repo } from '../../../src/background/db';
import { MessageRouter } from '../../../src/background/router';
import { registerAllApi } from '../../../src/background/api';
import { createLink, getLink, setLinkSnapshot } from '../../../src/core/repo/links';
import {
  createSnapshot,
  saveMhtmlArtifact,
  savePngArtifact,
  saveTextArtifact,
  markMhtmlArtifact,
} from '../../../src/core/repo/snapshots';
import { listAuditEvents } from '../../../src/core/repo/audit';
import { newCorrelationId, RPC_KIND, type RpcRequest, type RpcResponse } from '../../../src/background/protocol';
import { newId } from '../../../src/core/util/ids';
import { DB_NAME } from '../../../src/core/version';
import type { EntityId, Link, Note, Snapshot } from '../../../src/core/types';

/**
 * T-026 snapshot API (FR-CAP-06/07/08): listing, rename, delete with
 * recapture-chain re-pointing, PNG preview bytes and user-initiated export
 * with truthful refusals — over the real router and IndexedDB.
 */

let installed: InstalledMock;
let router: MessageRouter;

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

async function seedNote(title: string): Promise<Note> {
  const result = await ok('notes/create', { title, plainText: 'body' });
  return result['note'] as Note;
}

async function flush(millis = 10): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, millis));
}

const MHTML = new Blob(['MIME-Version: 1.0\r\nContent-Type: multipart/related\r\n\r\npage'], {
  type: 'multipart/related',
});
const PNG = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])], {
  type: 'image/png',
});

/** Seed one fully-saved snapshot linked to `link`. */
async function seedCapturedSnapshot(
  note: Note,
  link: Link,
  title: string,
  options: { previousSnapshotId?: EntityId | null } = {},
): Promise<Snapshot> {
  const snapshot = await createSnapshot(await repo(), {
    noteId: note.id,
    linkId: link.id,
    sourceUrl: link.originalUrl,
    finalUrl: link.originalUrl,
    title,
    previousSnapshotId: options.previousSnapshotId ?? null,
  });
  await saveMhtmlArtifact(await repo(), snapshot.id, MHTML);
  await savePngArtifact(await repo(), snapshot.id, PNG);
  await saveTextArtifact(await repo(), snapshot.id, 'extracted readable text');
  await setLinkSnapshot(await repo(), link.id, snapshot.id);
  return snapshot;
}

async function seedLink(note: Note, url: string): Promise<Link> {
  const { link } = await createLink(await repo(), note.id, url, '', 'detected');
  return link;
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

describe('snapshots/list', () => {
  it('lists a note\'s snapshots newest first with normalized fields', async () => {
    const note = await seedNote('Listing');
    const link = await seedLink(note, 'https://example.com/a');
    const first = await seedCapturedSnapshot(note, link, 'First capture');
    await flush(15);
    const second = await seedCapturedSnapshot(note, link, 'Second capture', {
      previousSnapshotId: first.id,
    });

    const result = await ok('snapshots/list-for-note', { noteId: note.id });
    const snapshots = result['snapshots'] as Snapshot[];
    expect(snapshots.map((s) => s.id)).toEqual([second.id, first.id]);
    expect(snapshots[1]!.canonicalUrl).toBeNull(); // read-time normalized
    expect(snapshots[1]!.status).toBe('complete');
  });

  it('lists a link\'s recapture chain', async () => {
    const note = await seedNote('Chain');
    const link = await seedLink(note, 'https://example.com/chain');
    const first = await seedCapturedSnapshot(note, link, 'One');
    await flush(15);
    await seedCapturedSnapshot(note, link, 'Two', { previousSnapshotId: first.id });

    const result = await ok('snapshots/list-for-link', { linkId: link.id });
    expect((result['snapshots'] as Snapshot[]).length).toBe(2);
  });
});

describe('snapshots/rename', () => {
  it('renames and re-indexes the searchable title', async () => {
    const note = await seedNote('Rename me');
    const link = await seedLink(note, 'https://example.com/rename');
    const snapshot = await seedCapturedSnapshot(note, link, 'Old title');

    const result = await ok('snapshots/rename', { snapshotId: snapshot.id, title: 'New title' });
    expect((result['snapshot'] as Snapshot).title).toBe('New title');

    const search = await ok('search/query', { query: 'New title' });
    expect(((search['hits'] as unknown[]) ?? []).some((h) => (h as { noteId: EntityId }).noteId === note.id)).toBe(true);
  });

  it('rejects empty titles and unknown snapshots', async () => {
    const note = await seedNote('Reject');
    const link = await seedLink(note, 'https://example.com/reject');
    const snapshot = await seedCapturedSnapshot(note, link, 'X');
    const empty = await call('snapshots/rename', { snapshotId: snapshot.id, title: '' });
    expect(empty.ok).toBe(false);
    expect(empty.ok ? null : empty.error.code).toBe('invalid-request');
    const unknown = await call('snapshots/rename', { snapshotId: newId(), title: 'Y' });
    expect(unknown.ok).toBe(false);
    expect(unknown.ok ? null : unknown.error.code).toBe('not-found');
  });
});

describe('snapshots/delete', () => {
  it('re-points the link to the previous revision of the chain', async () => {
    const note = await seedNote('Repoint');
    const link = await seedLink(note, 'https://example.com/repoint');
    const first = await seedCapturedSnapshot(note, link, 'Keep me');
    await flush(15);
    const second = await seedCapturedSnapshot(note, link, 'Delete me', {
      previousSnapshotId: first.id,
    });
    expect((await getLink(await repo(), link.id))?.snapshotId).toBe(second.id);

    const result = await ok('snapshots/delete', { snapshotId: second.id });
    const updatedLink = result['link'] as Link;
    expect(updatedLink.snapshotId).toBe(first.id);
    expect(updatedLink.captureState).toBe('captured');
    expect((await getLink(await repo(), link.id))?.snapshotId).toBe(first.id);

    const remaining = await ok('snapshots/list-for-link', { linkId: link.id });
    expect((remaining['snapshots'] as Snapshot[]).map((s) => s.id)).toEqual([first.id]);
  });

  it('returns the link to detected when no revision remains', async () => {
    const note = await seedNote('Last one');
    const link = await seedLink(note, 'https://example.com/last');
    const snapshot = await seedCapturedSnapshot(note, link, 'Only');

    const result = await ok('snapshots/delete', { snapshotId: snapshot.id });
    const updatedLink = result['link'] as Link;
    expect(updatedLink.snapshotId).toBeNull();
    expect(updatedLink.captureState).toBe('detected');
    const after = await getLink(await repo(), link.id);
    expect(after?.snapshotId).toBeNull();
    expect(after?.captureState).toBe('detected');
  });

  it('removes the snapshot text from the search projection', async () => {
    const note = await seedNote('Search gone');
    const link = await seedLink(note, 'https://example.com/searchgone');
    const snapshot = await seedCapturedSnapshot(note, link, 'Searchable');
    // Index the note with the snapshot text present.
    const before = await ok('search/query', { query: 'extracted readable text' });
    void before;
    await ok('snapshots/delete', { snapshotId: snapshot.id });
    const afterSearch = await ok('search/query', { query: 'extracted' });
    expect(((afterSearch['hits'] as unknown[]) ?? []).length).toBe(0);
  });
});

describe('snapshots/get-png', () => {
  it('returns the stored PNG bytes', async () => {
    const note = await seedNote('PNG');
    const link = await seedLink(note, 'https://example.com/png');
    const snapshot = await seedCapturedSnapshot(note, link, 'With PNG');

    const result = await ok('snapshots/get-png', { snapshotId: snapshot.id });
    const png = result['png'] as Blob | null;
    expect(png).not.toBeNull();
    const bytes = new Uint8Array(await png!.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('returns a truthful null when the PNG artifact was not saved', async () => {
    const note = await seedNote('No PNG');
    const link = await seedLink(note, 'https://example.com/nopng');
    const snapshot = await seedCapturedSnapshot(note, link, 'Text only');
    await markMhtmlArtifact(await repo(), snapshot.id, 'failed'); // irrelevant field, keeps record honest
    void snapshot;
    // Build a snapshot without a PNG.
    const bare = await createSnapshot(await repo(), {
      noteId: note.id,
      linkId: link.id,
      sourceUrl: link.originalUrl,
      finalUrl: link.originalUrl,
      title: 'Bare',
    });
    await saveTextArtifact(await repo(), bare.id, 'text only');

    const result = await ok('snapshots/get-png', { snapshotId: bare.id });
    expect(result['png']).toBeNull();
  });
});

describe('snapshots/export (FR-CAP-06)', () => {
  it('exports the MHTML archive with a safe derived filename', async () => {
    const note = await seedNote('Export');
    const link = await seedLink(note, 'https://example.com/export');
    const snapshot = await seedCapturedSnapshot(note, link, 'Quarterly Report: 2026');

    const result = await ok('snapshots/export', { snapshotId: snapshot.id, format: 'mhtml' });
    const blob = result['blob'] as Blob;
    const filename = result['filename'] as string;
    expect(filename).toMatch(/^Quarterly Report 2026 \(\d{4}-\d{2}-\d{2}\)\.mhtml$/);
    expect(await blob.text()).toContain('multipart/related');
  });

  it('exports PNG and text artifacts with their extensions', async () => {
    const note = await seedNote('Formats');
    const link = await seedLink(note, 'https://example.com/formats');
    const snapshot = await seedCapturedSnapshot(note, link, 'Formats');

    const png = await ok('snapshots/export', { snapshotId: snapshot.id, format: 'png' });
    expect(png['filename'] as string).toMatch(/\.png$/);
    const text = await ok('snapshots/export', { snapshotId: snapshot.id, format: 'text' });
    expect(text['filename'] as string).toMatch(/\.txt$/);
    expect(await (text['blob'] as Blob).text()).toBe('extracted readable text');
  });

  it('refuses to export an artifact that was not saved', async () => {
    const note = await seedNote('Refuse');
    const link = await seedLink(note, 'https://example.com/refuse');
    const snapshot = await createSnapshot(await repo(), {
      noteId: note.id,
      linkId: link.id,
      sourceUrl: link.originalUrl,
      finalUrl: link.originalUrl,
      title: 'Empty',
    });
    await saveTextArtifact(await repo(), snapshot.id, 'only text');

    const response = await call('snapshots/export', { snapshotId: snapshot.id, format: 'mhtml' });
    expect(response.ok).toBe(false);
    expect(response.ok ? null : response.error.code).toBe('invalid-request');
    expect(response.ok ? null : response.error.message).toContain('nothing to export');
  });

  it('records user-initiated export audit events with metadata only', async () => {
    const note = await seedNote('Audited export');
    const link = await seedLink(note, 'https://example.com/audit-export');
    const snapshot = await seedCapturedSnapshot(note, link, 'Audits');

    await ok('snapshots/export', { snapshotId: snapshot.id, format: 'mhtml' });
    const events = await listAuditEvents(await repo(), {});
    const exportEvent = events.find((e) => e.action === 'snapshots/export');
    expect(exportEvent).toBeDefined();
    expect(exportEvent!.outcome).toBe('succeeded');
    expect(exportEvent!.detail).toContain('exported mhtml');
    expect(exportEvent!.detail).not.toContain('https://example.com/audit-export');
  });
});
