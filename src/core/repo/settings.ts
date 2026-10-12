import type { AppSettings } from '../types';
import { ONBOARDING_DONE_KEY, SETTINGS_KEY } from '../version';
import { Store } from '../db/schema';
import type { RepoContext } from './context';

/**
 * Settings repository (FR-DATA-01, FR-SET-01): the full AppSettings object is
 * canonical in IndexedDB (Settings store, single record). chrome.storage.local
 * holds only tiny extension flags (e.g. onboarding completion) that must be
 * readable before the database opens; the chrome-backed accessor is isolated
 * in `chromeFlags` so the repository itself stays testable.
 */

/** Defaults per PRD FR-SET-01 and §10. */
export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  viewMode: 'grid',
  defaultSort: { field: 'modified', direction: 'desc' },
  savedViews: [],
  autoCaptureOnPaste: true,
  allowedOrigins: [],
  capture: {
    maxArchiveBytes: 100 * 1024 * 1024,
    maxScreenshotPixels: 100_000_000,
    timeoutMs: 90_000,
  },
  duplicateCapture: 'ask',
  reminders: {
    notificationsEnabled: true,
    leapDayPolicy: 'feb-28',
  },
  editor: { toolbar: {} },
  revisionRetention: 20,
  backup: { warnAfterDays: 7 },
  ai: {
    enabled: false,
    baseUrl: 'http://127.0.0.1:1234/v1',
    model: null,
    timeoutMs: 60_000,
    permissionMode: 'ask-per-write',
  },
  logs: {
    maxBytes: 5 * 1024 * 1024,
    auditRetentionDays: 365,
  },
};

interface SettingsRecord {
  readonly key: string;
  readonly value: AppSettings;
}

export async function getSettings(ctx: RepoContext): Promise<AppSettings> {
  const record = await ctx.get<SettingsRecord>(Store.Settings, SETTINGS_KEY);
  if (!record) return { ...DEFAULT_SETTINGS };
  return mergeSettings(record.value);
}

export async function saveSettings(ctx: RepoContext, settings: AppSettings): Promise<void> {
  const record: SettingsRecord = { key: SETTINGS_KEY, value: settings };
  await ctx.transaction([Store.Settings], 'readwrite', (stores) => {
    stores[Store.Settings]?.put(record);
  });
}

/** Partial update merged onto current values. */
export async function patchSettings(
  ctx: RepoContext,
  patch: Partial<AppSettings>,
): Promise<AppSettings> {
  const current = await getSettings(ctx);
  const next = mergeSettings({ ...current, ...patch });
  await saveSettings(ctx, next);
  return next;
}

/**
 * Forward-compatible merge: persisted settings from an older build merge over
 * defaults so new fields always exist with valid values.
 */
export function mergeSettings(persisted: Partial<AppSettings>): AppSettings {
  const result: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...persisted,
    defaultSort: { ...DEFAULT_SETTINGS.defaultSort, ...persisted.defaultSort },
    capture: { ...DEFAULT_SETTINGS.capture, ...persisted.capture },
    reminders: { ...DEFAULT_SETTINGS.reminders, ...persisted.reminders },
    editor: { ...DEFAULT_SETTINGS.editor, ...persisted.editor },
    backup: { ...DEFAULT_SETTINGS.backup, ...persisted.backup },
    ai: { ...DEFAULT_SETTINGS.ai, ...persisted.ai },
    logs: { ...DEFAULT_SETTINGS.logs, ...persisted.logs },
    savedViews: persisted.savedViews ?? [],
    allowedOrigins: persisted.allowedOrigins ?? [],
  };
  validateSettings(result);
  return result;
}

function validateSettings(settings: AppSettings): void {
  if (settings.revisionRetention < 20) {
    throw new Error('revisionRetention must be at least 20 (FR-NOTE-06)');
  }
  if (settings.capture.maxArchiveBytes < 1024) {
    throw new Error('capture.maxArchiveBytes must be at least 1 KB');
  }
  if (settings.logs.maxBytes < 1024) {
    throw new Error('logs.maxBytes must be at least 1 KB');
  }
  const baseUrl = settings.ai.baseUrl;
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/v1$/.test(baseUrl)) {
    throw new Error('ai.baseUrl must be a loopback http://127.0.0.1:<port>/v1 URL (FR-AI-01)');
  }
  if (!['read-only', 'ask-per-write', 'safe-writes'].includes(settings.ai.permissionMode)) {
    throw new Error('ai.permissionMode is invalid');
  }
}

/**
 * chrome.storage.local flag access (onboarding). Kept separate from the
 * database path; returns false when the chrome API is unavailable (tests).
 */
export async function getOnboardingComplete(): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return false;
  return new Promise<boolean>((resolve) => {
    chrome.storage.local.get([ONBOARDING_DONE_KEY], (result) => {
      resolve(result[ONBOARDING_DONE_KEY] === true);
    });
  });
}

export async function setOnboardingComplete(value: boolean): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  await new Promise<void>((resolve) => {
    chrome.storage.local.set({ [ONBOARDING_DONE_KEY]: value }, () => resolve());
  });
}
