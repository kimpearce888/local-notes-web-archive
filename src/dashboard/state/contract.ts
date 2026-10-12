/**
 * Typed RPC contract between the dashboard and the service worker. Every
 * message type maps to the payload the background handler validates and the
 * result it returns — the dashboard client and the router share this single
 * source of truth so the two sides cannot drift apart.
 */

import type {
  AppSettings,
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
  SortDirection,
  SortField,
  Tag,
  TimeZoneName,
  UtcTimestamp,
} from '../../core/types';
import type { CategoryNode } from '../../core/repo/categories';
import type { CreateLinkResult } from '../../core/repo/links';
import type { AlarmReconcileResult } from '../../background/alarms';
import type { CommandStatus } from '../../background/api/settings';

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

  /* reminders */
  'reminders/create': {
    payload: {
      noteId: EntityId;
      dueAt?: UtcTimestamp | null;
      recurrence?: RecurrenceRule | null;
      timeZone: TimeZoneName;
      nextDueAt?: UtcTimestamp | null;
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
      nextDueAt?: UtcTimestamp | null;
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
}

export type ApiMessageType = keyof ApiContract;
