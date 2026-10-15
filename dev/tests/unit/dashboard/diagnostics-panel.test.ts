// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDiagnosticsPanel } from '../../../../src/dashboard/views/diagnostics-panel';
import type {
  DiagnosticsExport,
  DiagnosticsOverview,
  NetworkSelfTestResult,
} from '../../../../src/background/api/diagnostics';
import type { ConnectionTestResult } from '../../../../src/background/ai/client';
import type { AuditEvent, DiagnosticLog, EntityId, UtcTimestamp } from '../../../../src/core/types';

/**
 * T-038 diagnostics panel UI (FR-LOG-05 / FR-SET-04): honest loading and
 * error states, all sections render from the overview, the network
 * self-test lists PASS/FAIL checks, and the export flow shows the exact
 * bundle for review before the download is offered.
 */

const overview: DiagnosticsOverview = {
  app: {
    name: 'Local Notes & Web Archive',
    version: '1.0.0',
    schemaVersion: 2,
    minChromeVersion: 120,
    databaseName: 'local-notes-web-archive',
  },
  chrome: { version: '126.0.6478.62' },
  storage: {
    quota: { usage: 1024, quota: 10 * 1024 * 1024 * 1024 },
    persisted: true,
    blobKinds: { mhtml: 2048, png: 512, attachments: 0 },
    blobBytesTotal: 2560,
    logEntries: 2,
    logBytes: 300,
    counts: {
      notes: 3,
      snapshots: 1,
      attachments: 0,
      reminders: 2,
      revisions: 5,
      auditEvents: 4,
    },
    warning: { active: false, detail: '' },
  },
  searchIndex: { documentCount: 3 },
  permissions: {
    required: ['storage', 'pageCapture', 'debugger'],
    hostPatterns: ['http://127.0.0.1/*', 'http://localhost/*'],
    optionalHostPatterns: ['http://*/*', 'https://*/*'],
    grantedOrigins: [{ origin: 'https://example.com', linkCount: 2, waitingCount: 0 }],
  },
  notifications: {
    manifestPermission: true,
    settingEnabled: true,
    osLevel: 'not-queryable',
  },
  ai: {
    enabled: false,
    baseUrl: 'http://127.0.0.1:1234/v1',
    model: null,
    permissionMode: 'ask-per-write',
    loopback: true,
  },
  recentCaptureFailures: [
    {
      id: 'log-1' as EntityId,
      at: '2026-10-12T08:00:00.000Z' as UtcTimestamp,
      level: 'error',
      component: 'capture',
      operationId: 'capture/run',
      correlationId: 'corr-1',
      durationMs: 4200,
      resultCode: 'capture-failed',
      message: 'page fetch timed out',
    },
  ],
  recentErrors: [],
};

const auditEvents: AuditEvent[] = [
  {
    id: 'audit-1' as EntityId,
    at: '2026-10-12T08:01:00.000Z' as UtcTimestamp,
    actor: 'user',
    action: 'notes/create',
    targetId: 'note-1' as EntityId,
    targetKind: 'note',
    outcome: 'succeeded',
    correlationId: 'corr-2',
    changedFields: ['title'],
    contentHash: null,
    detail: 'created note',
  },
];

const selfTest: NetworkSelfTestResult = {
  checks: [
    { id: 'csp-connect-src', label: 'CSP connect-src allows only this extension and loopback hosts', passed: true, detail: "connect-src 'self' http://127.0.0.1:* http://localhost:*" },
    { id: 'ai-endpoint-loopback', label: 'Configured LM Studio endpoint is loopback', passed: false, detail: 'http://10.0.0.5:1234 (not loopback)' },
  ],
  passed: false,
  ranAt: '2026-10-12T08:02:00.000Z',
  scope: 'Runtime check of the declarative network surface.',
};

const bundle: DiagnosticsExport = {
  format: 'lnwa-diagnostics',
  version: 1,
  exportedAt: '2026-10-12T08:03:00.000Z',
  overview,
  networkSelfTest: selfTest,
  recentLogs: [] as DiagnosticLog[],
  recentAuditEvents: auditEvents,
};

interface Harness {
  panel: ReturnType<typeof createDiagnosticsPanel>;
  /** Replace the hook invoked on the fetched overview. */
  overviewImpl: (replacement: (o: DiagnosticsOverview) => void) => void;
  selfTestImpl: (replacement: (r: NetworkSelfTestResult) => void) => void;
  exportImpl: (replacement: (b: DiagnosticsExport) => void) => void;
  testConnectionImpl: (replacement: (r: ConnectionTestResult) => void) => void;
  readonly rebuildCalls: number;
  announced: string[];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function mountPanel(overviewValue: DiagnosticsOverview = overview): Harness {
  const announced: string[] = [];
  const rebuildCalls = { count: 0 };
  let overviewHook: (o: DiagnosticsOverview) => void = () => undefined;
  let selfTestHook: (r: NetworkSelfTestResult) => void = () => undefined;
  let exportHook: (b: DiagnosticsExport) => void = () => undefined;
  let testConnectionHook: (r: ConnectionTestResult) => void = () => undefined;
  const panel = createDiagnosticsPanel({
    overview: async () => {
      await new Promise<void>((resolve) => {
        // Single-tick deferral so the loading state is observable.
        setTimeout(resolve, 0);
      });
      const copy = clone(overviewValue);
      overviewHook(copy);
      return copy;
    },
    auditTrail: async () => ({ events: auditEvents, total: auditEvents.length }),
    networkSelfTest: async () => {
      const result = clone(selfTest);
      selfTestHook(result);
      return result;
    },
    exportBundle: async () => {
      const copy = clone(bundle);
      exportHook(copy);
      return copy;
    },
    testLmStudio: async () => {
      const result: ConnectionTestResult = { ok: true, latencyMs: 12, models: ['qwen-7b'], error: null, errorMessage: null };
      testConnectionHook(result);
      return result;
    },
    rebuildSearchIndex: async () => {
      rebuildCalls.count++;
      return { indexed: 3 };
    },
    announce: (message) => announced.push(message),
  });
  return {
    panel,
    overviewImpl: (replacement) => {
      overviewHook = replacement;
    },
    selfTestImpl: (replacement) => {
      selfTestHook = replacement;
    },
    exportImpl: (replacement) => {
      exportHook = replacement;
    },
    testConnectionImpl: (replacement) => {
      testConnectionHook = replacement;
    },
    get rebuildCalls(): number {
      return rebuildCalls.count;
    },
    announced,
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
  const dialog = document.querySelector('dialog.dialog--diagnostics');
  if (!dialog) throw new Error('diagnostics dialog not mounted');
  return dialog as HTMLDialogElement;
}

beforeEach(() => {
  // jsdom 30 knows <dialog> and its reflected `open` flag but not
  // showModal/close — polyfill exactly those two (Chrome has the real ones).
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

describe('diagnostics panel', () => {
  it('renders every section from the overview after open()', async () => {
    const harness = mountPanel();
    harness.panel.open();
    const dialog = dialogOf();
    expect(dialog.open).toBe(true);

    await waitFor(() => dialog.querySelector('.diagnostics__panel'));
    const text = dialog.textContent ?? '';
    expect(text).toContain('Local Notes & Web Archive 1.0.0');
    expect(text).toContain('schema v2');
    expect(text).toContain('Chrome');
    expect(text).toContain('126.0.6478.62');
    expect(text).toContain('Persistent storage');
    expect(text).toContain('granted');
    expect(text).toContain('Indexed documents');
    expect(text).toContain('https://example.com (2 links)');
    expect(text).toContain('not queryable');
    expect(text).toContain('http://127.0.0.1:1234/v1');
    expect(text).toContain('page fetch timed out');
    expect(text).toContain('No errors recorded.');
    expect(text).toContain('notes/create [title] — succeeded');
    harness.panel.dispose();
  });

  it('shows an honest error state when the overview cannot be read', async () => {
    const harness = mountPanel();
    harness.overviewImpl(() => {
      throw new Error('database unavailable');
    });
    harness.panel.open();
    const dialog = dialogOf();
    await waitFor(() => dialog.querySelector('.diagnostics__error'));
    const error = dialog.querySelector('.diagnostics__error');
    expect(error?.textContent).toContain('database unavailable');
    expect(error?.textContent).toContain('note database is unaffected');
    const refresh = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Refresh');
    expect(refresh?.disabled).toBe(false);
    const exportButton = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Export diagnostics…');
    expect(exportButton?.disabled).toBe(true);
    harness.panel.dispose();
  });

  it('renders self-test results with PASS and FAIL markers', async () => {
    const harness = mountPanel();
    harness.panel.open();
    const dialog = dialogOf();
    await waitFor(() => dialog.querySelector('.diagnostics__panel'));

    const selfTestButton = [...dialog.querySelectorAll('button')].find(
      (b) => b.textContent === 'Run network privacy self-test',
    );
    expect(selfTestButton).toBeDefined();
    selfTestButton?.click();
    await waitFor(() => dialog.querySelector('.diagnostics__checks'));
    const checks = [...dialog.querySelectorAll('.diagnostics__check')] as HTMLElement[];
    expect(checks.length).toBe(2);
    expect(checks[0]?.dataset['passed']).toBe('true');
    expect(checks[0]?.textContent).toContain('PASS');
    expect(checks[1]?.dataset['passed']).toBe('false');
    expect(checks[1]?.textContent).toContain('FAIL');
    expect(dialog.textContent).toContain('self-test: FAILED');
    expect(harness.announced).toContain('Network privacy self-test failed — see diagnostics for details.');
    harness.panel.dispose();
  });

  it('shows the exact export bundle for review before any download', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:diagnostics');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue();
    const harness = mountPanel();
    harness.panel.open();
    const dialog = dialogOf();
    await waitFor(() => dialog.querySelector('.diagnostics__panel'));

    const exportButton = [...dialog.querySelectorAll('button')].find(
      (b) => b.textContent === 'Export diagnostics…',
    );
    exportButton?.click();
    const review = (await waitFor(() =>
      document.querySelector('dialog.dialog--review'),
    )) as HTMLDialogElement;
    expect(review.open).toBe(true);
    const preview = review.querySelector('.diagnostics__review');
    expect(preview?.textContent).toContain('"format": "lnwa-diagnostics"');
    expect(preview?.textContent).toContain('networkSelfTest');
    // The intro states the review guarantee (FR-LOG-05).
    expect(review.textContent).toContain('No note bodies');

    // Cancel closes without a download.
    const cancel = [...review.querySelectorAll('button')].find((b) => b.textContent === 'Cancel');
    cancel?.click();
    await waitFor(() => document.querySelector('dialog.dialog--review') === null);
    expect(createObjectURL).not.toHaveBeenCalled();

    // Download produces the reviewed JSON as a local file.
    exportButton?.click();
    const review2 = (await waitFor(() =>
      document.querySelector('dialog.dialog--review'),
    )) as HTMLDialogElement;
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const download = [...review2.querySelectorAll('button')].find((b) => b.textContent === 'Download JSON');
    download?.click();
    await waitFor(() => document.querySelector('dialog.dialog--review') === null);
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(harness.announced).toContain('Diagnostics file downloaded.');
    click.mockRestore();
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
    harness.panel.dispose();
  });

  it('offers a live LM Studio connection test with a truthful result', async () => {
    const harness = mountPanel();
    harness.panel.open();
    const dialog = dialogOf();
    await waitFor(() => dialog.querySelector('.diagnostics__panel'));

    const testButton = [...dialog.querySelectorAll('button')].find(
      (b) => b.textContent === 'Test LM Studio connection',
    );
    testButton?.click();
    await waitFor(() => {
      const notes = [...dialog.querySelectorAll('.diagnostics__note')];
      return notes.some((note) => note.textContent?.includes('Connected'));
    });
    const note = [...dialog.querySelectorAll('.diagnostics__note')].find((n) =>
      n.textContent?.includes('Connected'),
    );
    expect(note?.textContent).toContain('12 ms');
    harness.panel.dispose();
  });

  it('rebuilds the search index through the injected callback', async () => {
    const harness = mountPanel();
    harness.panel.open();
    const dialog = dialogOf();
    await waitFor(() => dialog.querySelector('.diagnostics__panel'));

    const rebuild = [...dialog.querySelectorAll('button')].find(
      (b) => b.textContent === 'Rebuild search index',
    );
    rebuild?.click();
    await waitFor(() => harness.announced.includes('Search index rebuilt (3 documents).'));
    expect(harness.rebuildCalls).toBe(1);
    harness.panel.dispose();
  });
});
