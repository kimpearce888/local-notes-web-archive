/**
 * Service worker entry (PRD §8.1): toolbar/shortcut/context-menu events,
 * alarms, capture orchestration (later tasks) and typed message routing.
 * Stateless across suspension — durable state is always read from
 * IndexedDB. All listeners are registered synchronously at top level as MV3
 * requires.
 */

import {
  containsBlob,
  decodeBinaries,
  encodeBinaries,
  isRpcRequest,
  rpcFailure,
  RPC_KIND,
} from './protocol';
import { MessageRouter, toRpcError } from './router';
import { registerAllApi } from './api';
import { openOrFocusDashboard } from './dashboard-tab';
import { registerContextMenus, handleContextMenuClick } from './context-menus';
import { handleBrowserStartup, handleRuntimeInstalled, handleWorkerStartup } from './lifecycle';
import { getCaptureQueue } from './capture/pipeline';
import { handleReminderAlarm } from './reminders/fire';

const router = new MessageRouter();
registerAllApi(router);

// Capture pipeline (T-023): the single queue with the production artifact
// steps, subscribed to link-queued notifications. Initialized at top level so
// the queue exists before any event can fire; startup requeue happens in
// handleWorkerStartup.
getCaptureQueue();

/* ----------------------------- Messaging ----------------------------- */

chrome.runtime.onMessage.addListener(
  (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => {
    if (!isRpcRequest(message)) return false;
    // Only messages from this extension's own contexts are served.
    if (sender.id !== undefined && sender.id !== chrome.runtime.id) return false;
    void (async () => {
      try {
        // T-063 binary codec (mirror side): the channel JSON-serializes
        // values, so Blobs arrive as base64 envelopes and must be rebuilt
        // BEFORE dispatch — handler `instanceof Blob` guards then validate
        // the real blob. Results take the inverse path: any Blob the
        // handler returns is encoded back into an envelope so it survives
        // the return trip to the dashboard.
        const decoded: typeof message = { ...message, payload: decodeBinaries(message.payload) };
        const response = await router.dispatch(decoded);
        const wire =
          response.ok && containsBlob(response.result)
            ? { ...response, result: await encodeBinaries(response.result) }
            : response;
        sendResponse(wire);
      } catch (error) {
        console.error('[rpc dispatch] unexpected failure', error);
        // Codec validation failures keep their coded shape (e.g.
        // invalid-request for a malformed envelope) instead of collapsing
        // into a generic internal error.
        const rpcError = toRpcError(error);
        sendResponse(rpcFailure(message.id, rpcError.code, rpcError.message));
      }
    })();
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

/* ------------------------------ Alarms ------------------------------- */

// Reminder wake-up hints (FR-REM-04): canonical records drive the truth;
// the handler stamps lastFiredAt, recomputes the next occurrence and
// notifies + broadcasts to open dashboard tabs.
chrome.alarms.onAlarm.addListener((alarm: chrome.alarms.Alarm) => {
  void handleReminderAlarm(alarm).catch((error: unknown) => {
    console.error('[alarms] reminder firing failed', error);
  });
});

// Reminder notification click: open (or focus) the dashboard so the user
// can complete/dismiss the reminder that raised the notification.
if (chrome.notifications?.onClicked) {
  chrome.notifications.onClicked.addListener((notificationId: string) => {
    if (notificationId.startsWith('reminder')) {
      void openOrFocusDashboard().catch(() => undefined);
    }
  });
}

registerContextMenus();

// Worker cold start: reconcile reminder alarms (FR-REM-04). Alarms persist
// across worker suspension; this keeps them aligned with canonical records.
void handleWorkerStartup();

export { RPC_KIND, router };
