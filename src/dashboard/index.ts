/**
 * Dashboard bootstrap: mounts the shell, starts the theme engine, creates
 * the typed messaging client and the controller, and handles the new-note
 * intents delivered by the service worker (tab message or `?new=1` when a
 * fresh tab was opened).
 */

import { mountDashboardShell, initialThemePreference, type DashboardShell } from './shell';
import { createThemeManager, type ThemeManager, type ThemePreference } from './theme';
import { showEmpty } from './states';
import { createApiClient } from './state/client';
import { createDashboardController, type DashboardController } from './state/controller';
import { createDiagnosticsPanel, type DiagnosticsPanel } from './views/diagnostics-panel';
import { createSettingsPanel, type SettingsPanel } from './views/settings-panel';
import { createOnboardingOverlay, type OnboardingOverlay } from './views/onboarding';
import { createCommandPalette, type PaletteEntry } from './views/command-palette';
import { createSavePageDialog } from './views/save-page-dialog';
import { SMART_LISTS, type SmartListId } from './views/smart-lists';
import { createDuplicateDecisionMonitor, type DuplicateDecisionMonitor } from './views/duplicate-dialog';
import type { CaptureProgressEvent, CaptureProgressPhase } from '../background/capture/queue';
import type { ReminderFiredEvent } from '../background/reminders/fire';

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

  // Diagnostics page (FR-LOG-05 / FR-SET-04): the shell button opens the
  // modal; every RPC it needs is injected here so the panel itself stays
  // chrome-free and unit-testable.
  const diagnostics: DiagnosticsPanel = createDiagnosticsPanel({
    overview: async () => (await client.request('diagnostics/overview', {})).overview,
    auditTrail: async () => {
      const page = await client.request('diagnostics/audit', { limit: 20 });
      return { events: page.events, total: page.total };
    },
    networkSelfTest: async () => (await client.request('diagnostics/network-self-test', {})).result,
    exportBundle: async () => (await client.request('diagnostics/export-bundle', {})).bundle,
    testLmStudio: async () => (await client.request('ai/test-connection', {})).result,
    rebuildSearchIndex: async () => await client.request('search/rebuild', {}),
    announce: (message) => shell.announce(message),
  });
  shell.on('diagnosticsOpen', () => diagnostics.open());

  // Settings panel (FR-SET-01): every section injects its RPC calls, the
  // theme applies live, and a saved patch re-loads the controller state.
  const settings: SettingsPanel = createSettingsPanel({
    getSettings: async () => (await client.request('settings/get', {})).settings,
    patchSettings: async (patch) => {
      const { settings } = await client.request('settings/patch', { patch });
      // QA-D03 fix: a saved patch re-loads the controller state so the LIVE
      // session picks up the saved preferences (toolbar groups etc.)
      // immediately instead of after a manual page reload.
      void controller.refreshSettings().catch(() => undefined);
      return settings;
    },
    listGranted: async () => await client.request('permissions/list-granted', {}),
    revokeOrigin: async (origin) => await client.request('permissions/revoke', { origin }),
    listModels: async () => await client.request('ai/list-models', {}),
    testConnection: async (baseUrl) =>
      (await client.request('ai/test-connection', baseUrl ? { baseUrl } : {})).result,
    exportBackup: async () => await client.request('backup/export', {}),
    previewBackup: async (file) => (await client.request('backup/preview', { archive: file })).preview,
    restoreBackup: async (file, mode, confirmReplace) =>
      (await client.request('backup/restore', { archive: file, mode, confirmReplace })).result,
    readCommandStatus: async () => await client.request('commands/status', {}),
    showOnboarding: () => onboarding.open(),
    setTheme: (preference) => theme.setPreference(preference),
    announce: (message) => shell.announce(message),
  });
  shell.on('settingsOpen', () => settings.open());

  /* Command palette (T-056, redesign brief): a keyboard-first launcher
     over EXISTING actions only. Every entry activates the very same
     buttons the rest of the UI uses, so the palette owns no business
     logic — navigation and preference surface, nothing else. */
  const smartListButton = (list: SmartListId): HTMLButtonElement | null =>
    shell.elements.smartNav.querySelector<HTMLButtonElement>(
      `[data-smart-list="${list}"]`,
    );
  const THEME_ENTRIES: ReadonlyArray<{ preference: ThemePreference; label: string }> = [
    { preference: 'dark', label: 'Dark theme' },
    { preference: 'light', label: 'Light theme' },
    { preference: 'system', label: 'Follow system theme' },
  ];
  const paletteEntries = (): PaletteEntry[] => {
    const entries: PaletteEntry[] = [
      {
        id: 'new-note',
        label: 'New note',
        group: 'Actions',
        hint: 'Alt+Shift+C',
        icon: 'plus',
        run: () => shell.elements.newNoteButton.click(),
      },
      {
        id: 'save-page',
        label: 'Save a web page…',
        group: 'Actions',
        icon: 'archive',
        run: () => shell.elements.savePageButton.click(),
      },
      {
        id: 'import-note',
        label: 'Import note…',
        group: 'Actions',
        icon: 'import',
        run: () => shell.elements.importNoteButton.click(),
      },
      {
        id: 'focus-search',
        label: 'Focus search',
        group: 'Actions',
        hint: '/',
        icon: 'search',
        run: () => {
          shell.elements.searchInput.focus();
          shell.elements.searchInput.select();
        },
      },
    ];
    for (const list of SMART_LISTS) {
      entries.push({
        id: `go-${list.id}`,
        label: `Go to ${list.label}`,
        group: 'Go to',
        run: () => smartListButton(list.id)?.click(),
      });
    }
    for (const themeEntry of THEME_ENTRIES) {
      entries.push({
        id: `theme-${themeEntry.preference}`,
        label: themeEntry.label,
        group: 'Preferences',
        active: theme.preference() === themeEntry.preference,
        run: () => theme.setPreference(themeEntry.preference),
      });
    }
    entries.push(
      {
        id: 'open-settings',
        label: 'Open settings',
        group: 'Open',
        icon: 'settings',
        run: () => shell.elements.settingsButton.click(),
      },
      {
        id: 'open-diagnostics',
        label: 'Open diagnostics',
        group: 'Open',
        icon: 'activity',
        run: () => shell.elements.diagnosticsButton.click(),
      },
    );
    return entries;
  };
  const commandPalette = createCommandPalette({
    entries: paletteEntries,
    announce: (message) => shell.announce(message),
  });
  shell.on('commandPaletteOpen', () => commandPalette.open());

  /* Save-a-web-page dialog (T-089, register UX-13): the visible capture
   * entry point. Saving creates the note + link through capture/save-url
   * (the same pipeline the context menu uses) and refreshes the list so
   * the new note appears immediately. */
  const savePageDialog = createSavePageDialog({
    saveUrl: async (url) => {
      const result = await client.request('capture/save-url', { url });
      void controller.refresh().catch(() => undefined);
      return { queued: result.queued };
    },
    announce: (message) => shell.announce(message),
  });
  shell.on('savePage', () => savePageDialog.open());

  // First-run onboarding (FR-SET-02): informative, never blocking.
  const onboarding: OnboardingOverlay = createOnboardingOverlay({
    complete: async () => {
      await client.request('settings/set-onboarding-complete', { complete: true });
    },
    openSettings: () => settings.open(),
    // T-089 (UX-14): the primary action is a CONCRETE first step.
    createFirstNote: () => {
      shell.elements.newNoteButton.focus();
      void controller.createNote();
    },
    announce: (message) => shell.announce(message),
  });
  void (async () => {
    try {
      const { complete } = await client.request('settings/get-onboarding-complete', {});
      if (!complete) onboarding.open();
    } catch {
      // Unreadable flag: never block the app on onboarding bookkeeping.
    }
  })();

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
    if (kind === 'reminder-fired') {
      // FR-REM-05: a reminder fired while this tab was open — announce it
      // and refresh the cards (the overdue chip appears immediately).
      const event = message as ReminderFiredEvent;
      shell.announce(`Reminder due: ${event.title}`);
      void controller.refresh().catch(() => undefined);
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
      commandPalette.dispose();
      savePageDialog.dispose();
      duplicates.dispose();
      diagnostics.dispose();
      settings.dispose();
      onboarding.dispose();
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
