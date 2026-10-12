/**
 * Context menus (PRD §4.1): user-invoked actions only. Items are registered
 * for http/https documents so they never appear on internal chrome:// pages
 * or inside the extension's own dashboard.
 */

import {
  saveCurrentPageAsNote,
  saveSelectionAsNote,
  type QuickCaptureResult,
} from './quick-capture';
import { repo } from './db';
import { appendLog } from '../core/repo/logs';

export const MENU_SAVE_CURRENT_PAGE = 'save-current-page';
export const MENU_SAVE_SELECTION = 'save-selection-as-note';

/** http(s) only: keeps menus off internal pages and the dashboard itself. */
const DOCUMENT_URL_PATTERNS: readonly string[] = ['http://*/*', 'https://*/*'];

export function registerContextMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_SAVE_CURRENT_PAGE,
      title: 'Save current page to notes',
      contexts: ['page'],
      documentUrlPatterns: [...DOCUMENT_URL_PATTERNS],
    });
    chrome.contextMenus.create({
      id: MENU_SAVE_SELECTION,
      title: 'Save selection as note',
      contexts: ['selection'],
      documentUrlPatterns: [...DOCUMENT_URL_PATTERNS],
    });
  });
}

/**
 * Dispatch a context-menu click. Only the click's own payload and the
 * clicked tab's title are used; the handler never queries other tabs or
 * history (PRD §4.1).
 */
export async function handleContextMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab,
): Promise<QuickCaptureResult | null> {
  const pageUrl = typeof info.pageUrl === 'string' ? info.pageUrl : '';
  const pageTitle = typeof tab?.title === 'string' ? tab.title : '';
  const menuId = info.menuItemId;
  try {
    if (menuId === MENU_SAVE_CURRENT_PAGE) {
      return await saveCurrentPageAsNote({ pageUrl, pageTitle });
    }
    if (menuId === MENU_SAVE_SELECTION) {
      return await saveSelectionAsNote({
        pageUrl,
        pageTitle,
        selectionText: typeof info.selectionText === 'string' ? info.selectionText : '',
      });
    }
    return null;
  } catch (error) {
    // Failures are logged truthfully; the click has no response channel,
    // so the next dashboard open surfaces the error states.
    try {
      await appendLog(await repo(), {
        level: 'error',
        component: 'context-menus',
        operationId: String(menuId),
        resultCode: 'failed',
        message: error instanceof Error ? error.message : String(error),
      });
    } catch {
      // Logging failures must not mask the original error.
    }
    throw error;
  }
}
