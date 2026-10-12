import { DB_NAME } from '../version';

/**
 * IndexedDB canonical store layout (PRD §6, FR-DATA-01).
 *
 * The database is the source of truth for notes, revisions, reminders,
 * categories, tags, capture metadata, blobs, attachments, settings and audit
 * records. `chrome.storage.local` is used only for tiny extension flags.
 */

export const DB_VERSION = 2;

export const Store = {
  Notes: 'notes',
  Tags: 'tags',
  Categories: 'categories',
  NoteTags: 'note_tags',
  NoteCategories: 'note_categories',
  Links: 'links',
  Snapshots: 'snapshots',
  Attachments: 'attachments',
  Reminders: 'reminders',
  Revisions: 'revisions',
  AuditEvents: 'audit_events',
  DiagnosticLogs: 'diagnostic_logs',
  Settings: 'settings',
  Blobs: 'blobs',
  SearchMeta: 'search_meta',
} as const;

export type StoreName = (typeof Store)[keyof typeof Store];

export interface IndexSpec {
  readonly name: string;
  readonly keyPath: string | readonly string[];
  readonly unique?: boolean;
}

export interface StoreSpec {
  readonly name: StoreName;
  readonly keyPath: string | readonly string[];
  readonly indexes: readonly IndexSpec[];
}

/**
 * Complete schema for version 1. Migrations derive from this table plus
 * explicit steps for future versions (see migrations.ts).
 *
 * v2 adds the `links.origin` index (per-origin permission bookkeeping,
 * FR-CAP-02/FR-SET-03 revocation) — see LINKS_ORIGIN_INDEX and migrationV2.
 */
export const SCHEMA_V1: readonly StoreSpec[] = [
  {
    name: Store.Notes,
    keyPath: 'id',
    indexes: [
      { name: 'state', keyPath: 'state' },
      { name: 'updatedAt', keyPath: 'updatedAt' },
      { name: 'createdAt', keyPath: 'createdAt' },
      { name: 'pinned', keyPath: 'pinned' },
      { name: 'favorite', keyPath: 'favorite' },
      { name: 'state_updated', keyPath: ['state', 'updatedAt'] },
    ],
  },
  {
    name: Store.Tags,
    keyPath: 'id',
    indexes: [{ name: 'normalizedKey', keyPath: 'normalizedKey', unique: true }],
  },
  {
    name: Store.Categories,
    keyPath: 'id',
    indexes: [{ name: 'parentId', keyPath: 'parentId' }],
  },
  {
    name: Store.NoteTags,
    keyPath: ['noteId', 'tagId'],
    indexes: [
      { name: 'noteId', keyPath: 'noteId' },
      { name: 'tagId', keyPath: 'tagId' },
    ],
  },
  {
    name: Store.NoteCategories,
    keyPath: ['noteId', 'categoryId'],
    indexes: [
      { name: 'noteId', keyPath: 'noteId' },
      { name: 'categoryId', keyPath: 'categoryId' },
    ],
  },
  {
    name: Store.Links,
    keyPath: 'id',
    indexes: [
      { name: 'noteId', keyPath: 'noteId' },
      { name: 'dedupKey', keyPath: 'dedupKey' },
      { name: 'note_dedup', keyPath: ['noteId', 'dedupKey'] },
    ],
  },
  {
    name: Store.Snapshots,
    keyPath: 'id',
    indexes: [
      { name: 'noteId', keyPath: 'noteId' },
      { name: 'linkId', keyPath: 'linkId' },
      { name: 'capturedAt', keyPath: 'capturedAt' },
      { name: 'status', keyPath: 'status' },
    ],
  },
  {
    name: Store.Attachments,
    keyPath: 'id',
    indexes: [
      { name: 'noteId', keyPath: 'noteId' },
      { name: 'hash', keyPath: 'hash' },
    ],
  },
  {
    name: Store.Reminders,
    keyPath: 'id',
    indexes: [
      { name: 'noteId', keyPath: 'noteId' },
      { name: 'state', keyPath: 'state' },
      { name: 'nextDueAt', keyPath: 'nextDueAt' },
      { name: 'state_next', keyPath: ['state', 'nextDueAt'] },
    ],
  },
  {
    name: Store.Revisions,
    keyPath: 'id',
    indexes: [
      { name: 'noteId', keyPath: 'noteId' },
      { name: 'note_created', keyPath: ['noteId', 'createdAt'] },
      { name: 'createdAt', keyPath: 'createdAt' },
    ],
  },
  {
    name: Store.AuditEvents,
    keyPath: 'id',
    indexes: [
      { name: 'at', keyPath: 'at' },
      { name: 'correlationId', keyPath: 'correlationId' },
      { name: 'target', keyPath: ['targetKind', 'targetId'] },
    ],
  },
  {
    name: Store.DiagnosticLogs,
    keyPath: 'id',
    indexes: [
      { name: 'at', keyPath: 'at' },
      { name: 'level', keyPath: 'level' },
    ],
  },
  {
    name: Store.Settings,
    keyPath: 'key',
    indexes: [],
  },
  {
    name: Store.Blobs,
    keyPath: 'key',
    indexes: [],
  },
  {
    name: Store.SearchMeta,
    keyPath: 'key',
    indexes: [],
  },
];

export { DB_NAME };

/**
 * Index added to the links store by migration v2: one row per link keyed by
 * its origin so revoking an origin's site access (FR-CAP-02/FR-SET-03) can
 * find every affected link without a full scan.
 */
export const LINKS_ORIGIN_INDEX: IndexSpec = { name: 'origin', keyPath: 'origin' };
