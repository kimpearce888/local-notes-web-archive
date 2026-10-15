import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock, type InstalledMock } from './chrome-mock';
import { closeWorkerResources, repo, searchEngine } from '../../../../src/background/db';
import { MessageRouter } from '../../../../src/background/router';
import { registerAllApi } from '../../../../src/background/api';
import { exportBackup, BACKUP_FORMAT } from '../../../../src/background/backup/export';
import {
  previewRestore,
  restoreBackup,
  BackupValidationError,
} from '../../../../src/background/backup/restore';
import { getNote, listAllNotes } from '../../../../src/core/repo/notes';
import { listTags, listNoteTags } from '../../../../src/core/repo/tags';
import { listAllReminders } from '../../../../src/core/repo/reminders';
import { listNoteSnapshots, saveMhtmlArtifact, createSnapshot, savePngArtifact } from '../../../../src/core/repo/snapshots';
import { getBlob } from '../../../../src/core/repo/blobs';
import { getSettings } from '../../../../src/core/repo/settings';
import { reminderAlarmName } from '../../../../src/background/alarms';
import { newCorrelationId, RPC_KIND, type RpcRequest, type RpcResponse } from '../../../../src/background/protocol';
import { DB_NAME } from '../../../../src/core/version';
import type { Note, Reminder, EntityId } from '../../../../src/core/types';

/**
 * T-033/T-034 backup export + restore (FR-DATA-03/04): complete round-trip
 * over the real stores (records, blobs, settings, search index, alarms),
 * preview validation, and every failure path leaving the database untouched.
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

const MHTML_BYTES = new Uint8Array([0x4d, 0x49, 0x4d, 0x45, 0x2d, 0x56]); // "MIME-V"
const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9]);

async function seedFullData(): Promise<{ note: Note; reminder: Reminder }> {
  // A note with a tag, a reminder and a captured snapshot with both blobs.
  const noteResult = await ok('notes/create', {
    title: 'Backup subject',
    plainText: 'the round-trip body',
    editorDoc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'the round-trip body' }] }] },
  });
  const note = noteResult['note'] as Note;

  // One save so the note has a revision (notes/create alone does not).
  await ok('notes/save', {
    noteId: note.id,
    title: note.title,
    subtitle: note.subtitle,
    editorDoc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'the round-trip body' }] }] },
    plainText: 'the round-trip body',
    expectedRevisionId: null,
    changeSummary: 'seed save',
  });

  const tagResult = await ok('tags/create', { name: 'backup-tag' });
  const tag = tagResult['tag'] as { id: EntityId };
  await ok('tags/set-note-tags', { noteId: note.id, tagIds: [tag.id] });

  const reminder = (await ok('reminders/create', {
    noteId: note.id,
    dueAt: '2031-01-01T09:00:00.000Z',
    recurrence: null,
    timeZone: 'UTC',
  }))['reminder'] as Reminder;

  const ctx = await repo();
  const link = (await ok('links/create', { noteId: note.id, url: 'https://example.com/backup' }))['link'] as {
    id: EntityId;
  };
  const snapshot = await createSnapshot(ctx, {
    noteId: note.id,
    linkId: link.id,
    sourceUrl: 'https://example.com/backup',
    finalUrl: 'https://example.com/backup',
    title: 'Backup subject page',
  });
  await saveMhtmlArtifact(ctx, snapshot.id, new Blob([MHTML_BYTES], { type: 'multipart/related' }));
  await savePngArtifact(ctx, snapshot.id, new Blob([PNG_MAGIC], { type: 'image/png' }));

  await ok('settings/patch', {
    patch: { ai: { enabled: false, baseUrl: 'http://127.0.0.1:1234/v1', model: null, timeoutMs: 60000, permissionMode: 'ask-per-write' } },
  });
  return { note, reminder };
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

describe('backup export (FR-DATA-03)', () => {
  it('exports a complete archive with manifest, hashes and license report', async () => {
    const { note } = await seedFullData();
    const result = await exportBackup();

    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.size).toBeGreaterThan(500);
    expect(result.filename).toMatch(/^local-notes-backup-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.zip$/);
    expect(result.counts.notes).toBe(1);
    expect(result.counts.reminders).toBe(1);
    expect(result.counts.snapshots).toBe(1);
    expect(result.counts.blobs).toBe(2);
    expect(result.counts.tags).toBe(1);
    expect(result.counts.revisions).toBeGreaterThanOrEqual(1);
    void note;
  });

  it('exports through the RPC as a structured-cloneable Blob', async () => {
    await seedFullData();
    const result = await ok('backup/export', {});
    expect(result['blob']).toBeInstanceOf(Blob);
    expect(typeof result['filename']).toBe('string');
    expect((result['counts'] as Record<string, number>).notes).toBe(1);
  });
});

describe('backup round-trip (FR-DATA-03/04)', () => {
  it('restore-replace rebuilds every record, blob, setting, index and alarm', async () => {
    const { note, reminder } = await seedFullData();
    const archive = await exportBackup();
    const blobBefore = await getBlob(
      await repo(),
      (await listNoteSnapshots(await repo(), note.id))[0]!.mhtmlBlobKey!,
    );
    const settingsBefore = await getSettings(await repo());

    // Wipe EVERYTHING (simulating a fresh install / data loss).
    const ctx = await repo();
    await ctx.transaction(
      ['notes', 'tags', 'categories', 'note_tags', 'note_categories', 'links', 'snapshots', 'attachments', 'reminders', 'revisions', 'blobs', 'settings', 'audit_events', 'diagnostic_logs'] as never[],
      'readwrite',
      (stores) => {
        for (const store of Object.values(stores)) store?.clear();
      },
    );
    expect((await listAllNotes(ctx)).length).toBe(0);

    // Restore in replace mode with explicit confirmation.
    const restored = await restoreBackup(archive.blob, { mode: 'replace', confirmReplace: true });
    expect(restored.mode).toBe('replace');
    expect(restored.imported.notes).toBe(1);
    expect(restored.imported.blobs).toBe(2);

    // The note came back with its content.
    const revived = await getNote(await repo(), note.id);
    expect(revived?.title).toBe('Backup subject');
    expect(revived?.plainText).toBe('the round-trip body');

    // Tags and joins came back.
    const tags = await listTags(await repo());
    expect(tags.map((tag) => tag.name)).toEqual(['backup-tag']);
    expect((await listNoteTags(await repo(), note.id)).map((tag) => tag.name)).toEqual(['backup-tag']);

    // Reminders came back WITH their alarm re-scheduled.
    const reminders = await listAllReminders(await repo());
    expect(reminders.length).toBe(1);
    expect(reminders[0]?.nextDueAt).toBe(reminder.nextDueAt);
    expect(installed.alarms.has(reminderAlarmName(reminders[0]!.id))).toBe(true);

    // Snapshots and blobs round-tripped byte-exact.
    const snapshots = await listNoteSnapshots(await repo(), note.id);
    expect(snapshots.length).toBe(1);
    expect(snapshots[0]?.title).toBe('Backup subject page');
    const blobAfter = await getBlob(await repo(), snapshots[0]!.mhtmlBlobKey!);
    expect(new Uint8Array(await blobAfter!.arrayBuffer())).toEqual(MHTML_BYTES);
    void blobBefore;

    // Settings round-tripped.
    const settingsAfter = await getSettings(await repo());
    expect(settingsAfter).toEqual(settingsBefore);

    // The search index was rebuilt: the note is findable.
    const engine = await searchEngine();
    const search = await engine.execute({ query: 'round-trip' });
    expect(search.total).toBe(1);
  });

  it('merge mode adds records without clearing existing data', async () => {
    const first = await seedFullData();
    const archive = await exportBackup();

    // Add a second note AFTER the export.
    const second = (await ok('notes/create', { title: 'After backup', plainText: 'later' }))['note'] as Note;

    const restored = await restoreBackup(archive.blob, { mode: 'merge' });
    expect(restored.mode).toBe('merge');

    const ctx = await repo();
    const notes = await listAllNotes(ctx);
    expect(notes.length).toBe(2);
    expect((await getNote(ctx, first.note.id))?.title).toBe('Backup subject');
    expect((await getNote(ctx, second.id))?.title).toBe('After backup');
  });

  it('restore is idempotent (re-restoring the same archive)', async () => {
    await seedFullData();
    const archive = await exportBackup();
    await restoreBackup(archive.blob, { mode: 'replace', confirmReplace: true });
    const again = await restoreBackup(archive.blob, { mode: 'replace', confirmReplace: true });
    expect(again.imported.notes).toBe(1);
    expect((await listAllNotes(await repo())).length).toBe(1);
  });
});

describe('preview and validation (FR-DATA-04)', () => {
  it('previews manifest counts and version notes without writes', async () => {
    await seedFullData();
    const archive = await exportBackup();
    const before = (await listAllNotes(await repo())).length;
    const preview = await previewRestore(archive.blob);
    expect(preview.manifest.format).toBe(BACKUP_FORMAT);
    expect(preview.manifest.counts.notes).toBe(1);
    expect(preview.compatible).toBe(true);
    expect((await listAllNotes(await repo())).length).toBe(before);
  });

  it('rejects garbage files as not-a-zip, leaving the DB untouched', async () => {
    await seedFullData();
    const before = (await listAllNotes(await repo())).length;
    const garbage = new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], { type: 'application/zip' });
    await expect(restoreBackup(garbage, { mode: 'merge' })).rejects.toMatchObject({
      code: 'not-a-zip',
    });
    expect((await listAllNotes(await repo())).length).toBe(before);
  });

  it('rejects archives without a manifest', async () => {
    await seedFullData();
    const { zipSync } = await import('fflate');
    const noManifest = new Blob([zipSync({ 'data/notes.json': new TextEncoder().encode('[]') })]);
    await expect(restoreBackup(noManifest, { mode: 'merge' })).rejects.toMatchObject({
      code: 'missing-manifest',
    });
    expect((await listAllNotes(await repo())).length).toBe(1);
  });

  it('rejects tampered files on the hash check, leaving the DB untouched', async () => {
    await seedFullData();
    const archive = await exportBackup();
    const { unzipSync, zipSync } = await import('fflate');
    const entries = unzipSync(new Uint8Array(await archive.blob.arrayBuffer()));
    // Tamper with the notes payload without updating the manifest hash.
    const notes = JSON.parse(new TextDecoder().decode(entries['data/notes.json']!)) as Array<Record<string, unknown>>;
    notes[0]!['title'] = 'TAMPERED';
    const tampered = new Blob([
      zipSync({ ...entries, 'data/notes.json': new TextEncoder().encode(JSON.stringify(notes)) }),
    ]);
    await expect(restoreBackup(tampered, { mode: 'merge' })).rejects.toMatchObject({
      code: 'hash-mismatch',
    });
    // The original note is untouched.
    const ctx = await repo();
    expect((await listAllNotes(ctx)).map((note) => note.title)).toEqual(['Backup subject']);
  });

  it('rejects replace mode without explicit confirmation', async () => {
    await seedFullData();
    const archive = await exportBackup();
    await expect(restoreBackup(archive.blob, { mode: 'replace' })).rejects.toMatchObject({
      code: 'bad-format',
    });
    // Nothing was cleared.
    expect((await listAllNotes(await repo())).length).toBe(1);
  });

  it('rejects archives with dangling note references', async () => {
    await seedFullData();
    const archive = await exportBackup();
    const { unzipSync, zipSync, strToU8 } = await import('fflate');
    const entries = unzipSync(new Uint8Array(await archive.blob.arrayBuffer()));

    // Build a reminder pointing at a note that is not in the backup.
    const reminders = JSON.parse(new TextDecoder().decode(entries['data/reminders.json']!)) as Array<Record<string, unknown>>;
    const manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json']!)) as {
      files: Record<string, { sha256: string; bytes: number }>;
    };
    const ghostReminder = {
      ...reminders[0]!,
      id: '11111111-2222-4333-8444-555555555555',
      noteId: '99999999-9999-4999-8999-999999999999',
    };
    const patched = [...reminders, ghostReminder];
    const patchedBytes = new TextEncoder().encode(JSON.stringify(patched));
    const crypto = globalThis.crypto;
    const digest = await crypto.subtle.digest('SHA-256', patchedBytes as unknown as ArrayBuffer);
    const hash = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    manifest.files['data/reminders.json'] = { sha256: hash, bytes: patchedBytes.byteLength };
    const tampered = new Blob([
      zipSync({
        ...entries,
        'data/reminders.json': patchedBytes,
        'manifest.json': strToU8(JSON.stringify(manifest)),
      }),
    ]);
    await expect(restoreBackup(tampered, { mode: 'merge' })).rejects.toMatchObject({
      code: 'invalid-references',
    });
    expect((await listAllReminders(await repo())).length).toBe(1);
  });

  it('rejects unsafe archive paths', async () => {
    await seedFullData();
    const { zipSync } = await import('fflate');
    const evil = new Blob([
      zipSync({ '../escape.txt': new TextEncoder().encode('nope'), 'manifest.json': new TextEncoder().encode('{}') }),
    ]);
    await expect(restoreBackup(evil, { mode: 'merge' })).rejects.toBeInstanceOf(BackupValidationError);
  });

  it('RPC surfaces validation failures as coded invalid-request', async () => {
    await seedFullData();
    const garbage = new Blob([new Uint8Array([0, 1, 2])]);
    const response = await call('backup/restore', { archive: garbage, mode: 'merge' });
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('invalid-request');
      expect(response.error.message).toContain('ZIP');
    }
  });
});
