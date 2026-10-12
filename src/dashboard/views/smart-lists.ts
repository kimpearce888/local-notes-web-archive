/**
 * Smart lists (PRD §4.2): pinned, favorites, recently edited and overdue
 * selections plus the state lists (all/archived/trash). Each definition is
 * pure data — filters + sort applied by the controller's requery.
 */

import type { Filters, SortField } from '../../core/types';

export type SmartListId =
  | 'all'
  | 'pinned'
  | 'favorites'
  | 'recent'
  | 'overdue'
  | 'archived'
  | 'trashed';

export interface SmartListDefinition {
  readonly id: SmartListId;
  readonly label: string;
  readonly filters: Filters;
  readonly sort: { field: SortField; direction: 'asc' | 'desc' };
}

export const SMART_LISTS: readonly SmartListDefinition[] = [
  {
    id: 'all',
    label: 'All notes',
    filters: {},
    sort: { field: 'modified', direction: 'desc' },
  },
  {
    id: 'pinned',
    label: 'Pinned',
    filters: { pinned: true, state: 'active' },
    sort: { field: 'modified', direction: 'desc' },
  },
  {
    id: 'favorites',
    label: 'Favorites',
    filters: { favorite: true, state: 'active' },
    sort: { field: 'modified', direction: 'desc' },
  },
  {
    id: 'recent',
    label: 'Recently edited',
    filters: { state: 'active' },
    sort: { field: 'modified', direction: 'desc' },
  },
  {
    id: 'overdue',
    label: 'Overdue reminders',
    filters: { reminder: 'overdue', state: 'active' },
    sort: { field: 'reminder', direction: 'asc' },
  },
  {
    id: 'archived',
    label: 'Archived',
    filters: { state: 'archived' },
    sort: { field: 'modified', direction: 'desc' },
  },
  {
    id: 'trashed',
    label: 'Trash',
    filters: { state: 'trashed' },
    sort: { field: 'modified', direction: 'desc' },
  },
];

export function smartListById(id: SmartListId): SmartListDefinition {
  const found = SMART_LISTS.find((list) => list.id === id);
  if (!found) throw new Error(`unknown smart list "${id}"`);
  return found;
}

/**
 * Effective filters: the smart list's structural filters combined with the
 * user's text query (parsed by the search engine) — smart-list filters are
 * the base, never dropped by requery.
 */
export function effectiveFilters(list: SmartListDefinition, userFilters: Filters): Filters {
  return { ...userFilters, ...list.filters };
}
