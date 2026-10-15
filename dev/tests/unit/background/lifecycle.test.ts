import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addTab, installChromeMock, type InstalledMock } from './chrome-mock';
import { closeWorkerResources, repo } from '../../../../src/background/db';
import {
  handleBrowserStartup,
  handleRuntimeInstalled,
  handleWorkerStartup,
  resetWorkerStartupGuard,
} from '../../../../src/background/lifecycle';
import { dashboardUrl } from '../../../../src/background/dashboard-tab';
import { createNote } from '../../../../src/core/repo/notes';
import { createReminder } from '../../../../src/core/repo/reminders';
import { getOnboardingComplete, setOnboardingComplete } from '../../../../src/core/repo/settings';
import { reminderAlarmName } from '../../../../src/background/alarms';
import { DB_NAME } from '../../../../src/core/version';
import type { TimeZoneName, UtcTimestamp } from '../../../../src/core/types';

function isoIn(ms: number): UtcTimestamp {
  return new Date(Date.now() + ms).toISOString() as UtcTimestamp;
}

describe('runtime lifecycle (install/update/startup)', () => {
  let installed: InstalledMock;

  beforeEach(() => {
    installed = installChromeMock();
    resetWorkerStartupGuard();
  });

  afterEach(async () => {
    await closeWorkerResources();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
    installed.uninstall();
  });

  it('on install: onboarding stays armed on a fresh profile, alarms reconcile, dashboard opens', async () => {
    const when = isoIn(3600_000);
    const ctx = await repo();
    const note = await createNote(ctx, { title: 'host' });
    const reminder = await createReminder(ctx, {
      noteId: note.id,
      dueAt: when,
      recurrence: null,
      timeZone: 'UTC' as TimeZoneName,
      nextDueAt: when,
    });
    await closeWorkerResources(); // simulate a cold worker before install

    await handleRuntimeInstalled({ reason: 'install' } as chrome.runtime.InstalledDetails);

    expect(await getOnboardingComplete(await repo())).toBe(false);
    expect(installed.tabs.size).toBe(1);
    expect([...installed.tabs.values()][0]?.url).toBe(dashboardUrl());
    expect(installed.alarms.has(reminderAlarmName(reminder.id))).toBe(true);
  });

  it('on install over existing data: the completion flag is never reset (T-048)', async () => {
    await setOnboardingComplete(await repo(), true);
    await closeWorkerResources(); // simulate a cold worker before install

    await handleRuntimeInstalled({ reason: 'install' } as chrome.runtime.InstalledDetails);

    // Chrome re-fires onInstalled('install') whenever an unpacked extension
    // is reloaded over an existing profile — a returning user with existing
    // data must not see the first-run walkthrough again.
    expect(await getOnboardingComplete(await repo())).toBe(true);
    expect(installed.tabs.size).toBe(1);
  });

  it('on update: reconciles alarms without touching onboarding or opening tabs', async () => {
    await setOnboardingComplete(await repo(), true);
    const when = isoIn(3600_000);
    const ctx = await repo();
    const note = await createNote(ctx, { title: 'host' });
    const reminder = await createReminder(ctx, {
      noteId: note.id,
      dueAt: when,
      recurrence: null,
      timeZone: 'UTC' as TimeZoneName,
      nextDueAt: when,
    });
    await closeWorkerResources();

    await handleRuntimeInstalled({ reason: 'update' } as chrome.runtime.InstalledDetails);

    expect(await getOnboardingComplete(await repo())).toBe(true);
    expect(installed.tabs.size).toBe(0);
    expect(installed.alarms.has(reminderAlarmName(reminder.id))).toBe(true);
  });

  it('on browser startup: reconciles alarms from canonical records', async () => {
    const when = isoIn(1800_000);
    const ctx = await repo();
    const note = await createNote(ctx, { title: 'host' });
    const reminder = await createReminder(ctx, {
      noteId: note.id,
      dueAt: when,
      recurrence: null,
      timeZone: 'UTC' as TimeZoneName,
      nextDueAt: when,
    });
    await closeWorkerResources();

    await handleBrowserStartup();

    expect(installed.alarms.has(reminderAlarmName(reminder.id))).toBe(true);
  });

  it('worker startup runs once per worker lifetime', async () => {
    const when = isoIn(3600_000);
    const ctx = await repo();
    const note = await createNote(ctx, { title: 'host' });
    const reminder = await createReminder(ctx, {
      noteId: note.id,
      dueAt: when,
      recurrence: null,
      timeZone: 'UTC' as TimeZoneName,
      nextDueAt: when,
    });
    await closeWorkerResources();
    resetWorkerStartupGuard();

    await handleWorkerStartup();
    expect(installed.alarms.has(reminderAlarmName(reminder.id))).toBe(true);

    // Simulate a second top-level evaluation in the same worker: guarded.
    await handleWorkerStartup();
    const createCalls = (
      (globalThis as unknown as { chrome: { alarms: { create: { mock: { calls: unknown[][] } } } } })
        .chrome.alarms.create.mock.calls
    ).length;
    await handleWorkerStartup();
    const createCallsAfter = (
      (globalThis as unknown as { chrome: { alarms: { create: { mock: { calls: unknown[][] } } } } })
        .chrome.alarms.create.mock.calls
    ).length;
    expect(createCallsAfter).toBe(createCalls);
  });

  it('install with a database failure still opens onboarding truthfully', async () => {
    // Corrupt the database name resolution by occupying the DB with a
    // lower version: openDatabase will attempt migration and fail.
    // Simpler and equally honest: point the DB at an unopenable name by
    // deleting metadata is complex — instead verify the failure path via
    // a blocked open using two connections is covered in db tests. Here:
    // close resources and monkeypatch indexedDB.open to throw.
    const originalOpen = indexedDB.open.bind(indexedDB);
    (indexedDB as unknown as { open: unknown }).open = () => {
      throw new Error('simulated open failure');
    };
    await handleRuntimeInstalled({ reason: 'install' } as chrome.runtime.InstalledDetails);
    (indexedDB as unknown as { open: unknown }).open = originalOpen;

    // The DB-backed onboarding reset failed honestly (caught + logged
    // internally) and the first-run dashboard still opened — nothing threw.
    expect(installed.tabs.size).toBe(1);
    // No alarms could be scheduled — and none are reported.
    expect(installed.alarms.size).toBe(0);
  });
});

describe('dashboard tab focus during install', () => {
  let installed: InstalledMock;

  beforeEach(() => {
    installed = installChromeMock();
    resetWorkerStartupGuard();
  });

  afterEach(async () => {
    await closeWorkerResources();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
    installed.uninstall();
  });

  it('install focuses an already-open dashboard tab instead of duplicating', async () => {
    const tabId = addTab(installed, dashboardUrl());
    await handleRuntimeInstalled({ reason: 'install' } as chrome.runtime.InstalledDetails);
    expect(installed.tabs.size).toBe(1);
    const tab = installed.tabs.get(tabId);
    expect(tab?.active).toBe(true);
  });
});
