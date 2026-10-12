/**
 * Settings and app-status API (FR-SET-01, FR-DATA-01): the canonical
 * AppSettings record plus the small chrome.storage flags that must be
 * readable before the database opens, and the command-shortcut status
 * (PRD §4.1 — the default must be verifiable and user-reassignable).
 */

import type { MessageRouter } from '../router';
import { repo } from '../db';
import { getSettings, patchSettings, getOnboardingComplete, setOnboardingComplete } from '../../core/repo/settings';
import { APP_VERSION, APP_NAME, MIN_CHROME_VERSION, SCHEMA_VERSION } from '../../core/version';
import { DatabaseUnavailableError, MigrationFailedError } from '../../core/db/open';
import { PayloadValidationError } from '../protocol';
import { asObject, asOptionalString } from './validate';

/** Chrome's suggested default for opening the dashboard (PRD §4.1). */
export const SUGGESTED_OPEN_DASHBOARD_SHORTCUT = 'Alt+Shift+N';

export interface CommandStatus {
  readonly openDashboard: string | null;
  readonly createNote: string | null;
  readonly suggested: string;
  /** True when the suggested default could not be assigned (conflict). */
  readonly suggestedMissing: boolean;
}

/**
 * Read the actually-bound shortcuts. Chrome assigns `suggested_key` values
 * only when no conflict exists; a null shortcut means the user must set one
 * in chrome://extensions/shortcuts — surfaced truthfully instead of assuming.
 */
export async function readCommandStatus(): Promise<CommandStatus> {
  const commands = await chrome.commands.getAll();
  const find = (name: string): string | null => {
    const command = commands.find((c) => c.name === name);
    return command?.shortcut && command.shortcut.length > 0 ? command.shortcut : null;
  };
  const openDashboard = find('_execute_action');
  return {
    openDashboard,
    createNote: find('create-note'),
    suggested: SUGGESTED_OPEN_DASHBOARD_SHORTCUT,
    suggestedMissing: openDashboard === null,
  };
}

export function registerSettingsApi(router: MessageRouter): void {
  router.register('settings/get', async () => {
    const settings = await getSettings(await repo());
    return { settings };
  });

  /**
   * Partial settings update. The repository merges over current values and
   * validates the full record (loopback-only AI URLs, retention floors,
   * budgets) — invalid input surfaces as invalid-request, never persists.
   */
  router.register('settings/patch', async (payload) => {
    const p = asObject(payload, 'settings/patch');
    const patch = p['patch'];
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
      throw new PayloadValidationError('settings/patch: patch must be an object');
    }
    try {
      const settings = await patchSettings(await repo(), patch as Record<string, never>);
      return { settings };
    } catch (error) {
      // Infrastructure failures keep their own coded mapping.
      if (error instanceof DatabaseUnavailableError || error instanceof MigrationFailedError) {
        throw error;
      }
      // Repository validation (loopback-only AI URLs, retention floors,
      // budgets) rejects semantically invalid patches as invalid-request.
      throw new PayloadValidationError(
        error instanceof Error ? error.message : 'settings/patch: validation failed',
      );
    }
  });

  router.register('settings/get-onboarding-complete', async () => {
    const complete = await getOnboardingComplete();
    return { complete };
  });

  router.register('settings/set-onboarding-complete', async (payload) => {
    const p = asObject(payload, 'settings/set-onboarding-complete');
    const complete = p['complete'];
    if (typeof complete !== 'boolean') {
      throw new PayloadValidationError('settings/set-onboarding-complete: complete must be a boolean');
    }
    await setOnboardingComplete(complete);
    return { complete };
  });

  router.register('commands/status', async () => readCommandStatus());

  /** Channel probe used by the dashboard before first use. */
  router.register('app/ping', async (payload) => {
    const p = asObject(payload, 'app/ping');
    asOptionalString(p['probe'], 'probe', { maxLength: 100 });
    return {
      pong: true,
      app: APP_NAME,
      version: APP_VERSION,
      minChromeVersion: MIN_CHROME_VERSION,
      schemaVersion: SCHEMA_VERSION,
    };
  });
}
