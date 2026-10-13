/**
 * Diagnostics panel (T-038, FR-LOG-05 / FR-SET-04): a modal view over every
 * operational signal the PRD's diagnostics page requires — build and Chrome
 * versions, database schema, storage usage, search index status, granted
 * permissions, notification status, LM Studio configuration with a live
 * connection test, last capture failures and recent sanitized errors, the
 * audit trail, and the network privacy self-test. "Export diagnostics" is
 * opt-in with a review step: the exact bundle that would leave the device is
 * shown before the (user-initiated, local) download — nothing is uploaded.
 *
 * The panel is transport-agnostic: the dashboard injects the RPC calls, so
 * unit tests drive it without chrome.
 */

import type {
  DiagnosticsExport,
  DiagnosticsOverview,
  NetworkSelfTestResult,
  NetworkPrivacyCheck,
} from '../../background/api/diagnostics';
import type { ConnectionTestResult } from '../../background/ai/client';
import type { AuditEvent, DiagnosticLog } from '../../core/types';

export interface DiagnosticsPanelCallbacks {
  overview(): Promise<DiagnosticsOverview>;
  /** Newest-first audit trail (panel requests 20). */
  auditTrail(): Promise<{ events: AuditEvent[]; total: number }>;
  networkSelfTest(): Promise<NetworkSelfTestResult>;
  /** The exact bundle the export download would contain. */
  exportBundle(): Promise<DiagnosticsExport>;
  testLmStudio(): Promise<ConnectionTestResult>;
  rebuildSearchIndex(): Promise<{ indexed: number }>;
  announce(message: string): void;
}

export interface DiagnosticsPanel {
  open(): void;
  dispose(): void;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 'B';
  for (const next of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = next;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${unit}`;
}

function row(label: string, value: string): HTMLDListElement {
  const item = document.createElement('div');
  item.className = 'diagnostics__row';
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = value;
  item.append(dt, dd);
  const list = document.createElement('dl');
  list.className = 'diagnostics__list';
  list.append(item);
  return list;
}

function sectionHeading(panel: HTMLDivElement, text: string): HTMLHeadingElement {
  const heading = document.createElement('h3');
  heading.className = 'diagnostics__section-title';
  heading.textContent = text;
  panel.append(heading);
  return heading;
}

function logRow(entry: DiagnosticLog): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'diagnostics__log';
  const time = document.createElement('time');
  time.dateTime = entry.at;
  time.textContent = entry.at.replace('T', ' ').replace(/\.\d+Z$/, 'Z');
  const level = document.createElement('span');
  level.className = 'diagnostics__level';
  level.textContent = entry.level.toUpperCase();
  level.dataset['level'] = entry.level;
  const text = document.createElement('span');
  text.className = 'diagnostics__log-text';
  text.textContent = `${entry.component}/${entry.operationId}: ${entry.message}`;
  item.append(time, level, text);
  return item;
}

function auditRow(event: AuditEvent): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'diagnostics__audit';
  const time = document.createElement('time');
  time.dateTime = event.at;
  time.textContent = event.at.replace('T', ' ').replace(/\.\d+Z$/, 'Z');
  const actor = document.createElement('span');
  actor.className = 'diagnostics__actor';
  actor.dataset['actor'] = event.actor;
  actor.textContent = event.actor === 'ai' ? 'AI' : 'User';
  const text = document.createElement('span');
  text.className = 'diagnostics__log-text';
  const fields =
    event.changedFields.length > 0 ? ` [${event.changedFields.join(', ')}]` : '';
  text.textContent = `${event.action}${fields} — ${event.outcome}`;
  item.append(time, actor, text);
  return item;
}

function checkRow(check: NetworkPrivacyCheck): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'diagnostics__check';
  item.dataset['passed'] = String(check.passed);
  const marker = document.createElement('span');
  marker.className = 'diagnostics__check-marker';
  marker.setAttribute('aria-hidden', 'true');
  marker.textContent = check.passed ? 'PASS' : 'FAIL';
  const body = document.createElement('span');
  body.className = 'diagnostics__log-text';
  const label = document.createElement('span');
  label.className = 'diagnostics__check-label';
  label.textContent = check.label;
  const detail = document.createElement('span');
  detail.className = 'diagnostics__check-detail';
  detail.textContent = check.detail;
  body.append(label, detail);
  item.append(marker, body);
  return item;
}

function emptyRow(text: string): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'diagnostics__empty';
  item.textContent = text;
  return item;
}

export function createDiagnosticsPanel(callbacks: DiagnosticsPanelCallbacks): DiagnosticsPanel {
  const dialog = document.createElement('dialog');
  dialog.className = 'dialog dialog--diagnostics';
  dialog.setAttribute('aria-labelledby', 'diagnostics-title');

  const heading = document.createElement('h2');
  heading.id = 'diagnostics-title';
  heading.textContent = 'Diagnostics';

  const intro = document.createElement('p');
  intro.className = 'diagnostics__intro';
  intro.textContent =
    'Everything here is read from this device. Exporting shows the exact content first — nothing is uploaded.';

  const content = document.createElement('div');
  content.className = 'diagnostics__content';
  content.setAttribute('aria-busy', 'true');
  content.textContent = 'Loading diagnostics…';

  const actions = document.createElement('div');
  actions.className = 'dialog__actions diagnostics__actions';

  const refreshButton = document.createElement('button');
  refreshButton.type = 'button';
  refreshButton.className = 'btn';
  refreshButton.textContent = 'Refresh';
  refreshButton.disabled = true;

  const selfTestButton = document.createElement('button');
  selfTestButton.type = 'button';
  selfTestButton.className = 'btn';
  selfTestButton.textContent = 'Run network privacy self-test';
  selfTestButton.disabled = true;

  const exportButton = document.createElement('button');
  exportButton.type = 'button';
  exportButton.className = 'btn';
  exportButton.textContent = 'Export diagnostics…';
  exportButton.disabled = true;

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'btn btn--primary';
  closeButton.textContent = 'Close';

  actions.append(refreshButton, selfTestButton, exportButton, closeButton);
  dialog.append(heading, intro, content, actions);
  document.body.append(dialog);

  let disposed = false;
  let loadToken = 0;

  const setError = (message: string): void => {
    content.setAttribute('aria-busy', 'false');
    content.replaceChildren();
    const paragraph = document.createElement('p');
    paragraph.className = 'diagnostics__error';
    paragraph.textContent = message;
    content.append(paragraph);
    refreshButton.disabled = false;
    selfTestButton.disabled = true;
    exportButton.disabled = true;
  };

  /** The full read: overview + audit trail. */
  const load = async (): Promise<void> => {
    const token = ++loadToken;
    content.setAttribute('aria-busy', 'true');
    content.textContent = 'Loading diagnostics…';
    refreshButton.disabled = true;
    selfTestButton.disabled = true;
    exportButton.disabled = true;
    try {
      const [overview, audit] = await Promise.all([callbacks.overview(), callbacks.auditTrail()]);
      if (disposed || token !== loadToken) return;
      render(overview, audit.events, audit.total);
    } catch (error) {
      if (disposed || token !== loadToken) return;
      setError(
        `Diagnostics could not be read (${error instanceof Error ? error.message : 'unknown error'}). ` +
          'The note database is unaffected; try Refresh.',
      );
    }
  };

  const appendStorage = (panel: HTMLDivElement, overview: DiagnosticsOverview): void => {
    sectionHeading(panel, 'Storage');
    const storage = overview.storage;
    const quotaText = storage.quota
      ? `${formatBytes(storage.quota.usage)} used of ${formatBytes(storage.quota.quota)} quota`
      : 'usage estimate unavailable in this browser';
    panel.append(
      row('Storage quota', quotaText),
      row(
        'Persistent storage',
        storage.persisted === null ? 'not queryable' : storage.persisted ? 'granted' : 'not granted',
      ),
      row('MHTML archives', formatBytes(storage.blobKinds.mhtml)),
      row('PNG screenshots', formatBytes(storage.blobKinds.png)),
      row('Attachments', formatBytes(storage.blobKinds.attachments)),
      row('Diagnostic logs', `${storage.logEntries} entries (${formatBytes(storage.logBytes)})`),
      row(
        'Records',
        `${storage.counts.notes} notes · ${storage.counts.snapshots} snapshots · ` +
          `${storage.counts.attachments} attachments · ${storage.counts.reminders} reminders · ` +
          `${storage.counts.revisions} revisions · ${storage.counts.auditEvents} audit events`,
      ),
    );
    if (storage.warning.active) {
      const warning = document.createElement('p');
      warning.className = 'diagnostics__warning';
      warning.textContent = `Storage warning: ${storage.warning.detail}`;
      panel.append(warning);
    }
  };

  const render = (overview: DiagnosticsOverview, auditEvents: AuditEvent[], auditTotal: number): void => {
    content.setAttribute('aria-busy', 'false');
    content.replaceChildren();

    const panel = document.createElement('div');
    panel.className = 'diagnostics__panel';

    sectionHeading(panel, 'Environment');
    panel.append(
      row('Extension', `${overview.app.name} ${overview.app.version}`),
      row('Database', `${overview.app.databaseName} (schema v${overview.app.schemaVersion})`),
      row('Chrome', overview.chrome.version ? `version ${overview.chrome.version}` : 'version unknown'),
      row('Minimum supported Chrome', `${overview.app.minChromeVersion}`),
    );

    appendStorage(panel, overview);

    sectionHeading(panel, 'Search index');
    const indexRow = row('Indexed documents', String(overview.searchIndex.documentCount));
    panel.append(indexRow);
    const rebuildButton = document.createElement('button');
    rebuildButton.type = 'button';
    rebuildButton.className = 'btn btn--ghost';
    rebuildButton.textContent = 'Rebuild search index';
    rebuildButton.addEventListener('click', () => {
      rebuildButton.disabled = true;
      rebuildButton.textContent = 'Rebuilding…';
      void callbacks
        .rebuildSearchIndex()
        .then((result) => {
          callbacks.announce(`Search index rebuilt (${result.indexed} documents).`);
          void load();
        })
        .catch(() => {
          rebuildButton.disabled = false;
          rebuildButton.textContent = 'Rebuild search index';
          callbacks.announce('Search index rebuild failed.');
        });
    });
    panel.append(rebuildButton);

    sectionHeading(panel, 'Permissions');
    panel.append(
      row('Required permissions', overview.permissions.required.join(', ')),
      row('Required host access (loopback)', overview.permissions.hostPatterns.join(', ') || 'none'),
      row('Optional capture hosts (user grants)', overview.permissions.optionalHostPatterns.join(', ')),
      row(
        'Granted origins',
        overview.permissions.grantedOrigins.length === 0
          ? 'none'
          : overview.permissions.grantedOrigins
              .map((origin) => `${origin.origin} (${origin.linkCount} links)`)
              .join(', '),
      ),
    );

    sectionHeading(panel, 'Notifications');
    panel.append(
      row(
        'Browser notifications',
        overview.notifications.settingEnabled ? 'enabled in settings' : 'disabled in settings',
      ),
      row(
        'OS-level notification level',
        'not queryable from an extension — if reminders seem silent, check Chrome and OS notification settings',
      ),
    );

    sectionHeading(panel, 'LM Studio (local AI)');
    const loopbackNote = document.createElement('p');
    loopbackNote.className = 'diagnostics__note';
    loopbackNote.textContent = overview.ai.loopback
      ? `Endpoint ${overview.ai.baseUrl} is loopback.`
      : `Endpoint ${overview.ai.baseUrl} is NOT loopback — the client refuses non-loopback endpoints.`;
    panel.append(
      row('AI features', overview.ai.enabled ? 'enabled' : 'disabled'),
      row('Endpoint', overview.ai.baseUrl || 'not configured'),
      row('Model', overview.ai.model ?? 'not selected'),
      row('Permission mode', overview.ai.permissionMode),
      loopbackNote,
    );
    const testButton = document.createElement('button');
    testButton.type = 'button';
    testButton.className = 'btn btn--ghost';
    testButton.textContent = 'Test LM Studio connection';
    const testResult = document.createElement('p');
    testResult.className = 'diagnostics__note';
    testResult.textContent = '';
    testButton.addEventListener('click', () => {
      testButton.disabled = true;
      testResult.textContent = 'Testing…';
      void callbacks
        .testLmStudio()
        .then((result) => {
          testResult.textContent = result.ok
            ? `Connected (${result.latencyMs} ms, ${result.models.length} models).`
            : `Unreachable: ${result.errorMessage ?? 'unknown error'} — AI features stay disabled, everything else works.`;
        })
        .catch((error: unknown) => {
          testResult.textContent = `Unreachable: ${error instanceof Error ? error.message : 'unknown error'}`;
        })
        .finally(() => {
          testButton.disabled = false;
        });
    });
    panel.append(testButton, testResult);

    sectionHeading(panel, 'Last capture failures');
    const failures = document.createElement('ul');
    failures.className = 'diagnostics__logs';
    if (overview.recentCaptureFailures.length === 0) {
      failures.append(emptyRow('No capture failures recorded.'));
    } else {
      for (const entry of overview.recentCaptureFailures) failures.append(logRow(entry));
    }
    panel.append(failures);

    sectionHeading(panel, 'Recent errors');
    const errors = document.createElement('ul');
    errors.className = 'diagnostics__logs';
    if (overview.recentErrors.length === 0) {
      errors.append(emptyRow('No errors recorded.'));
    } else {
      for (const entry of overview.recentErrors) errors.append(logRow(entry));
    }
    panel.append(errors);

    sectionHeading(panel, `Audit trail (latest ${auditEvents.length} of ${auditTotal})`);
    const auditList = document.createElement('ul');
    auditList.className = 'diagnostics__logs';
    if (auditEvents.length === 0) {
      auditList.append(emptyRow('No audit events yet.'));
    } else {
      for (const event of auditEvents) auditList.append(auditRow(event));
    }
    panel.append(auditList);

    const selfTestRegion = document.createElement('div');
    selfTestRegion.className = 'diagnostics__selftest';
    selfTestRegion.hidden = true;
    panel.append(selfTestRegion);

    content.append(panel);
    refreshButton.disabled = false;
    selfTestButton.disabled = false;
    exportButton.disabled = false;

    selfTestButton.onclick = (): void => {
      selfTestButton.disabled = true;
      selfTestRegion.hidden = false;
      selfTestRegion.replaceChildren();
      const loading = document.createElement('p');
      loading.className = 'diagnostics__note';
      loading.textContent = 'Running self-test…';
      selfTestRegion.append(loading);
      void callbacks
        .networkSelfTest()
        .then((result) => {
          const title = document.createElement('h3');
          title.className = 'diagnostics__section-title';
          title.textContent =
            result.passed ? 'Network privacy self-test: PASSED' : 'Network privacy self-test: FAILED';
          const list = document.createElement('ul');
          list.className = 'diagnostics__checks';
          for (const item of result.checks) list.append(checkRow(item));
          const scope = document.createElement('p');
          scope.className = 'diagnostics__note';
          scope.textContent = result.scope;
          selfTestRegion.replaceChildren(title, list, scope);
          callbacks.announce(
            result.passed
              ? 'Network privacy self-test passed.'
              : 'Network privacy self-test failed — see diagnostics for details.',
          );
        })
        .catch((error: unknown) => {
          const failure = document.createElement('p');
          failure.className = 'diagnostics__error';
          failure.textContent = `Self-test could not run: ${error instanceof Error ? error.message : 'unknown error'}`;
          selfTestRegion.replaceChildren(failure);
        })
        .finally(() => {
          selfTestButton.disabled = false;
        });
    };
  };

  /** FR-LOG-05 review step: show the exact bundle before downloading. */
  const runExportFlow = (): void => {
    exportButton.disabled = true;
    exportButton.textContent = 'Preparing…';
    void callbacks
      .exportBundle()
      .then((bundle) => {
        if (disposed) return;
        const review = document.createElement('dialog');
        review.className = 'dialog dialog--review';
        review.setAttribute('aria-labelledby', 'diagnostics-review-title');

        const title = document.createElement('h2');
        title.id = 'diagnostics-review-title';
        title.textContent = 'Review diagnostics export';

        const intro = document.createElement('p');
        intro.className = 'diagnostics__intro';
        intro.textContent =
          'This is the exact file the download would contain — versions, storage sizes, permission ' +
          'state, recent sanitized logs and audit events. No note bodies or archived page content are ' +
          'included. Review it, then download or cancel.';

        const pre = document.createElement('pre');
        pre.className = 'diagnostics__review';
        pre.setAttribute('aria-label', 'Diagnostics export content preview');
        pre.textContent = JSON.stringify(bundle, null, 2);

        const reviewActions = document.createElement('div');
        reviewActions.className = 'dialog__actions';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn';
        cancel.textContent = 'Cancel';
        const download = document.createElement('button');
        download.type = 'button';
        download.className = 'btn btn--primary';
        download.textContent = 'Download JSON';
        reviewActions.append(cancel, download);

        review.append(title, intro, pre, reviewActions);
        document.body.append(review);
        review.showModal();

        const closeReview = (): void => {
          review.close();
          review.remove();
        };
        cancel.addEventListener('click', closeReview);
        review.addEventListener('cancel', (event) => {
          event.preventDefault();
          closeReview();
        });
        download.addEventListener('click', () => {
          const blob = new Blob([JSON.stringify(bundle, null, 2)], {
            type: 'application/json',
          });
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = `diagnostics-${bundle.exportedAt.replace(/[:.]/g, '-')}.json`;
          document.body.append(anchor);
          anchor.click();
          anchor.remove();
          window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
          callbacks.announce('Diagnostics file downloaded.');
          closeReview();
        });
      })
      .catch((error: unknown) => {
        callbacks.announce('Diagnostics export could not be prepared.');
        void error;
      })
      .finally(() => {
        exportButton.disabled = false;
        exportButton.textContent = 'Export diagnostics…';
      });
  };
  exportButton.addEventListener('click', runExportFlow);

  refreshButton.addEventListener('click', () => void load());
  closeButton.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    // Stale loads must not render into a closed dialog.
    loadToken++;
  });

  return {
    open(): void {
      if (!dialog.open) dialog.showModal();
      void load();
    },
    dispose(): void {
      disposed = true;
      loadToken++;
      dialog.remove();
    },
  };
}
