/**
 * Backup API (FR-DATA-03/04/05): complete ZIP export (user-initiated
 * download only — nothing is uploaded), archive preview and validated
 * restore with merge/replace modes. Replace refuses to run without an
 * explicit confirmation.
 */

import type { MessageRouter } from '../router';
import { exportBackup } from '../backup/export';
import { previewRestore, restoreBackup } from '../backup/restore';
import { asBoolean, asEnum, asObject } from './validate';
import { PayloadValidationError } from '../protocol';

export function registerBackupApi(router: MessageRouter): void {
  router.register('backup/export', async () => {
    const result = await exportBackup();
    return { blob: result.blob, filename: result.filename, counts: result.counts, exportedAt: result.exportedAt };
  });

  router.register('backup/preview', async (payload) => {
    const p = asObject(payload, 'backup/preview');
    const blob = p['archive'];
    if (!(blob instanceof Blob)) {
      throw new PayloadValidationError('archive: expected the backup file (a Blob)');
    }
    const preview = await previewRestore(blob);
    return { preview };
  });

  router.register('backup/restore', async (payload) => {
    const p = asObject(payload, 'backup/restore');
    const blob = p['archive'];
    if (!(blob instanceof Blob)) {
      throw new PayloadValidationError('archive: expected the backup file (a Blob)');
    }
    const mode = asEnum(p['mode'], 'mode', ['merge', 'replace']);
    const confirmReplace = p['confirmReplace'] === undefined ? false : asBoolean(p['confirmReplace'], 'confirmReplace');
    const result = await restoreBackup(blob, { mode, confirmReplace });
    return { result };
  });
}
