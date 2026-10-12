/**
 * Registers every RPC handler the service worker serves today. Feature areas
 * that land in later tasks (capture, AI tools, backup, diagnostics) register
 * their own modules here as they arrive.
 */

import type { MessageRouter } from '../router';
import { registerNoteApi } from './notes';
import { registerOrganizationApi } from './organization';
import { registerLinkApi } from './links';
import { registerAttachmentApi } from './attachments';
import { registerSearchApi } from './search';
import { registerSettingsApi } from './settings';
import { registerReminderApi } from './reminders';
import { registerPermissionApi } from './permissions';

export function registerAllApi(router: MessageRouter): void {
  registerNoteApi(router);
  registerOrganizationApi(router);
  registerLinkApi(router);
  registerAttachmentApi(router);
  registerSearchApi(router);
  registerSettingsApi(router);
  registerReminderApi(router);
  registerPermissionApi(router);
}
