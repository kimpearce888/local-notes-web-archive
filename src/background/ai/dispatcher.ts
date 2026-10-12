/**
 * Tool dispatcher (FR-AI-06): the model PROPOSES tool calls; this module
 * validates every proposal and executes it against the canonical stores.
 * Fail-closed on unknown names, malformed JSON, schema violations, invalid
 * IDs and domain errors. Every output is bounded.
 *
 * Prompt-injection containment (FR-AI-08): model strings are data. They are
 * validated, bounded and stored — never parsed as instructions, policy
 * changes or permission grants. Destructive operations stay gated by the
 * permission layer (T-031) which wraps this dispatcher.
 */

import { repo, searchEngine } from '../db';
import {
  archiveNote,
  createNote,
  duplicateNote,
  getNote,
  restoreNote,
  saveNote,
  trashNote,
  NoteConflictError,
  NoteNotFoundError,
} from '../../core/repo/notes';
import {
  createTag,
  deleteTag,
  listTags,
  mergeTags,
  renameTag,
  setNoteTags,
  listNoteTags,
  TagNotFoundError,
  DuplicateTagError,
} from '../../core/repo/tags';
import {
  createCategory,
  deleteCategory,
  listCategories,
  moveCategory,
  renameCategory,
  setNoteCategories,
  listNoteCategories,
  CategoryNotFoundError,
  CategoryCycleError,
} from '../../core/repo/categories';
import {
  completeReminder,
  createReminder,
  getReminder,
  listAllReminders,
  listNoteReminders,
  updateReminderRule,
  ReminderNotFoundError,
} from '../../core/repo/reminders';
import { getSnapshot, listNoteSnapshots } from '../../core/repo/snapshots';
import { getLink } from '../../core/repo/links';
import { getCaptureQueue } from '../capture/pipeline';
import { computeNextDueAt, validateRecurrenceRule } from '../reminders/engine';
import { isValidTimeZone, nowUtc } from '../../core/util/time';
import { listLogs, countLogs } from '../../core/repo/logs';
import { Store } from '../../core/db/schema';
import { TOOL_SPECS, toolSpec, type ToolRisk, isToolName } from './tools';
import type { EntityId, Note, Reminder, RecurrenceRule } from '../../core/types';

/** Bounded outputs: the model conversation cannot be flooded. */
const SEARCH_LIMIT_MAX = 20;
const NOTE_PREVIEW_CHARS = 2000;
const SNAPSHOT_TEXT_DEFAULT = 4000;
const SNAPSHOT_TEXT_MAX = 8000;
const LIST_CAP = 50;

export type ToolErrorCode =
  | 'unknown-tool'
  | 'malformed-arguments'
  | 'invalid-arguments'
  | 'not-found'
  | 'conflict'
  | 'duplicate'
  | 'denied'
  | 'internal-error';

export interface ToolOutcome {
  readonly ok: boolean;
  readonly tool: string;
  readonly risk: ToolRisk;
  readonly result: unknown;
  readonly error: { code: ToolErrorCode; message: string } | null;
}

function failure(tool: string, code: ToolErrorCode, message: string): ToolOutcome {
  return { ok: false, tool, risk: toolSpec(tool)?.risk ?? 'read', result: null, error: { code, message } };
}

function success(tool: string, result: unknown): ToolOutcome {
  return { ok: true, tool, risk: toolSpec(tool)?.risk ?? 'read', result, error: null };
}

/* ---------------------- argument validators ------------------------- */

class ToolArgumentError extends Error {}

function argsObject(tool: string, args: unknown): Record<string, unknown> {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new ToolArgumentError('arguments must be a JSON object');
  }
  return args as Record<string, unknown>;
}

function str(args: Record<string, unknown>, field: string, max: number): string {
  const value = args[field];
  if (typeof value !== 'string') throw new ToolArgumentError(`${field}: expected a string`);
  if (value.length > max) throw new ToolArgumentError(`${field}: exceeds ${max} characters`);
  return value;
}

function optionalStr(args: Record<string, unknown>, field: string, max: number): string | undefined {
  if (args[field] === undefined || args[field] === null) return undefined;
  return str(args, field, max);
}

function id(args: Record<string, unknown>, field: string): EntityId {
  const value = args[field];
  if (typeof value !== 'string') throw new ToolArgumentError(`${field}: expected an id string`);
  return value as EntityId;
}

function optionalId(args: Record<string, unknown>, field: string): EntityId | undefined {
  if (args[field] === undefined || args[field] === null) return undefined;
  return id(args, field);
}

function int(args: Record<string, unknown>, field: string, min: number, max: number): number {
  const value = args[field];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ToolArgumentError(`${field}: expected an integer`);
  }
  if (value < min || value > max) {
    throw new ToolArgumentError(`${field}: out of range ${min}..${max}`);
  }
  return value;
}

function enumArg(args: Record<string, unknown>, field: string, values: readonly string[]): string {
  const value = args[field];
  if (typeof value !== 'string' || !values.includes(value)) {
    throw new ToolArgumentError(`${field}: expected one of ${values.join(', ')}`);
  }
  return value;
}

function boolArg(args: Record<string, unknown>, field: string): boolean {
  const value = args[field];
  if (typeof value !== 'boolean') throw new ToolArgumentError(`${field}: expected a boolean`);
  return value;
}

function optionalRevisionId(args: Record<string, unknown>, field: string): EntityId | null {
  // null = "never saved before" (the same semantics as the notes/save RPC).
  if (args[field] === null) return null;
  return id(args, field);
}

function idsArray(args: Record<string, unknown>, field: string, cap: number): EntityId[] {
  const value = args[field];
  if (!Array.isArray(value)) throw new ToolArgumentError(`${field}: expected an array of ids`);
  if (value.length > cap) throw new ToolArgumentError(`${field}: exceeds ${cap} entries`);
  return value.map((entry) => {
    if (typeof entry !== 'string') throw new ToolArgumentError(`${field}: expected id strings`);
    return entry as EntityId;
  });
}

function isoTimestamp(args: Record<string, unknown>, field: string): string {
  const value = str(args, field, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value)) {
    throw new ToolArgumentError(`${field}: expected an ISO-8601 UTC timestamp`);
  }
  if (Number.isNaN(new Date(value).getTime())) {
    throw new ToolArgumentError(`${field}: not a real instant`);
  }
  return value;
}

function zoneArg(args: Record<string, unknown>, field: string): string {
  const value = str(args, field, 64);
  if (!isValidTimeZone(value)) {
    throw new ToolArgumentError(`${field}: expected a valid IANA time zone`);
  }
  return value;
}

function yearlyRule(args: Record<string, unknown>, field: string): RecurrenceRule {
  const value = args[field];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ToolArgumentError(`${field}: expected a yearly object`);
  }
  const p = value as Record<string, unknown>;
  const rule: RecurrenceRule = {
    kind: 'yearly',
    on: { month: int(p, 'month', 1, 12), day: int(p, 'day', 1, 31) },
    at: { hour: int(p, 'hour', 0, 23), minute: int(p, 'minute', 0, 59) },
    finalYear:
      p['finalYear'] === undefined || p['finalYear'] === null
        ? null
        : int(p, 'finalYear', 1000, 9999),
    leapDayPolicy:
      p['leapDayPolicy'] === undefined || p['leapDayPolicy'] === null
        ? 'feb-28'
        : (enumArg(p, 'leapDayPolicy', ['feb-28', 'mar-1', 'skip']) as RecurrenceRule['leapDayPolicy']),
  };
  try {
    validateRecurrenceRule(rule);
  } catch (error) {
    throw new ToolArgumentError(error instanceof Error ? error.message : 'invalid yearly rule');
  }
  return rule;
}

/* ---------------------- bounded serializers ------------------------- */

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}… [clipped at ${max} characters]` : value;
}

async function noteSummary(note: Note): Promise<Record<string, unknown>> {
  const ctx = await repo();
  const [tags, categories] = await Promise.all([
    listNoteTags(ctx, note.id),
    listNoteCategories(ctx, note.id),
  ]);
  const reminders = await listNoteReminders(ctx, note.id);
  return {
    id: note.id,
    title: note.title,
    subtitle: note.subtitle,
    state: note.state,
    pinned: note.pinned,
    favorite: note.favorite,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    tags: tags.map((tag) => tag.name).slice(0, LIST_CAP),
    categories: categories.map((category) => category.name).slice(0, LIST_CAP),
    reminders: reminders.length,
    preview: clip(note.plainText, NOTE_PREVIEW_CHARS),
  };
}

function reminderSummary(reminder: Reminder): Record<string, unknown> {
  return {
    id: reminder.id,
    noteId: reminder.noteId,
    state: reminder.state,
    dueAt: reminder.dueAt,
    recurrence: reminder.recurrence,
    timeZone: reminder.timeZone,
    nextDueAt: reminder.nextDueAt,
    snoozedUntil: reminder.snoozedUntil,
    lastFiredAt: reminder.lastFiredAt,
  };
}

/* ----------------------------- handlers ----------------------------- */

type Handler = (args: Record<string, unknown>) => Promise<Record<string, unknown> | null>;

const handlers: ReadonlyMap<string, Handler> = new Map<string, Handler>([
  [
    'search_notes',
    async (args) => {
      const query = str(args, 'query', 500);
      const limit = args['limit'] === undefined ? 10 : int(args, 'limit', 1, SEARCH_LIMIT_MAX);
      const offset = args['offset'] === undefined ? 0 : int(args, 'offset', 0, 1000);
      const fuzzy = args['fuzzy'] === undefined ? false : boolArg(args, 'fuzzy');
      const engine = await searchEngine();
      const search = await engine.execute({ query, limit, offset, fuzzy });
      const ctx = await repo();
      const notes: Record<string, unknown>[] = [];
      for (const hit of search.hits.slice(0, limit)) {
        const note = await getNote(ctx, hit.noteId);
        if (note) notes.push(await noteSummary(note));
      }
      return { total: search.total, queryErrors: search.queryErrors, notes };
    },
  ],
  [
    'get_note',
    async (args) => {
      const ctx = await repo();
      const note = await getNote(ctx, id(args, 'noteId'));
      if (!note) throw new ToolNotFound('note not found');
      return await noteSummary(note);
    },
  ],
  [
    'create_note',
    async (args) => {
      const title = str(args, 'title', 500);
      const body = optionalStr(args, 'body', 10000) ?? '';
      // Model text becomes note CONTENT (data), never instructions.
      const note = await createNote(await repo(), {
        title,
        plainText: body,
        editorDoc: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: body.length > 0 ? [{ type: 'text', text: body }] : [] },
          ],
        },
      });
      return { id: note.id, createdAt: note.createdAt };
    },
  ],
  [
    'update_note',
    async (args) => {
      const noteId = id(args, 'noteId');
      const expectedRevisionId = optionalRevisionId(args, 'expectedRevisionId');
      const ctx = await repo();
      const current = await getNote(ctx, noteId);
      if (!current) throw new ToolNotFound('note not found');
      const title = optionalStr(args, 'title', 500) ?? current.title;
      const body = optionalStr(args, 'body', 10000);
      const plainText = body ?? current.plainText;
      const editorDoc =
        body !== undefined
          ? {
              type: 'doc',
              content: [
                { type: 'paragraph', content: body.length > 0 ? [{ type: 'text', text: body }] : [] },
              ],
            }
          : current.editorDoc;
      const note = await saveNote(ctx, {
        noteId,
        title,
        subtitle: current.subtitle,
        editorDoc,
        plainText,
        expectedRevisionId,
        changeSummary: 'AI edit',
      });
      return { id: note.id, revisionId: note.revisionId, updatedAt: note.updatedAt };
    },
  ],
  [
    'duplicate_note',
    async (args) => {
      const note = await duplicateNote(await repo(), id(args, 'noteId'));
      return { id: note.id };
    },
  ],
  [
    'archive_note',
    async (args) => {
      const note = await archiveNote(await repo(), id(args, 'noteId'));
      return { id: note.id, state: note.state };
    },
  ],
  [
    'restore_note',
    async (args) => {
      const note = await restoreNote(await repo(), id(args, 'noteId'));
      return { id: note.id, state: note.state };
    },
  ],
  [
    'trash_note',
    async (args) => {
      const note = await trashNote(await repo(), id(args, 'noteId'));
      return { id: note.id, state: note.state };
    },
  ],
  [
    'manage_tags',
    async (args) => {
      const ctx = await repo();
      const action = enumArg(args, 'action', [
        'list', 'create', 'rename', 'merge', 'delete', 'assign', 'remove',
      ]);
      switch (action) {
        case 'list': {
          const tags = await listTags(ctx);
          return { tags: tags.slice(0, LIST_CAP).map((tag) => ({ id: tag.id, name: tag.name })) };
        }
        case 'create':
          return { id: (await createTag(ctx, str(args, 'name', 100))).id };
        case 'rename':
          return { id: (await renameTag(ctx, id(args, 'tagId'), str(args, 'name', 100))).id };
        case 'merge': {
          await mergeTags(ctx, id(args, 'tagId'), id(args, 'mergeIntoTagId'));
          return { merged: true };
        }
        case 'delete':
          await deleteTag(ctx, id(args, 'tagId'));
          return null;
        case 'assign': {
          const noteId = id(args, 'noteId');
          const tagIds = idsArray(args, 'tagIds', LIST_CAP);
          const current = (await listNoteTags(ctx, noteId)).map((tag) => tag.id);
          await setNoteTags(ctx, noteId, [...new Set([...current, ...tagIds])]);
          return { assigned: tagIds.length };
        }
        case 'remove': {
          const noteId = id(args, 'noteId');
          const tagIds = new Set(idsArray(args, 'tagIds', LIST_CAP));
          const current = (await listNoteTags(ctx, noteId)).map((tag) => tag.id);
          await setNoteTags(ctx, noteId, current.filter((tagId) => !tagIds.has(tagId)));
          return { removed: true };
        }
        default:
          throw new ToolArgumentError(`unsupported action ${action}`);
      }
    },
  ],
  [
    'manage_categories',
    async (args) => {
      const ctx = await repo();
      const action = enumArg(args, 'action', ['list', 'create', 'rename', 'move', 'delete', 'assign']);
      switch (action) {
        case 'list': {
          const categories = await listCategories(ctx);
          return {
            categories: categories.slice(0, LIST_CAP).map((category) => ({
              id: category.id,
              name: category.name,
              parentId: category.parentId,
            })),
          };
        }
        case 'create': {
          const parent = optionalId(args, 'parentId');
          const created = await createCategory(ctx, str(args, 'name', 100), parent ?? null);
          return { id: created.id };
        }
        case 'rename': {
          const renamed = await renameCategory(ctx, id(args, 'categoryId'), str(args, 'name', 100));
          return { id: renamed.id };
        }
        case 'move':
          return {
            id: (await moveCategory(ctx, id(args, 'categoryId'), optionalId(args, 'parentId') ?? null)).id,
          };
        case 'delete':
          // Deleting orphans the notes' assignment; reassignment is an
          // explicit two-step choice the user can make in the dashboard.
          await deleteCategory(ctx, id(args, 'categoryId'), { reassignTo: null });
          return null;
        case 'assign': {
          const noteId = id(args, 'noteId');
          const categoryId = id(args, 'categoryId');
          const current = (await listNoteCategories(ctx, noteId)).map((category) => category.id);
          await setNoteCategories(ctx, noteId, [...new Set([...current, categoryId])]);
          return { assigned: true };
        }
        default:
          throw new ToolArgumentError(`unsupported action ${action}`);
      }
    },
  ],
  [
    'list_reminders',
    async (args) => {
      const ctx = await repo();
      const noteId = optionalId(args, 'noteId');
      const reminders = noteId !== undefined ? await listNoteReminders(ctx, noteId) : await listAllReminders(ctx);
      return { reminders: reminders.slice(0, LIST_CAP).map(reminderSummary) };
    },
  ],
  [
    'create_reminder',
    async (args) => {
      const noteId = id(args, 'noteId');
      const timeZone = zoneArg(args, 'timeZone');
      const dueAt = args['dueAt'] !== undefined ? isoTimestamp(args, 'dueAt') : null;
      const recurrence = args['yearly'] !== undefined ? yearlyRule(args, 'yearly') : null;
      if (dueAt === null && recurrence === null) {
        throw new ToolArgumentError('provide dueAt or yearly');
      }
      const reminder = await createReminder(await repo(), {
        noteId,
        dueAt: dueAt as Reminder['dueAt'],
        recurrence,
        timeZone: timeZone as Reminder['timeZone'],
        nextDueAt: computeNextDueAt(
          { dueAt: dueAt as Reminder['dueAt'], recurrence, timeZone: timeZone as Reminder['timeZone'] },
          nowUtc(),
        ),
      });
      return reminderSummary(reminder);
    },
  ],
  [
    'update_reminder',
    async (args) => {
      const reminderId = id(args, 'reminderId');
      const ctx = await repo();
      const current = await getReminder(ctx, reminderId);
      if (!current) throw new ToolNotFound('reminder not found');
      const patch: {
        dueAt?: Reminder['dueAt'];
        recurrence?: Reminder['recurrence'];
        timeZone?: Reminder['timeZone'];
        nextDueAt?: Reminder['nextDueAt'];
      } = {};
      if (args['dueAt'] !== undefined) patch.dueAt = isoTimestamp(args, 'dueAt') as Reminder['dueAt'];
      if (args['yearly'] !== undefined) patch.recurrence = yearlyRule(args, 'yearly');
      if (args['timeZone'] !== undefined) patch.timeZone = zoneArg(args, 'timeZone') as Reminder['timeZone'];
      const effective = {
        dueAt: patch.dueAt !== undefined ? patch.dueAt : current.dueAt,
        recurrence: patch.recurrence !== undefined ? patch.recurrence : current.recurrence,
        timeZone: patch.timeZone !== undefined ? patch.timeZone : current.timeZone,
      };
      if (effective.dueAt === null && effective.recurrence === null) {
        throw new ToolArgumentError('the reminder needs a dueAt or a yearly rule after the update');
      }
      patch.nextDueAt = computeNextDueAt(effective, nowUtc());
      const updated = await updateReminderRule(ctx, reminderId, patch);
      return reminderSummary(updated);
    },
  ],
  [
    'complete_reminder',
    async (args) => {
      const reminder = await completeReminder(await repo(), id(args, 'reminderId'));
      return reminderSummary(reminder);
    },
  ],
  [
    'search_snapshots',
    async (args) => {
      const ctx = await repo();
      const snapshots = await listNoteSnapshots(ctx, id(args, 'noteId'));
      return {
        snapshots: snapshots.slice(0, LIST_CAP).map((snapshot) => ({
          id: snapshot.id,
          title: snapshot.title,
          capturedAt: snapshot.capturedAt,
          status: snapshot.status,
          mhtml: snapshot.mhtml,
          png: snapshot.png,
          text: snapshot.text,
          mhtmlSize: snapshot.mhtmlSize,
          warnings: snapshot.warnings.length,
        })),
      };
    },
  ],
  [
    'get_snapshot_text',
    async (args) => {
      const ctx = await repo();
      const snapshot = await getSnapshot(ctx, id(args, 'snapshotId'));
      if (!snapshot) throw new ToolNotFound('snapshot not found');
      const max =
        args['maxLength'] === undefined ? SNAPSHOT_TEXT_DEFAULT : int(args, 'maxLength', 200, SNAPSHOT_TEXT_MAX);
      return {
        snapshotId: snapshot.id,
        status: snapshot.text,
        text: snapshot.text === 'saved' ? clip(snapshot.extractedText, max) : null,
      };
    },
  ],
  [
    'recapture_url',
    async (args) => {
      const ctx = await repo();
      const linkId = id(args, 'linkId');
      const link = await getLink(ctx, linkId);
      if (!link) throw new ToolNotFound('link not found');
      const queued = await getCaptureQueue().retry(linkId);
      return { queued, captureState: queued ? 'queued' : link.captureState };
    },
  ],
  [
    'get_diagnostics',
    async () => {
      const ctx = await repo();
      const notes = await ctx.getAll<Note>(Store.Notes).catch(() => [] as Note[]);
      const logs = await listLogs(ctx, 20);
      const logCount = await countLogs(ctx).catch(() => 0);
      const errors = logs
        .filter((entry) => entry.level === 'error' || entry.level === 'warn')
        .slice(0, 10)
        .map((entry) => ({
          level: entry.level,
          component: entry.component,
          at: entry.at,
          message: clip(entry.message, 200),
        }));
      return {
        noteCount: Array.isArray(notes) ? notes.length : 0,
        logCount,
        recentErrors: errors,
        aiNote: 'Bounded diagnostic summary; full logs are in the diagnostics page.',
      };
    },
  ],
]);

class ToolNotFound extends Error {}

const NOT_FOUND_ERRORS = [
  NoteNotFoundError,
  TagNotFoundError,
  CategoryNotFoundError,
  ReminderNotFoundError,
];

/**
 * Execute one model-proposed tool call. NEVER executes anything but the
 * validated operation itself; all failures are structured outcomes.
 */
export async function dispatchToolCall(name: string, argsJson: string): Promise<ToolOutcome> {
  if (!isToolName(name)) {
    return failure(name, 'unknown-tool', `"${name.slice(0, 80)}" is not a known tool`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson);
  } catch {
    return failure(name, 'malformed-arguments', 'arguments are not valid JSON');
  }
  let args: Record<string, unknown>;
  try {
    args = argsObject(name, parsed);
  } catch (error) {
    return failure(name, 'malformed-arguments', (error as Error).message);
  }
  const handler = handlers.get(name);
  if (!handler) {
    return failure(name, 'unknown-tool', `no handler for "${name}"`);
  }
  try {
    const result = await handler(args);
    return success(name, result);
  } catch (error) {
    if (error instanceof ToolArgumentError) {
      return failure(name, 'invalid-arguments', error.message);
    }
    if (error instanceof ToolNotFound) {
      return failure(name, 'not-found', error.message);
    }
    for (const kind of NOT_FOUND_ERRORS) {
      if (error instanceof kind) return failure(name, 'not-found', error.message);
    }
    if (error instanceof DuplicateTagError) {
      return failure(name, 'duplicate', error.message);
    }
    if (error instanceof CategoryCycleError) {
      return failure(name, 'invalid-arguments', error.message);
    }
    if (error instanceof NoteConflictError) {
      return failure(name, 'conflict', error.message);
    }
    return failure(name, 'internal-error', error instanceof Error ? error.message : String(error));
  }
}

export { TOOL_SPECS };
