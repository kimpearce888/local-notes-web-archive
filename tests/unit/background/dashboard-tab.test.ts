import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addTab, installChromeMock, type InstalledMock } from './chrome-mock';
import { openOrFocusDashboard, dashboardUrl } from '../../../src/background/dashboard-tab';

/** Structural accessors onto the installed mock (loosely typed on purpose). */
type Fn = (...args: never[]) => unknown;
function chromeApi(): { tabs: Record<'create' | 'update' | 'sendMessage' | 'query', Fn>; windows: { update: Fn } } {
  return (globalThis as unknown as { chrome: { tabs: Record<'create' | 'update' | 'sendMessage' | 'query', Fn>; windows: { update: Fn } } }).chrome;
}

describe('dashboard tab management (PRD §4.1)', () => {
  let installed: InstalledMock;

  beforeEach(() => {
    installed = installChromeMock();
  });

  afterEach(() => {
    installed.uninstall();
  });

  it('exposes the dashboard URL from the runtime origin', () => {
    expect(dashboardUrl()).toBe('chrome-extension://test-extension-id/dashboard.html');
  });

  it('creates a new active tab when no dashboard is open', async () => {
    const result = await openOrFocusDashboard();
    expect(result.created).toBe(true);
    expect(result.tabId).not.toBeNull();
    expect(chromeApi().tabs.create).toHaveBeenCalledWith({ url: dashboardUrl(), active: true });
  });

  it('focuses an existing dashboard tab instead of duplicating it', async () => {
    const tabId = addTab(installed, dashboardUrl());
    addTab(installed, 'https://example.org/other'); // noise: unrelated tab
    const chromeMock = chromeApi();
    const result = await openOrFocusDashboard();
    expect(result.created).toBe(false);
    expect(result.tabId).toBe(tabId);
    expect(chromeMock.tabs.create).not.toHaveBeenCalled();
    expect(chromeMock.tabs.update).toHaveBeenCalledWith(tabId, { active: true });
    expect(chromeMock.windows.update).toHaveBeenCalledWith(1, { focused: true });
  });

  it('opens a fresh tab with the new-note intent when none exists', async () => {
    const result = await openOrFocusDashboard({ newNote: true });
    expect(result.created).toBe(true);
    expect(result.intentDelivered).toBe(true);
    expect(chromeApi().tabs.create).toHaveBeenCalledWith({ url: `${dashboardUrl()}?new=1`, active: true });
  });

  it('delivers the new-note intent by message when the dashboard has a listener', async () => {
    const tabId = addTab(installed, dashboardUrl());
    installed.tabsWithListeners.add(tabId);
    const chromeMock = chromeApi();
    const result = await openOrFocusDashboard({ newNote: true });
    expect(result.created).toBe(false);
    expect(result.intentDelivered).toBe(true);
    expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(tabId, {
      kind: 'ui-intent',
      intent: 'new-note',
    });
    // No navigation: unsaved edits are never discarded (PRD §4.3).
    const updateFn = chromeMock.tabs.update as unknown as { mock: { calls: Array<[number, Record<string, unknown>]> } };
    expect(updateFn.mock.calls.every(([, info]) => info['url'] === undefined)).toBe(true);
  });

  it('falls back to the ?new=1 URL while the dashboard tab is still loading', async () => {
    const tabId = addTab(installed, dashboardUrl());
    // No listener registered → tab still loading.
    const chromeMock = chromeApi();
    const result = await openOrFocusDashboard({ newNote: true });
    expect(result.intentDelivered).toBe(true);
    expect(chromeMock.tabs.update).toHaveBeenCalledWith(tabId, {
      url: `${dashboardUrl()}?new=1`,
    });
  });
});
