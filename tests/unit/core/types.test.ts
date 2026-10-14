import { describe, expect, it } from 'vitest';
import type {
  AppSettings,
  Attachment,
  AuditEvent,
  Category,
  DiagnosticLog,
  EntityId,
  LeapDayPolicy,
  Link,
  Note,
  RecurrenceRule,
  Reminder,
  Revision,
  SearchResult,
  Snapshot,
  Tag,
  TimeZoneName,
  BlobKey,
  ContentHash,
  UtcTimestamp,
} from '../../../src/core/types';
import { APP_NAME, APP_VERSION, SCHEMA_VERSION } from '../../../src/core/version';

/**
 * T-004 validation: the domain model compiles under strict TypeScript with
 * the PRD §6 shape, and branded ids remain plain strings at runtime
 * (zero-cost branding — safe for IndexedDB structured clone).
 *
 * The repository layer (T-005+) constructs branded values through validated
 * factories; tests use direct casts for fixtures only.
 */
const id = (s: string): EntityId => s as EntityId;
const ts = (s: string): UtcTimestamp => s as UtcTimestamp;
const tz = (s: string): TimeZoneName => s as TimeZoneName;
const blobKey = (s: string): BlobKey => s as BlobKey;
const hash = (s: string): ContentHash => s as ContentHash;
const T0 = '2026-10-12T08:00:00.000Z';

function sampleNote(): Note {
  return {
    id: id('n-1'),
    title: 'Note',
    subtitle: '',
    editorDoc: { type: 'doc', content: [] },
    plainText: 'body',
    createdAt: ts(T0),
    updatedAt: ts(T0),
    state: 'active',
    pinned: false,
    favorite: false,
    trashedAt: null,
    archivedAt: null,
    revisionId: null,
    duplicatedFrom: null,
  };
}

function sampleReminder(): Reminder {
  const rule: RecurrenceRule = {
    kind: 'yearly',
    on: { month: 2, day: 29 },
    at: { hour: 9, minute: 0 },
    finalYear: 2035,
    leapDayPolicy: 'feb-28',
  };
  return {
    id: id('r-1'),
    noteId: id('n-1'),
    dueAt: null,
    recurrence: rule,
    timeZone: tz('Europe/Berlin'),
    state: 'active',
    lastFiredAt: null,
    nextDueAt: null,
    createdAt: ts(T0),
    updatedAt: ts(T0),
    snoozedUntil: null,
  };
}

describe('domain types', () => {
  it('branded ids are runtime strings (structured-clone safe)', () => {
    const note = sampleNote();
    expect(typeof note.id).toBe('string');
    const asRecord = structuredClone(note) as unknown as Record<string, unknown>;
    expect(asRecord['id']).toBe('n-1');
  });

  it('reminder encodes PRD recurrence semantics', () => {
    const reminder = sampleReminder();
    expect(reminder.recurrence?.kind).toBe('yearly');
    expect(reminder.recurrence?.finalYear).toBe(2035);
    expect(reminder.recurrence?.leapDayPolicy).toBe('feb-28');
    expect(reminder.timeZone).toBe('Europe/Berlin');
    const policies: LeapDayPolicy[] = ['feb-28', 'mar-1', 'skip'];
    expect(policies).toHaveLength(3);
  });

  it('snapshot carries per-artifact state (FR-CAP-07)', () => {
    const snapshot = {
      id: id('s-1'),
      noteId: id('n-1'),
      linkId: id('l-1'),
      sourceUrl: 'https://example.com/a',
      finalUrl: 'https://example.com/a',
      title: 'Example',
      capturedAt: ts(T0),
      status: 'partial',
      mhtml: 'saved',
      png: 'failed',
      text: 'saved',
      mhtmlBlobKey: blobKey('blob-1'),
      pngBlobKey: null,
      extractedText: 'text',
      mhtmlHash: hash('hash'),
      pngHash: null,
      format: 'mhtml',
      mhtmlSize: 10,
      pngSize: 0,
      textSize: 4,
      warnings: [],
      canonicalUrl: null,
      previousSnapshotId: null,
    } satisfies Snapshot;
    expect(snapshot.status).toBe('partial');
    expect(snapshot.png).toBe('failed');
  });

  it('settings cover every FR-SET-01 surface', () => {
    const settings = {
      theme: 'system',
      viewMode: 'grid',
      defaultSort: { field: 'modified', direction: 'desc' },
      savedViews: [],
      autoCaptureOnPaste: true,
      allowedOrigins: [],
      capture: { maxArchiveBytes: 100_000_000, maxScreenshotPixels: 100_000_000, timeoutMs: 60_000 },
      duplicateCapture: 'ask',
      reminders: { notificationsEnabled: true, leapDayPolicy: 'feb-28' },
      editor: { toolbar: {} },
      revisionRetention: 20,
      backup: { warnAfterDays: 7 },
      ai: {
        enabled: false,
        baseUrl: 'http://127.0.0.1:1234/v1',
        model: null,
        timeoutMs: 30_000,
        permissionMode: 'ask-per-write',
      },
      logs: { maxBytes: 5_242_880, auditRetentionDays: 365 },
      onboardingComplete: false,
    } satisfies AppSettings;
    expect(settings.capture.maxArchiveBytes).toBe(100_000_000);
    expect(settings.ai.baseUrl).toBe('http://127.0.0.1:1234/v1');
  });

  it('search result exposes query errors for inline explanation', () => {
    const result: SearchResult = { hits: [], total: 0, queryErrors: ['unknown field: foo'] };
    expect(result.queryErrors).toHaveLength(1);
  });

  it('all PRD §6 entities are representable', () => {
    const entities = {
      note: sampleNote(),
      tag: { id: id('t-1'), name: 'x', normalizedKey: 'x', createdAt: ts(T0), updatedAt: ts(T0) } satisfies Tag,
      category: { id: id('c-1'), name: 'x', parentId: null, order: 0, createdAt: ts(T0), updatedAt: ts(T0) } satisfies Category,
      link: { id: id('l-1'), noteId: id('n-1'), originalUrl: 'https://a/', dedupKey: 'https://a/', anchorText: '', origin: 'https://a', createdAt: ts(T0), snapshotId: null, captureState: 'detected' } satisfies Link,
      attachment: { id: id('a-1'), noteId: id('n-1'), filename: 'f', mimeType: 'text/plain', size: 1, hash: hash('h'), blobKey: blobKey('b'), createdAt: ts(T0) } satisfies Attachment,
      revision: { id: id('rv-1'), noteId: id('n-1'), editorDoc: null, metadataSnapshot: { title: '', subtitle: '', tagIds: [], categoryId: [] }, createdAt: ts(T0), summary: '' } satisfies Revision,
      audit: { id: id('ev-1'), at: ts(T0), actor: 'user', action: 'create', targetId: id('n-1'), targetKind: 'note', outcome: 'succeeded', correlationId: 'corr-1', changedFields: [], contentHash: null, detail: '' } satisfies AuditEvent,
      log: { id: id('lg-1'), at: ts(T0), level: 'info', component: 'db', operationId: 'op-1', correlationId: 'corr-1', durationMs: 1, resultCode: 'OK', message: '' } satisfies DiagnosticLog,
    };
    expect(Object.keys(entities)).toHaveLength(8);
  });

  it('app metadata is defined', () => {
    expect(APP_NAME).toBe('Local Notes & Web Archive');
    expect(APP_VERSION).toBe('1.0.6');
    // v2 adds the links.origin index (T-021 permission bookkeeping).
    expect(SCHEMA_VERSION).toBe(2);
  });
});
