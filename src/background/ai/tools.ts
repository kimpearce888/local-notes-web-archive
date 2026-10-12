/**
 * AI tool contract (FR-AI-05/06): the validated application tools the model
 * may PROPOSE. The application validates and executes every proposal — the
 * model never executes anything directly.
 *
 * Fail-closed rules (FR-AI-06):
 * - Unknown tool names, malformed JSON arguments, schema violations,
 *   out-of-bounds values and invalid IDs return structured errors — never
 *   best-effort execution.
 * - Every output is bounded (text lengths, page sizes, list lengths) so a
 *   runaway model cannot flood the conversation.
 * - Strings from the model are DATA: they are stored/searched/displayed,
 *   never interpreted as instructions to this application (FR-AI-08).
 */

import type { ToolDefinition } from './client';

/** What a tool does — the permission matrix input (FR-AI-07, T-031). */
export type ToolRisk = 'read' | 'write' | 'destructive';

export interface ToolSpec {
  readonly name: string;
  readonly risk: ToolRisk;
  readonly description: string;
  /** Strict JSON Schema for the model (unknown args fail closed). */
  readonly parameters: Record<string, unknown>;
}

export const TOOL_SPECS: readonly ToolSpec[] = [
  {
    name: 'search_notes',
    risk: 'read',
    description:
      'Search the local note collection with the documented query syntax (phrases in quotes, -exclusions, tag:, category:, is:pinned, is:archived, has:reminder, before:, after:). Returns bounded note summaries.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: 500, description: 'Query syntax string' },
        limit: { type: 'integer', minimum: 1, maximum: 20 },
        offset: { type: 'integer', minimum: 0, maximum: 1000 },
        fuzzy: { type: 'boolean' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_note',
    risk: 'read',
    description:
      'Read one note: title, subtitle, bounded plain-text preview, state, timestamps, tag/category names, link and reminder summaries. Does not return the full document.',
    parameters: {
      type: 'object',
      properties: { noteId: { type: 'string', format: 'uuid' } },
      required: ['noteId'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_note',
    risk: 'write',
    description: 'Create a new note with a title and plain-text body.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 500 },
        body: { type: 'string', maxLength: 10000 },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_note',
    risk: 'write',
    description:
      'Update a note title and/or plain-text body. Requires the current revision id (read get_note first); conflicts fail truthfully.',
    parameters: {
      type: 'object',
      properties: {
        noteId: { type: 'string', format: 'uuid' },
        expectedRevisionId: { type: 'string', format: 'uuid' },
        title: { type: 'string', maxLength: 500 },
        body: { type: 'string', maxLength: 10000 },
      },
      required: ['noteId', 'expectedRevisionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'duplicate_note',
    risk: 'write',
    description: 'Duplicate a note with its content.',
    parameters: {
      type: 'object',
      properties: { noteId: { type: 'string', format: 'uuid' } },
      required: ['noteId'],
      additionalProperties: false,
    },
  },
  {
    name: 'archive_note',
    risk: 'write',
    description: 'Archive a note (recoverable).',
    parameters: {
      type: 'object',
      properties: { noteId: { type: 'string', format: 'uuid' } },
      required: ['noteId'],
      additionalProperties: false,
    },
  },
  {
    name: 'restore_note',
    risk: 'write',
    description: 'Restore an archived or trashed note to active.',
    parameters: {
      type: 'object',
      properties: { noteId: { type: 'string', format: 'uuid' } },
      required: ['noteId'],
      additionalProperties: false,
    },
  },
  {
    name: 'trash_note',
    risk: 'destructive',
    description: 'Move a note to trash (recoverable until permanently deleted).',
    parameters: {
      type: 'object',
      properties: { noteId: { type: 'string', format: 'uuid' } },
      required: ['noteId'],
      additionalProperties: false,
    },
  },
  {
    name: 'manage_tags',
    risk: 'write',
    description:
      'Tag operations: list, create, rename, merge, delete, assign or remove on a note.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'create', 'rename', 'merge', 'delete', 'assign', 'remove'] },
        tagId: { type: 'string', format: 'uuid' },
        name: { type: 'string', maxLength: 100 },
        mergeIntoTagId: { type: 'string', format: 'uuid' },
        noteId: { type: 'string', format: 'uuid' },
        tagIds: { type: 'array', items: { type: 'string', format: 'uuid' }, maxItems: 50 },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'manage_categories',
    risk: 'write',
    description: 'Category operations: list, create, rename, move, delete, assign to a note.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'create', 'rename', 'move', 'delete', 'assign'] },
        categoryId: { type: 'string', format: 'uuid' },
        parentId: { type: 'string', format: 'uuid' },
        name: { type: 'string', maxLength: 100 },
        noteId: { type: 'string', format: 'uuid' },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_reminders',
    risk: 'read',
    description: 'List reminders for one note, or all reminders when noteId is omitted.',
    parameters: {
      type: 'object',
      properties: { noteId: { type: 'string', format: 'uuid' } },
      additionalProperties: false,
    },
  },
  {
    name: 'create_reminder',
    risk: 'write',
    description:
      'Create a reminder: one-time (ISO dueAt) or yearly (month/day + local time + optional inclusive finalYear + Feb-29 policy). The app computes the next occurrence.',
    parameters: {
      type: 'object',
      properties: {
        noteId: { type: 'string', format: 'uuid' },
        dueAt: { type: 'string', format: 'date-time' },
        yearly: {
          type: 'object',
          properties: {
            month: { type: 'integer', minimum: 1, maximum: 12 },
            day: { type: 'integer', minimum: 1, maximum: 31 },
            hour: { type: 'integer', minimum: 0, maximum: 23 },
            minute: { type: 'integer', minimum: 0, maximum: 59 },
            finalYear: { type: 'integer', minimum: 1000, maximum: 9999 },
            leapDayPolicy: { type: 'string', enum: ['feb-28', 'mar-1', 'skip'] },
          },
          required: ['month', 'day', 'hour', 'minute'],
          additionalProperties: false,
        },
        timeZone: { type: 'string', description: 'IANA zone', maxLength: 64 },
      },
      required: ['noteId', 'timeZone'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_reminder',
    risk: 'write',
    description: 'Update a reminder rule (dueAt, yearly fields or timezone).',
    parameters: {
      type: 'object',
      properties: {
        reminderId: { type: 'string', format: 'uuid' },
        dueAt: { type: 'string', format: 'date-time' },
        yearly: {
          type: 'object',
          properties: {
            month: { type: 'integer', minimum: 1, maximum: 12 },
            day: { type: 'integer', minimum: 1, maximum: 31 },
            hour: { type: 'integer', minimum: 0, maximum: 23 },
            minute: { type: 'integer', minimum: 0, maximum: 59 },
            finalYear: { type: 'integer', minimum: 1000, maximum: 9999 },
            leapDayPolicy: { type: 'string', enum: ['feb-28', 'mar-1', 'skip'] },
          },
          required: ['month', 'day', 'hour', 'minute'],
          additionalProperties: false,
        },
        timeZone: { type: 'string', maxLength: 64 },
      },
      required: ['reminderId'],
      additionalProperties: false,
    },
  },
  {
    name: 'complete_reminder',
    risk: 'write',
    description: 'Mark a reminder completed.',
    parameters: {
      type: 'object',
      properties: { reminderId: { type: 'string', format: 'uuid' } },
      required: ['reminderId'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_snapshots',
    risk: 'read',
    description: 'List capture snapshots for a note with per-artifact states and warnings.',
    parameters: {
      type: 'object',
      properties: { noteId: { type: 'string', format: 'uuid' } },
      required: ['noteId'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_snapshot_text',
    risk: 'read',
    description: 'Read the bounded extracted text of one snapshot.',
    parameters: {
      type: 'object',
      properties: {
        snapshotId: { type: 'string', format: 'uuid' },
        maxLength: { type: 'integer', minimum: 200, maximum: 8000 },
      },
      required: ['snapshotId'],
      additionalProperties: false,
    },
  },
  {
    name: 'recapture_url',
    risk: 'write',
    description: 'Queue a fresh capture of a note link (the capture pipeline must authorize the URL).',
    parameters: {
      type: 'object',
      properties: { linkId: { type: 'string', format: 'uuid' } },
      required: ['linkId'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_diagnostics',
    risk: 'read',
    description: 'Bounded health snapshot: store counts, storage estimate, recent error log summaries.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
];

/** Tool definitions formatted for the chat-completions tools parameter. */
export function toolDefinitionsForModel(tools: readonly ToolSpec[] = TOOL_SPECS): ToolDefinition[] {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

const NAMES = new Map(TOOL_SPECS.map((tool) => [tool.name, tool]));

export function toolSpec(name: string): ToolSpec | undefined {
  return NAMES.get(name);
}

export function isToolName(name: string): boolean {
  return NAMES.has(name);
}
