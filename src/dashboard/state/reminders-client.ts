/**
 * RemindersApi factory (T-027): the RPC-backed reminder operations shared by
 * the dashboard controller and the editor-session test stacks — one wiring,
 * no drift between production and tests.
 */

import type { ApiClient } from './client';
import type { RemindersApi } from './editor-session';

export function createRemindersApi(client: ApiClient): RemindersApi {
  return {
    listForNote: async (noteId) =>
      (await client.request('reminders/list-for-note', { noteId })).reminders,
    create: async (input) => (await client.request('reminders/create', input)).reminder,
    updateRule: async (reminderId, patch) =>
      (await client.request('reminders/update-rule', { reminderId, ...patch })).reminder,
    complete: async (reminderId) => {
      try {
        await client.request('reminders/complete', { reminderId });
        return true;
      } catch {
        return false;
      }
    },
    dismiss: async (reminderId) => {
      try {
        await client.request('reminders/dismiss', { reminderId });
        return true;
      } catch {
        return false;
      }
    },
    stop: async (reminderId) => {
      try {
        await client.request('reminders/stop', { reminderId });
        return true;
      } catch {
        return false;
      }
    },
    snooze: async (reminderId, until) => {
      try {
        await client.request('reminders/snooze', { reminderId, until });
        return true;
      } catch {
        return false;
      }
    },
    remove: async (reminderId) => {
      try {
        await client.request('reminders/delete', { reminderId });
        return true;
      } catch {
        return false;
      }
    },
  };
}
