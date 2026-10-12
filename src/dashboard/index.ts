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
import { createDuplicateDecisionMonitor, type DuplicateDecisionMonitor } from './views/duplicate-dialog';
import type { CaptureProgressEvent, CaptureProgressPhase } from '../background/capture/queue';

const THEME_STORAGE_KEY = 'lnwa-theme-preference';

/** Capture outcomes worth a live-region announcement (FR-CAP-03/07). */
const ANNOUNCED_CAPTURE_PHASES: readonly CaptureProgressPhase[] = [
  'succeeded',
  'reused',
  'failed',
  'canceled',
  'permission-required',
  'waiting-dedup',
];

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

  // Duplicate-capture decisions (FR-CAP-08 `ask` policy): parked links get
  // a user-visible confirmation, presented one at a time.
  const duplicates: DuplicateDecisionMonitor = createDuplicateDecisionMonitor({
    status: async () => (await client.request('capture/status', {})).status,
    resolveDuplicate: async (linkId, resolution) => {
      try {
        return (await client.request('capture/resolve-duplicate', { linkId, resolution })).resolved;
      } catch {
        return false;
      }
    },
    announce: (message) => shell.announce(message),
  });
  void duplicates.refresh();

  /* Service-worker intents: a focused dashboard tab receives the
     create-note command as a tab message (dashboard-tab.ts). Capture
     progress from the background queue arrives the same way; terminal
     phases are announced, every event re-checks parked duplicate
     decisions, and the snapshot UI refreshes on demand (T-026). */
  const onRuntimeMessage = (message: unknown): void => {
    if (typeof message !== 'object' || message === null) return;
    const kind = (message as { kind?: unknown }).kind;
    if (kind === 'ui-intent' && (message as { intent?: unknown }).intent === 'new-note') {
      shell.elements.newNoteButton.focus();
      void controller.createNote();
      return;
    }
    if (kind === 'capture-progress') {
      const event = message as CaptureProgressEvent;
      if (ANNOUNCED_CAPTURE_PHASES.includes(event.phase)) {
        shell.announce(`Capture ${event.phase.replace('-', ' ')}: ${event.detail}`);
      }
      void duplicates.refresh();
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
      duplicates.dispose();
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
