/**
 * Dashboard bootstrap: mounts the shell, starts the theme engine, handles
 * the new-note intents delivered by the service worker (tab message or
 * `?new=1` when a fresh tab was opened), and presents the initial truthful
 * region state. Data wiring arrives with the state manager (T-015) and the
 * card views (T-016) — the shell never fakes content.
 */

import { mountDashboardShell, initialThemePreference, type DashboardShell } from './shell';
import { createThemeManager, type ThemeManager } from './theme';
import { showEmpty } from './states';

const THEME_STORAGE_KEY = 'lnwa-theme-preference';

export interface DashboardApp {
  readonly shell: DashboardShell;
  readonly theme: ThemeManager;
  dispose(): void;
}

export function bootDashboard(root: HTMLElement): DashboardApp {
  const shell = mountDashboardShell(root);
  const theme = createThemeManager(
    document.documentElement,
    initialThemePreference(),
  );

  // Keep the pre-paint hint in sync so reloads start in the same theme.
  const persistHint = (resolved: 'light' | 'dark'): void => {
    try {
      window.localStorage.setItem(
        THEME_STORAGE_KEY,
        theme.preference() === 'system' ? 'system' : resolved,
      );
    } catch {
      /* storage unavailable — theme still applies for this session */
    }
  };
  theme.onChange(persistHint);

  const handleNewNoteIntent = (): void => {
    shell.elements.newNoteButton.focus();
    shell.announce('New note action focused.');
  };

  shell.on('newNote', () => {
    shell.announce('New note.');
  });

  /* Service-worker intents: a focused dashboard tab receives the
     create-note command as a tab message (dashboard-tab.ts). */
  const onRuntimeMessage = (message: unknown): void => {
    if (
      typeof message === 'object' &&
      message !== null &&
      (message as { kind?: unknown }).kind === 'ui-intent' &&
      (message as { intent?: unknown }).intent === 'new-note'
    ) {
      handleNewNoteIntent();
    }
  };
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener(onRuntimeMessage);
  }

  // Fresh tab opened with the ?new=1 intent (no existing dashboard).
  if (new URLSearchParams(window.location.search).get('new') === '1') {
    handleNewNoteIntent();
  }

  // Truthful initial state: the store (next task) will replace this with
  // live loading/empty/error transitions driven by real data.
  showEmpty(
    shell.elements.resultsRegion,
    'No notes yet',
    'Notes you create and pages you save will appear here.',
  );
  shell.setResultsHeading('All notes', '0 notes');
  shell.setSaveState('idle');

  return {
    shell,
    theme,
    dispose(): void {
      if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.removeListener(onRuntimeMessage);
      }
      theme.dispose();
      shell.dispose();
      root.replaceChildren();
    },
  };
}

const mountPoint = document.getElementById('app');
if (mountPoint) {
  bootDashboard(mountPoint);
}
