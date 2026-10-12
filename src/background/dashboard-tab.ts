/**
 * Single-dashboard-tab management (PRD §4.1): a toolbar click opens the
 * dashboard as a normal extension tab, focusing an existing dashboard tab
 * instead of creating duplicates. Only tabs whose URL is our own dashboard
 * are ever queried — no browsing-history or foreign-tab inspection.
 */

export const DASHBOARD_PAGE = 'dashboard.html';

export interface OpenDashboardOptions {
  /** Open with the "create a note" intent (command shortcut). */
  readonly newNote?: boolean;
}

export interface OpenDashboardResult {
  readonly tabId: number | null;
  /** True when a new tab was created; false when an existing one was focused. */
  readonly created: boolean;
  /** True when the new-note intent was forwarded to an open dashboard. */
  readonly intentDelivered: boolean;
}

export function dashboardUrl(): string {
  return chrome.runtime.getURL(DASHBOARD_PAGE);
}

/**
 * Open or focus the single dashboard tab. With `newNote` and an existing
 * tab, the intent is delivered as a tab message so unsaved edits are never
 * discarded by a navigation; a fresh tab opens directly with `?new=1`.
 */
export async function openOrFocusDashboard(options: OpenDashboardOptions = {}): Promise<OpenDashboardResult> {
  const url = chrome.runtime.getURL(DASHBOARD_PAGE);
  const existing = await chrome.tabs.query({ url });
  const tab = existing[0];
  if (tab !== undefined && tab.id !== undefined && tab.id !== null) {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId !== undefined) {
      try {
        await chrome.windows.update(tab.windowId, { focused: true });
      } catch {
        // The window may have closed between query and focus; the tab is
        // already active in whatever window owns it.
      }
    }
    let intentDelivered = false;
    if (options.newNote) {
      intentDelivered = await deliverNewNoteIntent(tab.id);
    }
    return { tabId: tab.id, created: false, intentDelivered };
  }
  const created = await chrome.tabs.create({
    url: options.newNote ? `${url}?new=1` : url,
    active: true,
  });
  return { tabId: created.id ?? null, created: true, intentDelivered: options.newNote === true };
}

async function deliverNewNoteIntent(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, { kind: 'ui-intent', intent: 'new-note' });
    return true;
  } catch {
    // No listener yet: the tab is still loading its document. A loaded
    // dashboard always registers a listener, so this fallback can only run
    // during load — never over unsaved edits (PRD §4.3) — and re-targets the
    // loading page with the ?new=1 intent instead of dropping it.
    try {
      await chrome.tabs.update(tabId, { url: `${chrome.runtime.getURL(DASHBOARD_PAGE)}?new=1` });
      return true;
    } catch {
      return false;
    }
  }
}
