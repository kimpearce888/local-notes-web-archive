/**
 * Core domain types — the canonical data model (PRD §6).
 *
 * Invariants encoded here and enforced by the repository layer:
 *  - UUIDs are stable and never regenerated for a persisted entity.
 *  - Event timestamps are ISO 8601 UTC strings.
 *  - Reminder due dates are explicit local date/time plus IANA timezone.
 *  - Derived data (search index, alarm schedule) is rebuildable from these
 *    canonical records.
 */

/* ------------------------------------------------------------------ */
/* Branding helpers                                                    */
/* ------------------------------------------------------------------ */

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/** Entity identifier (UUID v4). */
export type EntityId = Brand<string, 'EntityId'>;
/** ISO 8601 UTC instant, e.g. 2026-10-12T08:15:30.000Z. */
export type UtcTimestamp = Brand<string, 'UtcTimestamp'>;
/** Content hash (hex SHA-256). */
export type ContentHash = Brand<string, 'ContentHash'>;
/** IndexedDB Blob store key. */
export type BlobKey = Brand<string, 'BlobKey'>;

/* ------------------------------------------------------------------ */
/* Shared value types                                                  */
/* ------------------------------------------------------------------ */

/** Local civil date (no time zone) used by yearly recurrences. */
export interface LocalDate {
  /** 1..12 */
  readonly month: number;
  /** 1..31 */
  readonly day: number;
}

/** Local wall-clock time used by reminders. */
export interface LocalTime {
  /** 0..23 */
  readonly hour: number;
  /** 0..59 */
  readonly minute: number;
}

/** IANA time zone database name, e.g. "Europe/Berlin". */
export type TimeZoneName = Brand<string, 'TimeZoneName'>;

export type NoteState = 'active' | 'archived' | 'trashed';

export type SaveState = 'saving' | 'saved' | 'save-failed';

/* ------------------------------------------------------------------ */
/* Note                                                                */
/* ------------------------------------------------------------------ */

/**
 * A note. `editorDoc` is the Tiptap/ProseMirror JSON document;
 * `plainText` is the derived searchable projection written in the same
 * transaction (PRD §4.3).
 */
export interface Note {
  readonly id: EntityId;
  title: string;
  subtitle: string;
  /** Tiptap JSON document (validated schema). */
  editorDoc: object | null;
  /** Derived plain-text projection for search and previews. */
  plainText: string;
  readonly createdAt: UtcTimestamp;
  updatedAt: UtcTimestamp;
  state: NoteState;
  pinned: boolean;
  favorite: boolean;
  /** Trashed-at time, set iff state === 'trashed'. */
  trashedAt: UtcTimestamp | null;
  archivedAt: UtcTimestamp | null;
  /** Current revision id (head of the bounded revision chain). */
  revisionId: EntityId | null;
  /** Set once, never mutated (duplicates get their own copy history). */
  duplicatedFrom: EntityId | null;
}

/* ------------------------------------------------------------------ */
/* Tags and categories                                                 */
/* ------------------------------------------------------------------ */

export interface Tag {
  readonly id: EntityId;
  /** Display name, any visible string. */
  name: string;
  /** Normalized unique key (casefold + whitespace-collapsed). */
  readonly normalizedKey: string;
  readonly createdAt: UtcTimestamp;
  updatedAt: UtcTimestamp;
}

export interface Category {
  readonly id: EntityId;
  name: string;
  /** Parent category for nesting; null at root. Cycles are forbidden. */
  parentId: EntityId | null;
  /** Sibling ordering within the parent. */
  order: number;
  readonly createdAt: UtcTimestamp;
  updatedAt: UtcTimestamp;
}

export interface NoteTag {
  readonly noteId: EntityId;
  readonly tagId: EntityId;
  readonly createdAt: UtcTimestamp;
}

export interface NoteCategory {
  readonly noteId: EntityId;
  readonly categoryId: EntityId;
  readonly createdAt: UtcTimestamp;
}

/* ------------------------------------------------------------------ */
/* Links and snapshots                                                 */
/* ------------------------------------------------------------------ */

export type CaptureArtifactState =
  | 'not-attempted'
  | 'pending'
  | 'saved'
  | 'failed'
  | 'canceled';

export type CaptureStatus =
  | 'queued'
  | 'permission-required'
  | 'capturing'
  | 'complete'
  | 'partial'
  | 'failed'
  | 'canceled';

export interface CaptureWarning {
  readonly kind:
    | 'resource-failure'
    | 'unsupported-frame'
    | 'lazy-content'
    | 'oversized'
    | 'access-restricted'
    | 'redirect'
    | 'screenshot-limits';
  readonly detail: string;
}

export interface Link {
  readonly id: EntityId;
  readonly noteId: EntityId;
  /** URL exactly as entered by the user. */
  originalUrl: string;
  /** Normalized deduplication key (scheme-host-normalized-path). */
  readonly dedupKey: string;
  /** Display/anchor text if captured from rich content. */
  anchorText: string;
  /** Origin (scheme://host:port) for permission bookkeeping. */
  readonly origin: string;
  readonly createdAt: UtcTimestamp;
  /** Associated snapshot, when a capture succeeded. */
  snapshotId: EntityId | null;
}

export interface Snapshot {
  readonly id: EntityId;
  readonly noteId: EntityId | null;
  readonly linkId: EntityId | null;
  /** URL the user asked to capture. */
  readonly sourceUrl: string;
  /** Validated final URL after redirects (must stay within granted origin). */
  readonly finalUrl: string;
  title: string;
  readonly capturedAt: UtcTimestamp;
  status: CaptureStatus;
  /** Per-artifact independent states (FR-CAP-07). */
  mhtml: CaptureArtifactState;
  png: CaptureArtifactState;
  text: CaptureArtifactState;
  /** Blob keys; null when the artifact was not saved. */
  mhtmlBlobKey: BlobKey | null;
  pngBlobKey: BlobKey | null;
  /** Extracted readable text, stored separately for search (FR-CAP-09). */
  extractedText: string;
  /** SHA-256 of stored artifact bytes, for integrity checks. */
  mhtmlHash: ContentHash | null;
  pngHash: ContentHash | null;
  /** Archive format, always "mhtml". */
  readonly format: 'mhtml';
  /** Byte sizes for storage reporting. */
  mhtmlSize: number;
  pngSize: number;
  textSize: number;
  warnings: CaptureWarning[];
  /** Previous snapshot of the same link (recapture chain, FR-CAP-08). */
  previousSnapshotId: EntityId | null;
}

export interface Attachment {
  readonly id: EntityId;
  readonly noteId: EntityId;
  /** Original filename as provided by the user. */
  filename: string;
  /** MIME type verified from bytes (never trusted from the OS label). */
  readonly mimeType: string;
  /** Byte length. */
  readonly size: number;
  readonly hash: ContentHash;
  readonly blobKey: BlobKey;
  readonly createdAt: UtcTimestamp;
}

/* ------------------------------------------------------------------ */
/* Reminders                                                           */
/* ------------------------------------------------------------------ */

/** Yearly recurrence behavior for February 29 (FR-REM-03). */
export type LeapDayPolicy = 'feb-28' | 'mar-1' | 'skip';

export type RecurrenceKind = 'one-time' | 'yearly';

export interface RecurrenceRule {
  readonly kind: RecurrenceKind;
  /** For yearly: month/day + local wall-clock time. */
  readonly on: LocalDate | null;
  readonly at: LocalTime | null;
  /**
   * Inclusive final year for yearly recurrence; null = until stopped.
   */
  readonly finalYear: number | null;
  readonly leapDayPolicy: LeapDayPolicy;
}

export type ReminderState = 'active' | 'completed' | 'dismissed' | 'stopped';

export interface Reminder {
  readonly id: EntityId;
  readonly noteId: EntityId;
  /** Due instant for one-time reminders (UTC). */
  readonly dueAt: UtcTimestamp | null;
  /** Canonical recurrence record for yearly reminders. */
  readonly recurrence: RecurrenceRule | null;
  /**
   * Time zone the reminder was created in (IANA). Recurrence is evaluated in
   * this zone; a zone change is handled deterministically (FR-REM-07).
   */
  readonly timeZone: TimeZoneName;
  state: ReminderState;
  /** Last fired occurrence (UTC), used for overdue coalescing. */
  lastFiredAt: UtcTimestamp | null;
  /** Next computed occurrence (UTC hint; alarms are hints only, FR-REM-04). */
  nextDueAt: UtcTimestamp | null;
  readonly createdAt: UtcTimestamp;
  updatedAt: UtcTimestamp;
  /** Snoozed-until instant while still active. */
  snoozedUntil: UtcTimestamp | null;
}

/* ------------------------------------------------------------------ */
/* Revisions                                                           */
/* ------------------------------------------------------------------ */

export interface Revision {
  readonly id: EntityId;
  readonly noteId: EntityId;
  /** Full editor JSON snapshot. */
  readonly editorDoc: object | null;
  /** Metadata snapshot (title, subtitle, tags, categories at save time). */
  readonly metadataSnapshot: RevisionMetadataSnapshot;
  readonly createdAt: UtcTimestamp;
  /** Short human-readable change summary. */
  readonly summary: string;
}

export interface RevisionMetadataSnapshot {
  readonly title: string;
  readonly subtitle: string;
  readonly tagIds: readonly EntityId[];
  readonly categoryId: readonly EntityId[];
}

/* ------------------------------------------------------------------ */
/* Audit and logs                                                      */
/* ------------------------------------------------------------------ */

export type AuditActor = 'user' | 'ai';

export type AuditOutcome =
  | 'succeeded'
  | 'failed'
  | 'denied'
  | 'awaiting-approval'
  | 'approved'
  | 'rejected'
  | 'canceled';

export interface AuditEvent {
  readonly id: EntityId;
  readonly at: UtcTimestamp;
  readonly actor: AuditActor;
  readonly action: string;
  /** Target entity id, when applicable. */
  readonly targetId: EntityId | null;
  readonly targetKind: string | null;
  readonly outcome: AuditOutcome;
  /** Correlation id linking related events (tool call, capture job, save). */
  readonly correlationId: string;
  /** Changed-field names (never full content — FR-LOG-02). */
  readonly changedFields: readonly string[];
  /** Content hash of the changed payload, when useful. */
  readonly contentHash: ContentHash | null;
  /** Sanitized detail message. */
  readonly detail: string;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DiagnosticLog {
  readonly id: EntityId;
  readonly at: UtcTimestamp;
  readonly level: LogLevel;
  readonly component: string;
  readonly operationId: string;
  readonly correlationId: string;
  /** Wall duration of the operation in milliseconds, when measured. */
  readonly durationMs: number | null;
  readonly resultCode: string;
  readonly message: string;
}

/* ------------------------------------------------------------------ */
/* AI                                                                  */
/* ------------------------------------------------------------------ */

export type AiPermissionMode =
  | 'read-only'
  | 'ask-per-write'
  | 'safe-writes';

export type ToolCallStatus =
  | 'proposed'
  | 'awaiting-approval'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'canceled';

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export type ThemePreference = 'light' | 'dark' | 'system';
export type ViewMode = 'grid' | 'list';

export type SortField =
  | 'relevance'
  | 'title'
  | 'created'
  | 'modified'
  | 'reminder'
  | 'capture';
export type SortDirection = 'asc' | 'desc';

export interface SavedView {
  readonly id: EntityId;
  name: string;
  /** Serialized query string (FR-SEARCH-04 syntax). */
  query: string;
  /** Serialized filter state. */
  filters: Filters;
  readonly createdAt: UtcTimestamp;
}

export interface Filters {
  createdAfter?: string;
  createdBefore?: string;
  modifiedAfter?: string;
  modifiedBefore?: string;
  tagIds?: readonly EntityId[];
  categoryIds?: readonly EntityId[];
  pinned?: boolean;
  favorite?: boolean;
  state?: NoteState;
  reminder?: 'any' | 'due' | 'overdue' | 'completed';
  hasLink?: boolean;
  snapshot?: 'any' | 'present' | 'missing' | 'failed';
  hasAttachment?: boolean;
  capturedAfter?: string;
  capturedBefore?: string;
  sourceDomain?: string;
}

export interface AppSettings {
  theme: ThemePreference;
  viewMode: ViewMode;
  defaultSort: { field: SortField; direction: SortDirection };
  savedViews: readonly SavedView[];
  /** Auto-capture URLs detected on paste (FR-CAP-01). */
  autoCaptureOnPaste: boolean;
  /** Granted capture origins (revoke from settings, FR-CAP-02). */
  allowedOrigins: readonly string[];
  /** Capture budgets. */
  capture: {
    /** Max individual archive bytes (default 100 MB, PRD §10). */
    maxArchiveBytes: number;
    /** Max screenshot pixels before tiling is refused. */
    maxScreenshotPixels: number;
    /** Max capture job wall time in milliseconds. */
    timeoutMs: number;
  };
  /** Duplicate capture handling (FR-CAP-08). */
  duplicateCapture: 'ask' | 'reuse' | 'always-new';
  reminders: {
    notificationsEnabled: boolean;
    leapDayPolicy: LeapDayPolicy;
  };
  editor: {
    /** Toolbar groups enabled (all true by default). */
    toolbar: Record<string, boolean>;
  };
  /** Revision retention per note (>= 20 per PRD FR-NOTE-06). */
  revisionRetention: number;
  backup: {
    /** Warn when last backup older than N days; 0 disables. */
    warnAfterDays: number;
  };
  ai: {
    enabled: boolean;
    baseUrl: string;
    model: string | null;
    timeoutMs: number;
    permissionMode: AiPermissionMode;
  };
  logs: {
    /** Rolling technical log ceiling in bytes (FR-LOG-04). */
    maxBytes: number;
    /** Audit retention in days. */
    auditRetentionDays: number;
  };
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

export type SearchField =
  | 'title'
  | 'subtitle'
  | 'body'
  | 'tags'
  | 'categories'
  | 'links'
  | 'snapshots'
  | 'attachments';

export interface SearchHit {
  readonly noteId: EntityId;
  readonly score: number;
  /** Which fields matched, for result decoration. */
  readonly matchedFields: readonly SearchField[];
}

export interface SearchResult {
  readonly hits: readonly SearchHit[];
  /** Total notes matching before pagination. */
  readonly total: number;
  /** Parse/execution warnings for inline display (FR-SEARCH-04). */
  readonly queryErrors: readonly string[];
}
