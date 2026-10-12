import { describe, expect, it, vi } from 'vitest';
import {
  createDashboardStore,
  INITIAL_DASHBOARD_STATE,
} from '../../../src/dashboard/state/store';

describe('dashboard store', () => {
  it('starts from the initial state', () => {
    const store = createDashboardStore();
    expect(store.getState()).toBe(INITIAL_DASHBOARD_STATE);
    expect(store.getState().status).toBe('loading');
    expect(store.getState().saveState).toBe('idle');
    expect(store.getState().selection.size).toBe(0);
  });

  it('shallow-merges patches and notifies with (next, previous)', () => {
    const store = createDashboardStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.setState({ status: 'ready' });
    expect(store.getState().status).toBe('ready');
    expect(listener).toHaveBeenCalledTimes(1);
    const [next, previous] = listener.mock.calls[0] as [
      { status: string },
      { status: string },
    ];
    expect(next.status).toBe('ready');
    expect(previous.status).toBe('loading');
    expect(previous).not.toBe(next); // previous snapshot stays untouched
  });

  it('does not notify when nothing changes', () => {
    const store = createDashboardStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.setState({ status: 'loading' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies only remaining subscribers after unsubscribe', () => {
    const store = createDashboardStore();
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = store.subscribe(first);
    store.subscribe(second);
    offFirst();
    store.setState({ query: 'x' });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('keeps unrelated state untouched by a patch', () => {
    const store = createDashboardStore();
    store.setState({ query: 'needle', sort: { field: 'title', direction: 'asc' } });
    expect(store.getState().filters).toEqual({});
    expect(store.getState().viewMode).toBe('grid');
    expect(store.getState().sort).toEqual({ field: 'title', direction: 'asc' });
  });
});
