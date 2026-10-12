/**
 * Dashboard bootstrap: mounts the shell, starts the theme engine, creates
 * the typed messaging client and the controller, and handles the new-note
 * intents delivered by the service worker (tab message or `?new=1` when a
 * fresh tab was opened).
 */

import { mountDashboardShell, initialThemePreference, type DashboardShell } from './shell';
import { createThemeManager, type ThemeManager } from './theme';
import { showEmpty } from './states';
import { createApiClient } from './state/client';
import { createDashboardController, type DashboardController } from './state/controller';

const THEME_STORAGE_KEY = 'lnwa-theme-preference';

export interface DashboardApp {
  readonly shell: DashboardShell;
  readonly theme: ThemeManager;
  readonly controller: DashboardController;
  dispose(): void;
}

export function bootDashboard(root: HTMLElement): DashboardApp {
  const shell = mountDashboardShell(root);
  const theme = createThemeManager(document.documentElement, initialThemePreference());

  // Keep the pre-paint hint in sync so reloads start in the same theme; the
  // canonical settings value (loaded by the controller) overrides it.
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

  const client = createApiClient();
  const controller = createDashboardController({ shell, theme, client });

  /* Service-worker intents: a focused dashboard tab receives the
     create-note command as a tab message (dashboard-tab.ts). */
  const onRuntimeMessage = (message: unknown): void => {
    if (
      typeof message === 'object' &&
      message !== null &&
      (message as { kind?: unknown }).kind === 'ui-intent' &&
      (message as { intent?: unknown }).intent === 'new-note'
    ) {
      shell.elements.newNoteButton.focus();
      void controller.createNote();
    }
  };
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener(onRuntimeMessage);
  }

  // Fresh tab opened with the ?new=1 intent (no existing dashboard).
  if (new URLSearchParams(window.location.search).get('new') === '1') {
    void controller.createNote();
  }

  // Pre-controller truthful initial paint (the controller's own loading
  // state replaces this on its first subscription tick).
  showEmpty(
    shell.elements.resultsRegion,
    'Loading…',
    'Reading your local database.',
  );
  shell.setResultsHeading('All notes', '…');
  shell.setSaveState('idle');

  return {
    shell,
    theme,
    controller,
    dispose(): void {
      if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.removeListener(onRuntimeMessage);
      }
      controller.dispose();
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
