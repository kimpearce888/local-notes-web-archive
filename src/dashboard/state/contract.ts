/**
 * Typed RPC contract between the dashboard and the service worker. Every
 * message type maps to the payload the background handler validates and the
 * result it returns — the dashboard client and the router share this single
 * source of truth so the two sides cannot drift apart.
 */

import type {
  AppSettings,
  Attachment,
  Category,
  EntityId,
  Filters,
  Link,
  Note,
  NoteState,
  RecurrenceRule,
  Reminder,
  Revision,
  SearchResult,
  Snapshot,
  SortDirection,
  SortField,
  Tag,
  TimeZoneName,
  UtcTimestamp,
} from '../../core/types';
import type { CategoryNode } from '../../core/repo/categories';
import type { CreateLinkResult } from '../../core/repo/links';
import type { LinkDetectionResult } from '../../background/api/links';
import type { GrantedOriginInfo } from '../../background/api/permissions';
import type { AlarmReconcileResult } from '../../background/alarms';
import type { CommandStatus } from '../../background/api/settings';
import type { CaptureQueueStatus, DuplicateResolution } from '../../background/capture/queue';
import type { ConnectionTestResult, LmStudioModel } from '../../background/ai/client';
import type { AgentTurnResult } from '../../background/ai/agent';
import type { BackupExportResult } from '../../background/backup/export';
import type { BackupPreview } from '../../background/backup/restore';
import type { NoteExportFile } from '../../background/api/note-transfer';
import type { StorageHealthReport } from '../../background/api/storage-health';
import type {
  DiagnosticsExport,
  DiagnosticsOverview,
  NetworkSelfTestResult,
} from '../../background/api/diagnostics';
import type { AuditEvent, DiagnosticLog, LogLevel } from '../../core/types';

export interface ApiContract {
  /* app */
  'app/ping': {
    payload: { probe?: string };
    result: { pong: boolean; app: string; version: string; minChromeVersion: number; schemaVersion: number };
  };

  /* notes */
  'notes/create': {
    payload: {
      title?: string;
      subtitle?: string;
      editorDoc?: object | null;
      plainText?: string;
      pinned?: boolean;
      favorite?: boolean;
    };
    result: { note: Note };
  };
  'notes/get': { payload: { noteId: EntityId }; result: { note: Note } };
  'notes/list': { payload: { state?: NoteState }; result: { notes: Note[] } };
  'notes/save': {
    payload: {
      noteId: EntityId;
      title: string;
      subtitle: string;
      editorDoc: object | null;
      plainText: string;
      expectedRevisionId: EntityId | null;
      changeSummary: string;
    };
    result: { note: Note };
  };
  'notes/archive': { payload: { noteId: EntityId }; result: { note: Note } };
  'notes/restore': { payload: { noteId: EntityId }; result: { note: Note } };
  'notes/trash': { payload: { noteId: EntityId }; result: { note: Note } };
  'notes/delete-permanently': {
    payload: { noteId: EntityId; confirm: true };
    result: { deleted: boolean; noteId: EntityId };
  };
  'notes/duplicate': { payload: { noteId: EntityId }; result: { note: Note } };
  'notes/set-flags': {
    payload: { noteId: EntityId; pinned?: boolean; favorite?: boolean };
    result: { note: Note };
  };
  'notes/restore-revision': {
    payload: { noteId: EntityId; revisionId: EntityId; expectedRevisionId?: EntityId | null };
    result: { note: Note };
  };
  'notes/revisions': { payload: { noteId: EntityId }; result: { revisions: Revision[] } };
  'notes/related': {
    payload: { noteId: EntityId };
    result: { note: Note; tags: Tag[]; categories: Category[]; links: Link[]; reminders: Reminder[] };
  };
  'notes/related-bulk': {
    payload: { noteIds: readonly EntityId[] };
    result: {
      related: Record<string, { tags: Tag[]; categories: Category[]; links: Link[]; reminders: Reminder[] }>;
    };
  };
  'notes/counts': {
    payload: Record<string, never>;
    result: { counts: { active: number; archived: number; trashed: number } };
  };

  /* tags */
  'tags/list': { payload: Record<string, never>; result: { tags: Tag[] } };
  'tags/create': { payload: { name: string }; result: { tag: Tag } };
  'tags/rename': { payload: { tagId: EntityId; name: string }; result: { tag: Tag } };
  'tags/merge': {
    payload: { sourceTagId: EntityId; targetTagId: EntityId };
    result: { merged: boolean };
  };
  'tags/delete': { payload: { tagId: EntityId }; result: { deleted: boolean } };
  'tags/set-note-tags': {
    payload: { noteId: EntityId; tagIds: readonly EntityId[] };
    result: { applied: boolean };
  };
  'tags/assign-to-notes': {
    payload: { noteIds: readonly EntityId[]; tagIds: readonly EntityId[] };
    result: { applied: boolean };
  };

  /* categories */
  'categories/list': { payload: Record<string, never>; result: { categories: Category[] } };
  'categories/tree': { payload: Record<string, never>; result: { tree: CategoryNode[] } };
  'categories/create': {
    payload: { name: string; parentId?: EntityId | null };
    result: { category: Category };
  };
  'categories/rename': {
    payload: { categoryId: EntityId; name: string };
    result: { category: Category };
  };
  'categories/move': {
    payload: { categoryId: EntityId; parentId?: EntityId | null };
    result: { category: Category };
  };
  'categories/merge': {
    payload: { sourceCategoryId: EntityId; targetCategoryId: EntityId };
    result: { merged: boolean };
  };
  'categories/delete': {
    payload: { categoryId: EntityId; reassignTo?: EntityId | null };
    result: { deleted: boolean };
  };
  'categories/set-note-categories': {
    payload: { noteId: EntityId; categoryIds: readonly EntityId[] };
    result: { applied: boolean };
  };
  'categories/assign-to-notes': {
    payload: { noteIds: readonly EntityId[]; categoryIds: readonly EntityId[] };
    result: { applied: boolean };
  };

  /* links */
  'links/create': {
    payload: { noteId: EntityId; url: string; anchorText?: string };
    result: CreateLinkResult;
  };
  'links/list-for-note': { payload: { noteId: EntityId }; result: { links: Link[] } };
  'links/find-by-url': { payload: { url: string }; result: { links: Link[] } };
  'links/update-anchor': {
    payload: { linkId: EntityId; anchorText: string };
    result: { updated: boolean };
  };
  'links/delete': { payload: { linkId: EntityId }; result: { deleted: boolean } };
  'links/detect-and-queue': {
    payload: { noteId: EntityId; urls: readonly string[]; source: 'paste' | 'manual' };
    result: { results: LinkDetectionResult[] };
  };
  'links/queue-capture': {
    payload: { linkId: EntityId };
    result: { link: Link; permissionRequired: boolean };
  };
  'links/request-capture-permission': {
    payload: { linkId: EntityId };
    result: { granted: boolean; alreadyGranted: boolean; link: Link };
  };
  'links/set-capture-state': {
    payload: { linkId: EntityId; captureState: Link['captureState'] };
    result: { link: Link };
  };

  /* permissions (T-021: origin access, FR-CAP-02/FR-SET-03) */
  'permissions/list-granted': {
    payload: Record<string, never>;
    result: { origins: readonly GrantedOriginInfo[] };
  };
  'permissions/revoke': {
    payload: { origin: string };
    result: { revoked: boolean; demotedLinks: number };
  };

  /* capture control (T-023: the dashboard's handle on the single queue) */
  'capture/status': {
    payload: Record<string, never>;
    result: { status: CaptureQueueStatus };
  };
  'capture/cancel': {
    payload: { linkId: EntityId };
    result: { canceled: boolean };
  };
  'capture/retry': {
    payload: { linkId: EntityId };
    result: { retried: boolean };
  };
  'capture/resolve-duplicate': {
    payload: { linkId: EntityId; resolution: DuplicateResolution };
    result: { resolved: boolean };
  };

  /* snapshots (T-026: management UI, FR-CAP-06/07/08) */
  'snapshots/list-for-note': {
    payload: { noteId: EntityId };
    result: { snapshots: readonly Snapshot[] };
  };
  'snapshots/list-for-link': {
    payload: { linkId: EntityId };
    result: { snapshots: readonly Snapshot[] };
  };
  'snapshots/rename': {
    payload: { snapshotId: EntityId; title: string };
    result: { snapshot: Snapshot };
  };
  'snapshots/delete': {
    payload: { snapshotId: EntityId };
    result: { deleted: boolean; link: Link | null };
  };
  'snapshots/get-png': {
    payload: { snapshotId: EntityId };
    result: { png: Blob | null };
  };
  'snapshots/export': {
    payload: { snapshotId: EntityId; format: 'mhtml' | 'png' | 'text' };
    result: { blob: Blob; filename: string };
  };

  /* attachments (T-019: images and files; T-063 wire format) */
  'attachments/add': {
    payload: {
      noteId: EntityId;
      filename: string;
      declaredMimeType: string;
      /** Crosses the channel as a base64 envelope; the worker rebuilds the
       * Blob before handler validation (background/protocol.ts, T-063). */
      data: Blob;
    };
    result: { attachment: Attachment; deduplicated: boolean };
  };
  'attachments/list-for-note': {
    payload: { noteId: EntityId };
    result: { attachments: Attachment[] };
  };
  'attachments/get-blob': {
    payload: { attachmentId: EntityId };
    result: { attachment: Attachment; blob: Blob | null };
  };
  'attachments/rename': {
    payload: { attachmentId: EntityId; filename: string };
    result: { updated: boolean };
  };
  'attachments/delete': {
    payload: { attachmentId: EntityId };
    result: { deleted: boolean };
  };

  /* search */
  'search/query': {
    payload: {
      query: string;
      filters?: Filters;
      sort?: { field: SortField; direction: SortDirection };
      limit?: number;
      offset?: number;
      fuzzy?: boolean;
    };
    result: SearchResult;
  };
  'search/rebuild': { payload: Record<string, never>; result: { indexed: number } };
  'search/status': { payload: Record<string, never>; result: { documentCount: number } };

  /* settings */
  'settings/get': { payload: Record<string, never>; result: { settings: AppSettings } };
  'settings/patch': { payload: { patch: Record<string, unknown> }; result: { settings: AppSettings } };
  'settings/get-onboarding-complete': { payload: Record<string, never>; result: { complete: boolean } };
  'settings/set-onboarding-complete': { payload: { complete: boolean }; result: { complete: boolean } };
  'commands/status': { payload: Record<string, never>; result: CommandStatus };

  /* AI (T-029: LM Studio connection test and model listing, FR-AI-01..03) */
  'ai/test-connection': {
    payload: { baseUrl?: string };
    result: { result: ConnectionTestResult };
  };
  'ai/list-models': {
    payload: { baseUrl?: string };
    result: { models: LmStudioModel[] };
  };
  /* storage health (T-036, FR-DATA-02/07) */
  'storage/health': { payload: Record<string, never>; result: { report: StorageHealthReport } };
  'storage/request-persistence': {
    payload: Record<string, never>;
    result: { requested: boolean; persisted: boolean | null };
  };
  'storage/data-loss-warning': { payload: Record<string, never>; result: { warning: string } };
  /* note-level transfer (T-035, FR-DATA-05) */
  'notes/export-file': {
    payload: { noteId: EntityId };
    result: { blob: Blob; filename: string; file?: NoteExportFile };
  };
  /* backup (T-033/T-034, FR-DATA-03/04/05) */
  'backup/export': { payload: Record<string, never>; result: BackupExportResult };
  'backup/preview': { payload: { archive: Blob }; result: { preview: BackupPreview } };
  'backup/restore': {
    payload: { archive: Blob; mode: 'merge' | 'replace'; confirmReplace?: boolean };
    result: {
      result: {
        mode: 'merge' | 'replace';
        imported: { notes: number; reminders: number; snapshots: number; blobs: number };
      };
    };
  };
  'ai/chat': {
    payload: {
      messages: { role: 'user' | 'assistant'; content: string }[];
      approvedToolCallIds?: string[];
    };
    result: { result: AgentTurnResult };
  };

  /* reminders (nextDueAt is engine-computed in the background, never client-supplied) */
  'reminders/create': {
    payload: {
      noteId: EntityId;
      dueAt?: UtcTimestamp | null;
      recurrence?: RecurrenceRule | null;
      timeZone: TimeZoneName;
    };
    result: { reminder: Reminder };
  };
  'reminders/get': { payload: { reminderId: EntityId }; result: { reminder: Reminder } };
  'reminders/list-for-note': { payload: { noteId: EntityId }; result: { reminders: Reminder[] } };
  'reminders/list-all': { payload: Record<string, never>; result: { reminders: Reminder[] } };
  'reminders/update-rule': {
    payload: {
      reminderId: EntityId;
      dueAt?: UtcTimestamp | null;
      recurrence?: RecurrenceRule | null;
      timeZone?: TimeZoneName;
    };
    result: { reminder: Reminder };
  };
  'reminders/complete': { payload: { reminderId: EntityId }; result: { reminder: Reminder } };
  'reminders/dismiss': { payload: { reminderId: EntityId }; result: { reminder: Reminder } };
  'reminders/stop': { payload: { reminderId: EntityId }; result: { reminder: Reminder } };
  'reminders/snooze': {
    payload: { reminderId: EntityId; until: UtcTimestamp };
    result: { reminder: Reminder };
  };
  'reminders/delete': { payload: { reminderId: EntityId }; result: { deleted: boolean } };
  'reminders/reconcile-alarms': { payload: Record<string, never>; result: AlarmReconcileResult };

  /* diagnostics (T-038, FR-LOG-05 / FR-SET-04) */
  'diagnostics/overview': { payload: Record<string, never>; result: { overview: DiagnosticsOverview } };
  'diagnostics/logs': {
    payload: { level?: LogLevel | 'error+warn' | null; limit?: number; offset?: number };
    result: { logs: DiagnosticLog[]; total: number };
  };
  'diagnostics/audit': {
    payload: { actor?: 'user' | 'ai' | null; limit?: number; offset?: number };
    result: { events: AuditEvent[]; total: number };
  };
  'diagnostics/network-self-test': { payload: Record<string, never>; result: { result: NetworkSelfTestResult } };
  'diagnostics/export-bundle': { payload: Record<string, never>; result: { bundle: DiagnosticsExport } };
}

export type ApiMessageType = keyof ApiContract;
