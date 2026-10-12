/**
 * Install/update/startup lifecycle (PRD §8.1, FR-SET-02, FR-REM-04):
 *  - install: reset the onboarding flag and open the dashboard for the
 *    first-run walkthrough (local storage, permissions, data-loss risk).
 *  - install/update: reconcile reminder alarms from canonical records.
 *  - browser startup and worker startup: reconcile reminder alarms.
 * All flows degrade honestly: database failures are logged and surfaced,
 * never swallowed into fake success.
 */

import { openAppDatabase, repo } from './db';
import { openOrFocusDashboard } from './dashboard-tab';
import { reconcileReminderAlarms } from './alarms';
import { reconcileMissedReminders } from './reminders/fire';
import { getCaptureQueue } from './capture/pipeline';
import { setOnboardingComplete } from '../core/repo/settings';
import { appendLog } from '../core/repo/logs';
import { APP_VERSION } from '../core/version';

async function logLifecycle(operationId: string, resultCode: string, message: string): Promise<void> {
  try {
    await appendLog(await repo(), {
      level: 'info',
      component: 'background',
      operationId,
      resultCode,
      message,
    });
  } catch {
    // Logging must never block lifecycle work.
  }
}

/** chrome.runtime.onInstalled */
export async function handleRuntimeInstalled(details: chrome.runtime.InstalledDetails): Promise<void> {
  const reason = details.reason;
  if (reason === 'install') {
    await setOnboardingComplete(false);
    await logLifecycle('runtime-installed', 'install', `version ${APP_VERSION} installed`);
  } else if (reason === 'update') {
    await logLifecycle('runtime-installed', 'update', `updated to version ${APP_VERSION}`);
  } else {
    await logLifecycle('runtime-installed', reason, `reason ${reason}`);
  }

  if (reason === 'install' || reason === 'update') {
    try {
      await openAppDatabase();
      await reconcileReminderAlarms();
    } catch (error) {
      await logLifecycle(
        'runtime-installed',
        'database-failed',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  if (reason === 'install') {
    // First-run onboarding: the dashboard shows the walkthrough while the
    // flag is unset (FR-SET-02). Core flows stay usable without it.
    await openOrFocusDashboard();
  }
}

/** chrome.runtime.onStartup — browser launch. */
export async function handleBrowserStartup(): Promise<void> {
  try {
    await openAppDatabase();
    const result = await reconcileReminderAlarms();
    await logLifecycle(
      'browser-startup',
      'ok',
      `alarms scheduled=${result.scheduled} removed=${result.removed}`,
    );
  } catch (error) {
    await logLifecycle(
      'browser-startup',
      'database-failed',
      error instanceof Error ? error.message : String(error),
    );
    return; // No database — the missed pass cannot run honestly.
  }
  // FR-REM-05: occurrences missed while Chrome was closed are coalesced
  // into ONE concise notification; the reminders stay overdue in the
  // dashboard until the user acknowledges them.
  try {
    const missed = await reconcileMissedReminders();
    if (missed.missed.length > 0) {
      await logLifecycle(
        'browser-startup',
        'reminders-missed',
        `${missed.missed.length} overdue reminder(s); notification=${missed.notification}`,
      );
    }
  } catch (error) {
    await logLifecycle(
      'browser-startup',
      'missed-pass-failed',
      error instanceof Error ? error.message : String(error),
    );
  }
}

let workerStartupHandled = false;

/** Worker cold start (top-level). Idempotent within one worker lifetime. */
export async function handleWorkerStartup(): Promise<void> {
  if (workerStartupHandled) return;
  workerStartupHandled = true;
  try {
    await reconcileReminderAlarms();
  } catch {
    // Reconciliation failures are already visible through the RPC surface
    // (database-unavailable / migration-failed); retry on next start.
  }
  try {
    // Capture queue restart recovery (FR-CAP-03): links left `queued` by a
    // worker suspension resume on the next cold start.
    const requeued = await getCaptureQueue().requeueQueuedLinks();
    if (requeued > 0) {
      await logLifecycle('worker-startup', 'capture-requeued', `requeued ${requeued} capture job(s)`);
    }
  } catch {
    // A database hiccup at requeue time leaves links `queued`; the next
    // worker start retries. The queue itself fails links truthfully when
    // the database is unavailable mid-job.
  }
}

/** Test hook: reset the per-worker startup guard between scenarios. */
export function resetWorkerStartupGuard(): void {
  workerStartupHandled = false;
}
