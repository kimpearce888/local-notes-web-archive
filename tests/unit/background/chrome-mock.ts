/**
 * Chrome API mock for service-worker unit tests. Installs a minimal,
 * in-memory implementation of the APIs the background modules touch:
 * runtime (id/getURL/listeners), action, commands, tabs, windows,
 * pageCapture, contextMenus, alarms, storage.local and permissions. Tests
 * control tab listeners, MHTML responses, storage contents and permission
 * grants directly.
 */

import { vi, type Mock } from 'vitest';

export interface MockTab {
  id: number;
  url: string;
  active: boolean;
  windowId: number;
  title: string;
  status: 'loading' | 'complete';
}

export interface InstalledMock {
  listeners: {
    installed: Array<(details: chrome.runtime.InstalledDetails) => void>;
    startup: Array<() => void>;
    actionClicked: Array<(tab: chrome.tabs.Tab) => void>;
    command: Array<(command: string) => void>;
    menuClicked: Array<(info: chrome.contextMenus.OnClickData) => void>;
    message: Array<
      (
        message: unknown,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response: unknown) => void,
      ) => boolean | void
    >;
  };
  tabs: Map<number, MockTab>;
  alarms: Map<string, { name: string; scheduledTime: number }>;
  storage: Map<string, unknown>;
  /** Tab ids that simulate a loaded dashboard (tabs.sendMessage succeeds). */
  tabsWithListeners: Set<number>;
  createdMenus: Array<{ id: string | number; title: string; contexts: string[]; documentUrlPatterns?: string[] }>;
  removeAllMenusCalls: number;
  /** chrome.tabs.onUpdated / onRemoved listeners (capture tab driver). */
  tabUpdated: Array<(tabId: number, changeInfo: { status?: string; url?: string }, tab: MockTab) => void>;
  tabRemoved: Array<(tabId: number) => void>;
  /** chrome.pageCapture.saveAsMHTML mock (T-023). */
  pageCapture: {
    saveAsMHTML: Mock;
    /** Per-tab archive override: a Blob to return or an Error to throw. */
    mhtmlForTab: Map<number, Blob | Error>;
  };
  /** chrome.scripting.executeScript mock (T-024 text extraction). */
  scripting: {
    executeScript: Mock;
    /** Injected functions run against this document (JSDOM fixture in node-env tests). */
    setPageDocument(doc: Document | null): void;
    /** Log of injections: one { tabId } entry per executeScript call. */
    calls: Array<{ tabId: number }>;
  };
  /** chrome.permissions state: granted origin patterns + gesture model. */
  permissions: {
    /** Granted origin match patterns (e.g. "https://example.com/*"). */
    grantedPatterns: Set<string>;
    /** Simulates the dashboard user-gesture window permissions.request needs. */
    gestureActive: boolean;
    /** Forces the next request() to resolve false (user clicked Block). */
    forceNextDecline: boolean;
    /** Origins arrays passed to every request() call. */
    requestCalls: string[][];
  };
  uninstall(): void;
}

export function installChromeMock(): InstalledMock {
  const tabs = new Map<number, MockTab>();
  let nextTabId = 1;
  const alarms = new Map<string, { name: string; scheduledTime: number }>();
  const storage = new Map<string, unknown>();
  const tabsWithListeners = new Set<number>();
  const createdMenus: InstalledMock['createdMenus'] = [];
  let removeAllMenusCalls = 0;
  const tabUpdated: InstalledMock['tabUpdated'] = [];
  const tabRemoved: InstalledMock['tabRemoved'] = [];
  const mhtmlForTab = new Map<number, Blob | Error>();
  const DEFAULT_MHTML = new Blob(
    ['MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="----mock-mhtml"\r\n\r\n<html><body>Mock archived page</body></html>'],
    { type: 'multipart/related' },
  );
  const saveAsMHTML = vi.fn(async (details: { tabId: number }): Promise<Blob> => {
    const preset = mhtmlForTab.get(details.tabId);
    if (preset instanceof Error) throw preset;
    if (preset) return preset;
    const tab = tabs.get(details.tabId);
    if (!tab) throw new Error(`pageCapture.saveAsMHTML: no tab ${details.tabId}`);
    return DEFAULT_MHTML;
  });
  let scriptingPageDocument: Document | null = null;
  const scriptingCalls: Array<{ tabId: number }> = [];
  const executeScript = vi.fn(async (injection: {
    target: { tabId: number };
    func: (...args: unknown[]) => unknown;
    args?: unknown[];
  }): Promise<Array<{ result: unknown }>> => {
    const tab = tabs.get(injection.target.tabId);
    if (!tab) throw new Error(`scripting.executeScript: no tab ${injection.target.tabId}`);
    scriptingCalls.push({ tabId: injection.target.tabId });
    // The injected func references the page's `document`/`window` globals;
    // stand them in from the fixture when the test supplied one.
    const globals = globalThis as { document?: Document; window?: Window };
    const prevDocument = globals.document;
    const prevWindow = globals.window;
    if (scriptingPageDocument !== null) {
      globals.document = scriptingPageDocument;
      globals.window = (scriptingPageDocument.defaultView as Window | null) ?? prevWindow;
    }
    try {
      return [{ result: await injection.func(...(injection.args ?? [])) }];
    } finally {
      globals.document = prevDocument;
      globals.window = prevWindow;
    }
  });
  const grantedPatterns = new Set<string>();
  const requestCalls: string[][] = [];
  let gestureActive = false;
  let forceNextDecline = false;

  const listeners: InstalledMock['listeners'] = {
    installed: [],
    startup: [],
    actionClicked: [],
    command: [],
    menuClicked: [],
    message: [],
  };

  const mock = {
    runtime: {
      id: 'test-extension-id',
      getURL: (path: string) =>
        `chrome-extension://test-extension-id/${path.replace(/^\//, '')}`,
      onInstalled: { addListener: (fn: (details: chrome.runtime.InstalledDetails) => void) => void listeners.installed.push(fn) },
      onStartup: { addListener: (fn: () => void) => void listeners.startup.push(fn) },
      onMessage: {
        addListener: (
          fn: (
            message: unknown,
            sender: chrome.runtime.MessageSender,
            sendResponse: (response: unknown) => void,
          ) => boolean | void,
        ) => void listeners.message.push(fn),
      },
    },
    action: {
      onClicked: { addListener: (fn: (tab: chrome.tabs.Tab) => void) => void listeners.actionClicked.push(fn) },
    },
    commands: {
      onCommand: { addListener: (fn: (command: string) => void) => void listeners.command.push(fn) },
      getAll: vi.fn(async () => [
        { name: '_execute_action', description: 'Open the dashboard', shortcut: 'Alt+Shift+N' },
        { name: 'create-note', description: 'Create a new note', shortcut: null },
      ]),
    },
    tabs: {
      query: vi.fn(async (queryInfo: { url?: string }) =>
        [...tabs.values()].filter((tab) => (queryInfo.url ? tab.url === queryInfo.url : true)),
      ),
      create: vi.fn(async (createInfo: { url: string; active?: boolean }) => {
        const tab: MockTab = {
          id: nextTabId++,
          url: createInfo.url,
          active: createInfo.active ?? false,
          windowId: 1,
          title: '',
          status: 'loading',
        };
        tabs.set(tab.id, tab);
        return tab;
      }),
      get: vi.fn(async (tabId: number) => {
        const tab = tabs.get(tabId);
        if (!tab) throw new Error(`tabs.get: no tab ${tabId}`);
        return tab;
      }),
      update: vi.fn(async (tabId: number, updateInfo: { active?: boolean; url?: string }) => {
        const tab = tabs.get(tabId);
        if (!tab) throw new Error(`tabs.update: no tab ${tabId}`);
        if (updateInfo.url !== undefined) tab.url = updateInfo.url;
        if (updateInfo.active !== undefined) tab.active = updateInfo.active;
        return tab;
      }),
      remove: vi.fn(async (tabId: number) => {
        if (!tabs.delete(tabId)) throw new Error(`tabs.remove: no tab ${tabId}`);
        for (const listener of tabRemoved) listener(tabId);
      }),
      onUpdated: {
        addListener: (fn: (tabId: number, changeInfo: { status?: string; url?: string }, tab: MockTab) => void) =>
          void tabUpdated.push(fn),
        removeListener: (fn: (tabId: number, changeInfo: { status?: string; url?: string }, tab: MockTab) => void) => {
          const index = tabUpdated.indexOf(fn);
          if (index >= 0) tabUpdated.splice(index, 1);
        },
      },
      onRemoved: {
        addListener: (fn: (tabId: number) => void) => void tabRemoved.push(fn),
        removeListener: (fn: (tabId: number) => void) => {
          const index = tabRemoved.indexOf(fn);
          if (index >= 0) tabRemoved.splice(index, 1);
        },
      },
      sendMessage: vi.fn(async (tabId: number, _message: unknown) => {
        if (!tabsWithListeners.has(tabId)) {
          throw new Error('Could not establish connection. Receive end does not exist.');
        }
      }),
    },
    windows: {
      update: vi.fn(async (_windowId: number, _updateInfo: { focused?: boolean }) => ({})),
    },
    pageCapture: {
      saveAsMHTML,
    },
    scripting: {
      executeScript,
    },
    contextMenus: {
      create: (options: { id?: string | number; title: string; contexts: string[]; documentUrlPatterns?: string[] }) => {
        createdMenus.push({
          id: options.id ?? '',
          title: options.title,
          contexts: options.contexts,
          documentUrlPatterns: options.documentUrlPatterns,
        });
        return options.id ?? '';
      },
      removeAll: (callback?: () => void) => {
        removeAllMenusCalls += 1;
        createdMenus.length = 0;
        callback?.();
      },
      onClicked: { addListener: (fn: (info: chrome.contextMenus.OnClickData) => void) => void listeners.menuClicked.push(fn) },
    },
    alarms: {
      create: vi.fn((name: string, info: chrome.alarms.AlarmCreateInfo) => {
        alarms.set(name, { name, scheduledTime: info.when ?? Date.now() });
      }),
      clear: vi.fn(async (name: string) => alarms.delete(name)),
      getAll: vi.fn(async () => [...alarms.values()].map((a) => ({ ...a }))),
    },
    storage: {
      local: {
        get: (keys: string | string[] | null, callback: (items: Record<string, unknown>) => void) => {
          const wanted = keys === null || keys === undefined ? [...storage.keys()] : Array.isArray(keys) ? keys : [keys];
          const items: Record<string, unknown> = {};
          for (const key of wanted) {
            const value = storage.get(key);
            if (value !== undefined) items[key] = value;
          }
          queueMicrotask(() => callback(items));
        },
        set: (items: Record<string, unknown>, callback?: () => void) => {
          for (const [key, value] of Object.entries(items)) storage.set(key, value);
          callback?.();
        },
      },
    },
    permissions: {
      // Chrome's real API: contains() needs no gesture; request() resolves
      // false without one (or when the user declines the prompt).
      contains: vi.fn(async (perms: { origins?: string[] }) =>
        (perms.origins ?? []).every((pattern) => grantedPatterns.has(pattern)),
      ),
      request: vi.fn(async (perms: { origins?: string[] }) => {
        const origins = perms.origins ?? [];
        requestCalls.push([...origins]);
        if (!gestureActive || forceNextDecline) {
          forceNextDecline = false;
          return false;
        }
        for (const pattern of origins) grantedPatterns.add(pattern);
        return true;
      }),
      remove: vi.fn(async (perms: { origins?: string[] }) => {
        let removed = false;
        for (const pattern of perms.origins ?? []) {
          if (grantedPatterns.delete(pattern)) removed = true;
        }
        return removed;
      }),
      getAll: vi.fn(async () => ({
        permissions: ['storage', 'unlimitedStorage', 'alarms', 'notifications', 'scripting', 'pageCapture', 'debugger', 'contextMenus'],
        origins: ['http://127.0.0.1/*', 'http://localhost/*', ...grantedPatterns],
      })),
    },
  };

  (globalThis as Record<string, unknown>)['chrome'] = mock;

  return {
    listeners,
    tabs,
    alarms,
    storage,
    tabsWithListeners,
    createdMenus,
    tabUpdated,
    tabRemoved,
    pageCapture: { saveAsMHTML, mhtmlForTab },
    scripting: {
      executeScript,
      setPageDocument: (doc: Document | null) => {
        scriptingPageDocument = doc;
      },
      calls: scriptingCalls,
    },
    permissions: {
      grantedPatterns,
      get gestureActive() {
        return gestureActive;
      },
      set gestureActive(value: boolean) {
        gestureActive = value;
      },
      get forceNextDecline() {
        return forceNextDecline;
      },
      set forceNextDecline(value: boolean) {
        forceNextDecline = value;
      },
      requestCalls,
    },
    get removeAllMenusCalls() {
      return removeAllMenusCalls;
    },
    uninstall: () => {
      delete (globalThis as Record<string, unknown>)['chrome'];
    },
  };
}

/** Add a fake dashboard tab and return its id. */
let fakeTabCounter = 1000;
export function addTab(installed: InstalledMock, url: string): number {
  const id = fakeTabCounter++;
  installed.tabs.set(id, { id, url, active: false, windowId: 1, title: '', status: 'complete' });
  return id;
}
