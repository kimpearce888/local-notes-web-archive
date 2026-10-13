/**
 * Backup API (FR-DATA-03/04/05): complete ZIP export (user-initiated
 * download only — nothing is uploaded), archive preview and validated
 * restore with merge/replace modes. Replace refuses to run without an
 * explicit confirmation. Every attempt is audited (FR-LOG-02) and failed
 * validations leave a structured error log (FR-LOG-01).
 */

import type { MessageRouter } from '../router';
import { exportBackup } from '../backup/export';
import { previewRestore, restoreBackup } from '../backup/restore';
import { auditUserAction, logOperation } from '../observability';
import { asBoolean, asEnum, asObject } from './validate';
import { PayloadValidationError } from '../protocol';

export function registerBackupApi(router: MessageRouter): void {
  router.register('backup/export', async (_payload, ctx) => {
    const result = await exportBackup();
    await auditUserAction({
      action: 'backup/export',
      targetKind: 'backup',
      outcome: 'succeeded',
      detail:
        `exported ${result.counts.notes} note(s), ${result.counts.reminders} reminder(s), ` +
        `${result.counts.snapshots} snapshot(s), ${result.counts.attachments} attachment(s)`,
      correlationId: ctx.correlationId,
    });
    return { blob: result.blob, filename: result.filename, counts: result.counts, exportedAt: result.exportedAt };
  });

  router.register('backup/preview', async (payload, ctx) => {
    const p = asObject(payload, 'backup/preview');
    const blob = p['archive'];
    if (!(blob instanceof Blob)) {
      throw new PayloadValidationError('archive: expected the backup file (a Blob)');
    }
    try {
      const preview = await previewRestore(blob);
      return { preview };
    } catch (error) {
      // Validation failures are expected user input problems: audited as a
      // failed attempt with the coded reason, never with archive content.
      const reason = error instanceof Error ? error.message : 'unknown validation failure';
      await auditUserAction({
        action: 'backup/preview',
        targetKind: 'backup',
        outcome: 'failed',
        detail: `archive rejected: ${reason}`,
        correlationId: ctx.correlationId,
      });
      throw error;
    }
  });

  router.register('backup/restore', async (payload, ctx) => {
    const p = asObject(payload, 'backup/restore');
    const blob = p['archive'];
    if (!(blob instanceof Blob)) {
      throw new PayloadValidationError('archive: expected the backup file (a Blob)');
    }
    const mode = asEnum(p['mode'], 'mode', ['merge', 'replace']);
    const confirmReplace = p['confirmReplace'] === undefined ? false : asBoolean(p['confirmReplace'], 'confirmReplace');
    // Replace without explicit confirmation is a refusal, not a failure
    // (FR-DATA-04): audited as denied so the trail shows the guard worked.
    if (mode === 'replace' && confirmReplace !== true) {
      await auditUserAction({
        action: 'backup/restore',
        targetKind: 'backup',
        outcome: 'denied',
        detail: 'replace mode refused: explicit confirmation missing',
        correlationId: ctx.correlationId,
      });
    }
    try {
      const result = await restoreBackup(blob, { mode, confirmReplace });
      await auditUserAction({
        action: 'backup/restore',
        targetKind: 'backup',
        outcome: 'succeeded',
        changedFields: ['database'],
        detail:
          `${mode} restore imported ${result.imported.notes} note(s), ` +
          `${result.imported.reminders} reminder(s), ${result.imported.snapshots} snapshot(s), ` +
          `${result.imported.blobs} blob(s)`,
        correlationId: ctx.correlationId,
      });
      return { result };
    } catch (error) {
      // The DB is untouched on any validation failure (FR-DATA-04) — the
      // audit + error log record exactly what was rejected and why. The
      // confirmation refusal was already audited as `denied` above.
      if (mode === 'replace' && confirmReplace !== true) {
        throw error;
      }
      // The DB is untouched on any validation failure (FR-DATA-04) — the
      // audit + error log record exactly what was rejected and why.
      const reason = error instanceof Error ? error.message : 'unknown restore failure';
      await auditUserAction({
        action: 'backup/restore',
        targetKind: 'backup',
        outcome: 'failed',
        detail: `${mode} restore rejected (database untouched): ${reason}`,
        correlationId: ctx.correlationId,
      });
      await logOperation({
        level: 'error',
        component: 'backup',
        operationId: 'backup/restore',
        correlationId: ctx.correlationId,
        resultCode: 'restore-rejected',
        message: reason,
      });
      throw error;
    }
  });
}
