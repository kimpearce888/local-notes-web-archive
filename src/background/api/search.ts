/**
 * Search API (FR-SEARCH-01..06): query syntax, structural filters, sort
 * orders and pagination, plus explicit index rebuild for diagnostics.
 */

import type { MessageRouter } from '../router';
import { searchEngine } from '../db';
import type { Filters, NoteState, SortDirection, SortField } from '../../core/types';
import { PayloadValidationError } from '../protocol';
import {
  asEnum,
  asIdArray,
  asObject,
  asOptionalBoolean,
  asOptionalEnum,
  asOptionalNumber,
  asOptionalString,
  asString,
} from './validate';

const SORT_FIELDS: readonly SortField[] = [
  'relevance',
  'title',
  'created',
  'modified',
  'reminder',
  'capture',
];
const SORT_DIRECTIONS: readonly SortDirection[] = ['asc', 'desc'];
const NOTE_STATES: readonly NoteState[] = ['active', 'archived', 'trashed'];
const REMINDER_FILTERS = ['any', 'due', 'overdue', 'completed'] as const;
const SNAPSHOT_FILTERS = ['any', 'present', 'missing', 'failed'] as const;

function parseFilters(value: unknown): Filters {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new PayloadValidationError('filters: expected an object');
  }
  const p = value as Record<string, unknown>;
  const dateField = (name: string): string | undefined =>
    asOptionalString(p[name], name, { maxLength: 40 });
  const filters: Filters = {};
  const createdAfter = dateField('createdAfter');
  if (createdAfter !== undefined) filters.createdAfter = createdAfter;
  const createdBefore = dateField('createdBefore');
  if (createdBefore !== undefined) filters.createdBefore = createdBefore;
  const modifiedAfter = dateField('modifiedAfter');
  if (modifiedAfter !== undefined) filters.modifiedAfter = modifiedAfter;
  const modifiedBefore = dateField('modifiedBefore');
  if (modifiedBefore !== undefined) filters.modifiedBefore = modifiedBefore;
  const capturedAfter = dateField('capturedAfter');
  if (capturedAfter !== undefined) filters.capturedAfter = capturedAfter;
  const capturedBefore = dateField('capturedBefore');
  if (capturedBefore !== undefined) filters.capturedBefore = capturedBefore;
  if (p['tagIds'] !== undefined) filters.tagIds = asIdArray(p['tagIds'], 'filters.tagIds');
  if (p['categoryIds'] !== undefined) {
    filters.categoryIds = asIdArray(p['categoryIds'], 'filters.categoryIds');
  }
  const pinned = asOptionalBoolean(p['pinned'], 'filters.pinned');
  if (pinned !== undefined) filters.pinned = pinned;
  const favorite = asOptionalBoolean(p['favorite'], 'filters.favorite');
  if (favorite !== undefined) filters.favorite = favorite;
  const state = asOptionalEnum(p['state'], 'filters.state', NOTE_STATES);
  if (state !== undefined) filters.state = state;
  const reminder = asOptionalEnum(p['reminder'], 'filters.reminder', REMINDER_FILTERS);
  if (reminder !== undefined) filters.reminder = reminder;
  const snapshot = asOptionalEnum(p['snapshot'], 'filters.snapshot', SNAPSHOT_FILTERS);
  if (snapshot !== undefined) filters.snapshot = snapshot;
  const hasLink = asOptionalBoolean(p['hasLink'], 'filters.hasLink');
  if (hasLink !== undefined) filters.hasLink = hasLink;
  const hasAttachment = asOptionalBoolean(p['hasAttachment'], 'filters.hasAttachment');
  if (hasAttachment !== undefined) filters.hasAttachment = hasAttachment;
  const sourceDomain = asOptionalString(p['sourceDomain'], 'filters.sourceDomain', { maxLength: 253 });
  if (sourceDomain !== undefined) filters.sourceDomain = sourceDomain;
  return filters;
}

export function registerSearchApi(router: MessageRouter): void {
  router.register('search/query', async (payload) => {
    const p = asObject(payload, 'search/query');
    const sortValue = p['sort'];
    let sort: { field: SortField; direction: SortDirection } | undefined;
    if (sortValue !== undefined && sortValue !== null) {
      if (typeof sortValue !== 'object' || Array.isArray(sortValue)) {
        throw new PayloadValidationError('sort: expected an object');
      }
      const s = sortValue as Record<string, unknown>;
      sort = {
        field: asEnum(s['field'], 'sort.field', SORT_FIELDS),
        direction: asEnum(s['direction'], 'sort.direction', SORT_DIRECTIONS),
      };
    }
    const result = await (await searchEngine()).execute({
      query: asString(p['query'], 'query', { maxLength: 2000, allowEmpty: true }),
      filters: parseFilters(p['filters']),
      sort,
      limit: asOptionalNumber(p['limit'], 'limit', { min: 1, max: 500, integer: true }),
      offset: asOptionalNumber(p['offset'], 'offset', { min: 0, max: 1_000_000, integer: true }),
      fuzzy: asOptionalBoolean(p['fuzzy'], 'fuzzy'),
    });
    return result;
  });

  router.register('search/rebuild', async () => {
    const engine = await searchEngine();
    const indexed = await engine.rebuild();
    return { indexed };
  });

  router.register('search/status', async () => {
    const engine = await searchEngine();
    return { documentCount: engine.documentCount };
  });
}
