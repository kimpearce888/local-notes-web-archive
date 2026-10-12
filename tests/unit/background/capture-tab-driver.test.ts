import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock, type InstalledMock } from './chrome-mock';
import { closeWorkerResources } from '../../../src/background/db';
import {
  closeDrivenTab,
  openInactiveTab,
  TabDriveError,
} from '../../../src/background/capture/tab-driver';
import { DB_NAME } from '../../../src/core/version';

/**
 * T-022 temporary capture-tab driver (FR-CAP-03/04): inactive tab creation,
 * load waiting with the navigation budget, truthful failures (timeout,
 * closed tab) and guaranteed, idempotent cleanup.
 */

let installed: InstalledMock;

beforeEach(() => {
  installed = installChromeMock();
});

afterEach(async () => {
  await closeWorkerResources();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
  installed.uninstall();
});

/** Simulate the tab finishing its load (optionally after a redirect). */
function completeTab(tabId: number, overrides: { url?: string; title?: string } = {}): void {
  const tab = installed.tabs.get(tabId);
  if (!tab) throw new Error(`no tab ${tabId}`);
  if (overrides.url !== undefined) tab.url = overrides.url;
  if (overrides.title !== undefined) tab.title = overrides.title;
  tab.status = 'complete';
  for (const listener of installed.tabUpdated) listener(tabId, { status: 'complete', url: tab.url }, tab);
}

/** Complete any loading tab shortly after it appears. */
function autoCompleteLoads(overrides: { url?: string; title?: string } = {}): () => void {
  const timer = setInterval(() => {
    for (const tab of installed.tabs.values()) {
      if (tab.status === 'loading') completeTab(tab.id, overrides);
    }
  }, 10);
  return () => clearInterval(timer);
}

describe('openInactiveTab', () => {
  it('opens an inactive tab and waits for the load to complete', async () => {
    const stop = autoCompleteLoads({ title: 'Example Article' });
    try {
      const tab = await openInactiveTab('https://example.com/article', 2000);
      expect(tab.finalUrl).toBe('https://example.com/article');
      expect(tab.title).toBe('Example Article');
      const created = [...installed.tabs.values()][0]!;
      expect(created.active).toBe(false); // never activated (FR-CAP-10)
      // The driver itself does not close the tab — the queue owns cleanup so
      // the artifact steps can still use it.
      expect(installed.tabs.has(tab.tabId)).toBe(true);
    } finally {
      stop();
    }
  });

  it('reports the post-redirect URL so the queue can validate the origin', async () => {
    const stop = autoCompleteLoads({ url: 'https://example.com/moved' });
    try {
      const tab = await openInactiveTab('https://example.com/article', 2000);
      expect(tab.finalUrl).toBe('https://example.com/moved');
    } finally {
      stop();
    }
  });

  it('fails with a timeout when the page never finishes loading, and removes the tab', async () => {
    try {
      await openInactiveTab('https://example.com/slow', 120);
      expect.unreachable('expected a timeout');
    } catch (error) {
      expect(error).toBeInstanceOf(TabDriveError);
      expect(error).toMatchObject({ kind: 'timeout' });
    }
    expect(installed.tabs.size).toBe(0); // no leaked temporary tab
  });

  it('fails promptly when the tab is closed mid-load, and stays idempotent', async () => {
    const closing = setTimeout(() => {
      for (const tab of installed.tabs.values()) void chrome.tabs.remove(tab.id);
    }, 30);
    try {
      await openInactiveTab('https://example.com/doomed', 2000);
      expect.unreachable('expected a tab-closed failure');
    } catch (error) {
      expect(error).toBeInstanceOf(TabDriveError);
      expect(error).toMatchObject({ kind: 'tab-closed' });
    } finally {
      clearTimeout(closing);
    }
    expect(installed.tabs.size).toBe(0);
  });
});

describe('closeDrivenTab', () => {
  it('closes the tab and is idempotent', async () => {
    const stop = autoCompleteLoads();
    try {
      const tab = await openInactiveTab('https://example.com/a', 2000);
      await closeDrivenTab(tab.tabId);
      expect(installed.tabs.has(tab.tabId)).toBe(false);
      // Second close must not throw (already gone).
      await expect(closeDrivenTab(tab.tabId)).resolves.toBeUndefined();
    } finally {
      stop();
    }
  });
});

describe('chrome surface discipline', () => {
  it('the driver touches only tabs APIs (no permissions, storage or pageCapture)', async () => {
    const stop = autoCompleteLoads();
    try {
      const tab = await openInactiveTab('https://example.com/b', 2000);
      await closeDrivenTab(tab.tabId);
      expect(chrome.tabs.create).toHaveBeenCalled();
      expect(chrome.tabs.remove).toHaveBeenCalled();
      expect(chrome.permissions.contains).not.toHaveBeenCalled();
      expect(installed.storage.size).toBe(0);
    } finally {
      stop();
    }
  });
});
