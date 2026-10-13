// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSettingsPanel } from '../../../src/dashboard/views/settings-panel';
import { DEFAULT_SETTINGS } from '../../../src/core/repo/settings';
import type { AppSettings, UtcTimestamp } from '../../../src/core/types';
import type { GrantedOriginInfo } from '../../../src/background/api/permissions';
import type { BackupPreview } from '../../../src/background/backup/restore';
import type { BackupExportResult } from '../../../src/background/backup/export';

/**
 * T-039 settings panel (FR-SET-01): every section renders, drafts collect
 * into a single settings/patch (nested objects merged, invalid numbers
 * excluded), theme applies live, origin revocation acts immediately, the AI
 * test result is truthful, and the MCP disclosure is present. Save failures
 * keep the draft dirty and announce honestly.
 */

const settings: AppSettings = {
  ...DEFAULT_SETTINGS,
  theme: 'system',
  viewMode: 'grid',
  defaultSort: { field: 'modified', direction: 'desc' },
  savedViews: [],
  autoCaptureOnPaste: true,
  allowedOrigins: [],
  capture: { maxArchiveBytes: 100 * 1024 * 1024, maxScreenshotPixels: 64_000_000, timeoutMs: 45_000 },
  duplicateCapture: 'ask',
  reminders: { notificationsEnabled: true, leapDayPolicy: 'feb-28' },
  editor: { toolbar: {} },
  revisionRetention: 20,
  backup: { warnAfterDays: 14 },
  ai: {
    enabled: false,
    baseUrl: 'http://127.0.0.1:1234/v1',
    model: null,
    timeoutMs: 60_000,
    permissionMode: 'ask-per-write',
  },
  logs: { maxBytes: 5 * 1024 * 1024, auditRetentionDays: 365 },
};

const granted: readonly GrantedOriginInfo[] = [
  { origin: 'https://example.com', linkCount: 3, waitingCount: 0 },
];

interface Harness {
  panel: ReturnType<typeof createSettingsPanel>;
  patches: Record<string, unknown>[];
  revoked: string[];
  themes: string[];
  announced: string[];
  setSettings(value: AppSettings): void;
  setGranted(value: readonly GrantedOriginInfo[]): void;
  failPatch(value: boolean): void;
}

function mountPanel(): Harness {
  const patches: Record<string, unknown>[] = [];
  const revoked: string[] = [];
  const themes: string[] = [];
  const announced: string[] = [];
  let currentSettings: AppSettings = { ...settings };
  let currentGranted: readonly GrantedOriginInfo[] = granted;
  let shouldFailPatch = false;
  const panel = createSettingsPanel({
    getSettings: async () => currentSettings,
    patchSettings: async (patch) => {
      if (shouldFailPatch) throw new Error('invalid-request: revisionRetention below floor');
      patches.push(patch);
      currentSettings = { ...currentSettings, ...patch } as AppSettings;
      return currentSettings;
    },
    listGranted: async () => ({ origins: currentGranted }),
    revokeOrigin: async (origin) => {
      revoked.push(origin);
      currentGranted = currentGranted.filter((entry) => entry.origin !== origin);
      return { revoked: true };
    },
    listModels: async () => ({
      models: [{ id: 'qwen-7b', object: 'model', owned_by: 'lmstudio' }],
    }),
    testConnection: async () => ({ ok: true, latencyMs: 9, models: ['qwen-7b'], error: null, errorMessage: null }),
    exportBackup: async () =>
      ({
        blob: new Blob(['zip'], { type: 'application/zip' }),
        filename: 'notes-backup.zip',
        exportedAt: '2026-10-12T00:00:00.000Z' as UtcTimestamp,
        counts: { notes: 1, tags: 0, categories: 0, links: 0, snapshots: 0, reminders: 0, revisions: 1, attachments: 0, blobs: 0 },
      }) as BackupExportResult,
    previewBackup: async () =>
      ({
        manifest: {
          format: 'lnwa-backup',
          backupVersion: 1,
          schemaVersion: 2,
          appVersion: '1.0.0',
          exportedAt: '2026-10-01T00:00:00.000Z',
          counts: { notes: 2, tags: 0, categories: 0, links: 0, snapshots: 1, reminders: 0, revisions: 2, attachments: 0, blobs: 1 },
          files: {},
        },
        compatible: true,
        issues: [],
      }) as BackupPreview,
    restoreBackup: async () => ({
      mode: 'merge',
      imported: { notes: 2, reminders: 0, snapshots: 1, blobs: 1 },
    }),
    readCommandStatus: async () => ({
      openDashboard: 'Alt+Shift+N',
      createNote: null,
      suggested: 'Alt+Shift+N',
      suggestedMissing: false,
    }),
    showOnboarding: () => undefined,
    setTheme: (preference) => themes.push(preference),
    announce: (message) => announced.push(message),
  });
  return {
    panel,
    patches,
    revoked,
    themes,
    announced,
    setSettings(value) {
      currentSettings = value;
    },
    setGranted(value) {
      currentGranted = value;
    },
    failPatch(value) {
      shouldFailPatch = value;
    },
  };
}

async function waitFor<T>(probe: () => T | Promise<T>, timeoutMs = 4000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function dialogOf(): HTMLDialogElement {
  const dialog = document.querySelector('dialog.dialog--settings');
  if (!dialog) throw new Error('settings dialog not mounted');
  return dialog as HTMLDialogElement;
}

function button(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find((b) => b.textContent === text) as
    | HTMLButtonElement
    | undefined;
}

beforeEach(() => {
  const dialogProto = HTMLDialogElement.prototype as HTMLDialogElement & {
    showModal?: () => void;
    close?: () => void;
  };
  dialogProto.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  dialogProto.close ??= function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('settings panel', () => {
  it('renders every FR-SET-01 section from the loaded settings', async () => {
    const harness = mountPanel();
    harness.panel.open();
    const dialog = dialogOf();
    await waitFor(() => dialog.querySelector('.settings__panel'));
    const text = dialog.textContent ?? '';
    expect(text).toContain('Appearance');
    expect(text).toContain('Web capture');
    expect(text).toContain('Site access');
    expect(text).toContain('Reminders');
    expect(text).toContain('Editor toolbar');
    expect(text).toContain('Data and retention');
    expect(text).toContain('Backup and restore');
    expect(text).toContain('Local AI (LM Studio)');
    expect(text).toContain('Keyboard shortcuts');
    expect(text).toContain('https://example.com · 3 links');
    expect(text).toContain('Ask before every write');
    expect(text).toContain('not selected');
    expect(text).toContain('Alt+Shift+N (active)');
    harness.panel.dispose();
  });

  it('applies the theme live and collects it into the saved patch', async () => {
    const harness = mountPanel();
    harness.panel.open();
    const dialog = dialogOf();
    await waitFor(() => dialog.querySelector('.settings__panel'));

    const darkRadio = dialog.querySelector<HTMLInputElement>('input[name="Theme"][value="dark"]');
    darkRadio?.click();
    expect(harness.themes).toEqual(['dark']);

    const save = button('Save changes*');
    expect(save?.disabled).toBe(false);
    save?.click();
    await waitFor(() => harness.patches.length > 0);
    expect(harness.patches[0]).toMatchObject({ theme: 'dark' });
    expect(harness.announced).toContain('Settings saved.');
    harness.panel.dispose();
  });

  it('collects the default sort field AND direction into the patch (T-066)', async () => {
    const harness = mountPanel();
    harness.panel.open();
    const dialog = dialogOf();
    await waitFor(() => dialog.querySelector('.settings__panel'));

    // The Default sort row now carries the direction pair the audit found
    // missing (D-03: no ascending control anywhere).
    const selects = [...dialog.querySelectorAll<HTMLSelectElement>('select')];
    const sortRow = selects.filter(
      (select) => select.parentElement?.classList.contains('settings__sort-row'),
    );
    expect(sortRow).toHaveLength(2);
    expect(sortRow[1]?.value).toBe('desc'); // mirrors the loaded settings

    sortRow[0]!.value = 'title';
    sortRow[0]!.dispatchEvent(new Event('change'));
    sortRow[1]!.value = 'asc';
    sortRow[1]!.dispatchEvent(new Event('change'));

    const save = button('Save changes*');
    save?.click();
    await waitFor(() => harness.patches.length > 0);
    expect(harness.patches[0]).toMatchObject({
      defaultSort: { field: 'title', direction: 'asc' },
    });
    harness.panel.dispose();
  });

  it('collects nested capture and AI drafts into one patch', async () => {
    const harness = mountPanel();
    harness.panel.open();
    const dialog = dialogOf();
    await waitFor(() => dialog.querySelector('.settings__panel'));

    // Toggle auto-capture off.
    const autoCapture = [...dialog.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
      (input) => input.parentElement?.textContent?.includes('Detect and archive pasted links'),
    );
    autoCapture?.click();

    // Change capture timeout (seconds input with suffix 'seconds').
    const timeoutInput = [...dialog.querySelectorAll<HTMLInputElement>('input[type="number"]')].find(
      (input) => input.parentElement?.textContent?.includes('seconds') && input.value === '45',
    );
    if (timeoutInput) {
      timeoutInput.value = '60';
      timeoutInput.dispatchEvent(new Event('change'));
    }

    // Enable AI.
    const aiToggle = [...dialog.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
      (input) => input.parentElement?.textContent?.includes('Enable AI features'),
    );
    aiToggle?.click();

    const save = button('Save changes*');
    save?.click();
    await waitFor(() => harness.patches.length > 0);
    expect(harness.patches[0]).toMatchObject({
      autoCaptureOnPaste: false,
      capture: { timeoutMs: 60_000 },
      ai: { enabled: true },
    });
    harness.panel.dispose();
  });

  it('collects toolbar group toggles under editor.toolbar', async () => {
    const harness = mountPanel();
    harness.panel.open();
    const dialog = dialogOf();
    await waitFor(() => dialog.querySelector('.settings__panel'));

    const tableToggle = [...dialog.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
      (input) => input.parentElement?.textContent === 'table',
    );
    tableToggle?.click();

    const save = button('Save changes*');
    save?.click();
    await waitFor(() => harness.patches.length > 0);
    expect(harness.patches[0]).toMatchObject({ editor: { toolbar: { table: false } } });
    harness.panel.dispose();
  });

  it('revokes granted origins immediately with an announcement', async () => {
    const harness = mountPanel();
    harness.panel.open();
    const dialog = dialogOf();
    await waitFor(() => dialog.querySelector('.settings__origin'));

    const revoke = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Revoke');
    revoke?.click();
    await waitFor(() => harness.revoked.length > 0);
    expect(harness.revoked).toEqual(['https://example.com']);
    await waitFor(() => dialog.querySelector('.settings__origin') === null);
    expect(harness.announced).toContain('Access to https://example.com revoked.');
    harness.panel.dispose();
  });

  it('shows a truthful LM Studio connection test result and the MCP disclosure', async () => {
    const harness = mountPanel();
    harness.panel.open();
    const dialog = dialogOf();
    await waitFor(() => dialog.querySelector('.settings__panel'));

    const test = button('Test connection');
    test?.click();
    await waitFor(() => {
      const hints = [...dialog.querySelectorAll('.settings__hint')];
      return hints.some((hint) => hint.textContent?.includes('Connected in 9 ms'));
    });
    expect(dialog.textContent).toContain('no external MCP server');
    expect(dialog.textContent).toContain('Loopback only (127.0.0.1 or localhost)');
    harness.panel.dispose();
  });

  it('keeps the draft dirty and announces when saving fails', async () => {
    const harness = mountPanel();
    harness.panel.open();
    const dialog = dialogOf();
    await waitFor(() => dialog.querySelector('.settings__panel'));

    harness.failPatch(true);

    const autoCapture = [...dialog.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
      (input) => input.parentElement?.textContent?.includes('Detect and archive pasted links'),
    );
    autoCapture?.click();
    const save = button('Save changes*');
    save?.click();
    await waitFor(() => harness.announced.length > 0);
    expect(harness.announced[0]).toContain('Settings were not saved');
    const saveAfter = button('Save changes*');
    expect(saveAfter?.disabled).toBe(false);
    harness.panel.dispose();
  });

  it('shows an honest error state when settings cannot be read', async () => {
    const harness = mountPanel();
    harness.setSettings(null as unknown as AppSettings);
    harness.panel.open();
    const dialog = dialogOf();
    await waitFor(() => dialog.querySelector('.diagnostics__error'));
    const error = dialog.querySelector('.diagnostics__error');
    expect(error?.textContent).toContain('Settings could not be read');
    harness.panel.dispose();
  });
});
