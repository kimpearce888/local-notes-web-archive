/**
 * Service worker entry (PRD §8.1): toolbar/shortcut/context-menu events,
 * alarms, capture orchestration (later tasks) and typed message routing.
 * Stateless across suspension — durable state is always read from
 * IndexedDB. All listeners are registered synchronously at top level as MV3
 * requires.
 */

import { isRpcRequest, rpcFailure, RPC_KIND } from './protocol';
import { MessageRouter } from './router';
import { registerAllApi } from './api';
import { openOrFocusDashboard } from './dashboard-tab';
import { registerContextMenus, handleContextMenuClick } from './context-menus';
import { handleBrowserStartup, handleRuntimeInstalled, handleWorkerStartup } from './lifecycle';

const router = new MessageRouter();
registerAllApi(router);

/* ----------------------------- Messaging ----------------------------- */

chrome.runtime.onMessage.addListener(
  (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => {
    if (!isRpcRequest(message)) return false;
    // Only messages from this extension's own contexts are served.
    if (sender.id !== undefined && sender.id !== chrome.runtime.id) return false;
    void router
      .dispatch(message)
      .then(sendResponse)
      .catch((error: unknown) => {
        console.error('[rpc dispatch] unexpected failure', error);
        sendResponse(rpcFailure(message.id, 'internal-error', 'dispatch failed'));
      });
    return true; // keep the channel open for the async response
  },
);

/* --------------------------- Toolbar action -------------------------- */

chrome.action.onClicked.addListener(() => {
  void openOrFocusDashboard();
});

/* ------------------------------ Commands ----------------------------- */

chrome.commands.onCommand.addListener((command: string) => {
  // "_execute_action" is delivered to chrome.action.onClicked above.
  if (command === 'create-note') {
    void openOrFocusDashboard({ newNote: true });
  }
});

/* ---------------------------- Context menus -------------------------- */

chrome.contextMenus.onClicked.addListener((info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => {
  void handleContextMenuClick(info, tab).catch((error: unknown) => {
    console.error('[context-menu] action failed', error);
  });
});

/* ------------------------------ Lifecycle ---------------------------- */

chrome.runtime.onInstalled.addListener((details: chrome.runtime.InstalledDetails) => {
  void handleRuntimeInstalled(details);
});

chrome.runtime.onStartup.addListener(() => {
  void handleBrowserStartup();
});

registerContextMenus();

// Worker cold start: reconcile reminder alarms (FR-REM-04). Alarms persist
// across worker suspension; this keeps them aligned with canonical records.
void handleWorkerStartup();

export { RPC_KIND, router };
