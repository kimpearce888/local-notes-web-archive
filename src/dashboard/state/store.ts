/**
 * Dashboard store (T-015): a single immutable-ish state tree with a
 * subscription model. Components subscribe and re-render on change; the
 * controller is the only writer. State transitions are shallow-merged and
 * listeners receive (next, previous) so they can diff cheaply.
 */

import type { AppSettings, EntityId, Filters, Note, SortDirection, SortField } from '../../core/types';
import type { RpcErrorCode } from '../../background/protocol';

export type LoadStatus = 'loading' | 'ready' | 'error';

export type SaveFlowState = 'idle' | 'saving' | 'saved' | 'save-failed';

export interface DashboardState {
  /** Data load status for the results region. */
  readonly status: LoadStatus;
  /** Coded load failure (null unless status === 'error'). */
  readonly loadError: { code: RpcErrorCode; message: string } | null;
  /** Current result page (search-driven). */
  readonly notes: readonly Note[];
  /** Total matching notes before pagination. */
  readonly total: number;
  readonly counts: { active: number; archived: number; trashed: number };
  /** Raw search text (FR-SEARCH-04 syntax is parsed by the engine). */
  readonly query: string;
  readonly filters: Filters;
  readonly sort: { field: SortField; direction: SortDirection };
  readonly viewMode: 'grid' | 'list';
  /** Multi-selection for bulk actions (T-016 uses it). */
  readonly selection: ReadonlySet<EntityId>;
  /** Save flow indicator state (PRD §4.3). */
  readonly saveState: SaveFlowState;
  /** Settings snapshot once loaded (null until then). */
  readonly settings: AppSettings | null;
}

export const INITIAL_DASHBOARD_STATE: DashboardState = {
  status: 'loading',
  loadError: null,
  notes: [],
  total: 0,
  counts: { active: 0, archived: 0, trashed: 0 },
  query: '',
  filters: {},
  sort: { field: 'modified', direction: 'desc' },
  viewMode: 'grid',
  selection: new Set<EntityId>(),
  saveState: 'idle',
  settings: null,
};

export type StateListener = (state: DashboardState, previous: DashboardState) => void;

export interface DashboardStore {
  getState(): DashboardState;
  /** Shallow-merges a patch; notifies only when a value actually changes. */
  setState(patch: Partial<DashboardState>): void;
  subscribe(listener: StateListener): () => void;
}

export function createDashboardStore(initial: DashboardState = INITIAL_DASHBOARD_STATE): DashboardStore {
  let state: DashboardState = initial;
  const listeners = new Set<StateListener>();

  return {
    getState: () => state,
    setState(patch: Partial<DashboardState>): void {
      const next: DashboardState = { ...state, ...patch };
      let changed = false;
      for (const key of Object.keys(patch) as Array<keyof DashboardState>) {
        if (state[key] !== next[key]) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      const previous = state;
      state = next;
      for (const listener of [...listeners]) listener(state, previous);
    },
    subscribe(listener: StateListener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
