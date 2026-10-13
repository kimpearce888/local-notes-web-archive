/**
 * Diagnostics API (FR-LOG-05, FR-SET-04): the diagnostics page's data
 * surface. The overview aggregates every operational signal the PRD lists —
 * extension/build version, Chrome version, DB schema, storage usage, search
 * index status, granted permissions, notification status, LM Studio
 * configuration, last capture failures and recent sanitized errors — while
 * `logs`/`audit` paginate the raw (already-sanitized) trails. The network
 * privacy self-test verifies at runtime that the extension's declarative
 * network surface is capture + loopback only, and the export bundle feeds
 * the opt-in "Export diagnostics" flow whose review step shows exactly what
 * would leave the device (nothing is uploaded — the download is
 * user-initiated).
 */

import type { MessageRouter } from '../router';
import { repo, searchEngine } from '../db';
import { readStorageHealth, type StorageHealthReport } from './storage-health';
import { listGrantedOriginInfos, type GrantedOriginInfo } from './permissions';
import { getSettings } from '../../core/repo/settings';
import { listAuditEvents } from '../../core/repo/audit';
import { listLogs } from '../../core/repo/logs';
import { hostClass } from '../../core/util/urls';
import { APP_NAME, APP_VERSION, DB_NAME, MIN_CHROME_VERSION, SCHEMA_VERSION } from '../../core/version';
import type { AiPermissionMode, AuditEvent, DiagnosticLog, LogLevel } from '../../core/types';
import { asNumber, asObject, asOptionalEnum } from './validate';

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

export interface DiagnosticsOverview {
  readonly app: {
    readonly name: string;
    readonly version: string;
    readonly schemaVersion: number;
    readonly minChromeVersion: number;
    readonly databaseName: string;
  };
  /** Chrome version parsed from the service worker's user agent (honest null). */
  readonly chrome: { readonly version: string | null };
  readonly storage: StorageHealthReport;
  readonly searchIndex: { readonly documentCount: number };
  readonly permissions: {
    readonly required: readonly string[];
    readonly hostPatterns: readonly string[];
    readonly optionalHostPatterns: readonly string[];
    readonly grantedOrigins: readonly GrantedOriginInfo[];
  };
  readonly notifications: {
    readonly manifestPermission: boolean;
    readonly settingEnabled: boolean;
    /** Extensions cannot query the OS/browser notification level (FR-REM-06). */
    readonly osLevel: 'not-queryable';
  };
  readonly ai: {
    readonly enabled: boolean;
    readonly baseUrl: string;
    readonly model: string | null;
    readonly permissionMode: AiPermissionMode;
    readonly loopback: boolean;
  };
  /** Newest-first, already sanitized at write time (FR-LOG-03). */
  readonly recentCaptureFailures: readonly DiagnosticLog[];
  readonly recentErrors: readonly DiagnosticLog[];
}

/** Parse the Chrome version from a user-agent string; null when unknown. */
export function parseChromeVersion(userAgent: string): string | null {
  const match = /(?:Chrome|Chromium)\/(\d+(?:\.\d+){0,3})/.exec(userAgent);
  return match?.[1] ?? null;
}

export async function readDiagnosticsOverview(): Promise<DiagnosticsOverview> {
  const ctx = await repo();
  const [settings, storage, engine, grantedOrigins, logs] = await Promise.all([
    getSettings(ctx),
    readStorageHealth(),
    searchEngine(),
    listGrantedOriginInfos(),
    listLogs(ctx, 200),
  ]);
  const captureFailures = logs.filter(
    (entry) => entry.component === 'capture' && entry.level === 'error',
  );
  const errors = logs.filter((entry) => entry.level === 'error');
  const manifest = chrome.runtime.getManifest();
  const requiredPermissions = [...(manifest.permissions ?? [])];
  const aiLoopback = (() => {
    try {
      return hostClass(new URL(settings.ai.baseUrl).hostname) === 'loopback';
    } catch {
      return false;
    }
  })();
  return {
    app: {
      name: APP_NAME,
      version: APP_VERSION,
      schemaVersion: SCHEMA_VERSION,
      minChromeVersion: MIN_CHROME_VERSION,
      databaseName: DB_NAME,
    },
    chrome: { version: parseChromeVersion(navigator.userAgent) },
    storage,
    searchIndex: { documentCount: engine.documentCount },
    permissions: {
      required: requiredPermissions,
      hostPatterns: [...(manifest.host_permissions ?? [])],
      optionalHostPatterns: [...(manifest.optional_host_permissions ?? [])],
      grantedOrigins,
    },
    notifications: {
      manifestPermission: requiredPermissions.includes('notifications'),
      settingEnabled: settings.reminders.notificationsEnabled,
      osLevel: 'not-queryable',
    },
    ai: {
      enabled: settings.ai.enabled,
      baseUrl: settings.ai.baseUrl,
      model: settings.ai.model,
      permissionMode: settings.ai.permissionMode,
      loopback: aiLoopback,
    },
    recentCaptureFailures: captureFailures.slice(0, 10),
    recentErrors: errors.slice(0, 10),
  };
}

/* ------------------------------------------------------------------ */
/* Log and audit pagination                                            */
/* ------------------------------------------------------------------ */

export interface LogsQuery {
  readonly limit?: number;
  readonly offset?: number;
  readonly level?: LogLevel | 'error+warn' | null;
}

export async function readLogsPage(query: LogsQuery): Promise<{
  logs: DiagnosticLog[];
  total: number;
}> {
  const ctx = await repo();
  const all = await listLogs(ctx, 20_000);
  const filtered =
    query.level === undefined || query.level === null
      ? all
      : query.level === 'error+warn'
        ? all.filter((entry) => entry.level === 'error' || entry.level === 'warn')
        : all.filter((entry) => entry.level === query.level);
  const offset = query.offset ?? 0;
  const limit = query.limit ?? 50;
  return { logs: filtered.slice(offset, offset + limit), total: filtered.length };
}

export async function readAuditPage(query: {
  limit?: number;
  offset?: number;
  actor?: 'user' | 'ai' | null;
}): Promise<{ events: AuditEvent[]; total: number }> {
  const ctx = await repo();
  const all = await listAuditEvents(ctx, { limit: 20_000 });
  const filtered = query.actor ? all.filter((event) => event.actor === query.actor) : all;
  const offset = query.offset ?? 0;
  const limit = query.limit ?? 50;
  return { events: filtered.slice(offset, offset + limit), total: filtered.length };
}

/* ------------------------------------------------------------------ */
/* Network privacy self-test (FR-SET-04)                               */
/* ------------------------------------------------------------------ */

export interface NetworkPrivacyCheck {
  readonly id: string;
  readonly label: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface NetworkSelfTestResult {
  readonly checks: readonly NetworkPrivacyCheck[];
  readonly passed: boolean;
  readonly ranAt: string;
  /** Honest scope statement — the release gate scans built bundles too. */
  readonly scope: string;
}

const EXPECTED_REQUIRED_PERMISSIONS: readonly string[] = [
  'storage',
  'unlimitedStorage',
  'alarms',
  'notifications',
  'scripting',
  'pageCapture',
  'debugger',
  'contextMenus',
];
const EXPECTED_HOST_PERMISSIONS: readonly string[] = ['http://127.0.0.1/*', 'http://localhost/*'];
const EXPECTED_OPTIONAL_HOSTS: readonly string[] = ['http://*/*', 'https://*/*'];

function check(
  id: string,
  label: string,
  passed: boolean,
  detail: string,
): NetworkPrivacyCheck {
  return { id, label, passed, detail };
}

function sameSet(actual: readonly string[], expected: readonly string[]): boolean {
  const a = [...actual].sort().join(',');
  const b = [...expected].sort().join(',');
  return a === b;
}

/**
 * Runtime verification that the declarative network surface is exactly
 * "page capture (user-granted, per-origin) + LM Studio loopback". The
 * manifest is the shipped source of truth; the release gate additionally
 * scans the built bundle for remote URLs and dynamic code.
 */
export async function runNetworkSelfTest(): Promise<NetworkSelfTestResult> {
  const manifest = chrome.runtime.getManifest();
  const settings = await getSettings(await repo());
  const cspRaw = manifest.content_security_policy;
  const csp = typeof cspRaw === 'string' ? cspRaw : cspRaw?.extension_pages ?? '';

  // connect-src must list only 'self' and loopback hosts.
  const connectSrc = /connect-src[^;]*/i.exec(csp)?.[0] ?? '';
  const connectTokens = connectSrc.split(/\s+/).slice(1).filter(Boolean);
  const loopbackOnly = connectTokens.every(
    (token) =>
      token === "'self'" ||
      /^https?:\/\/(127\.0\.0\.1|localhost)(:\*)?$/i.test(token),
  );
  const scriptSrc = /script-src[^;]*/i.exec(csp)?.[0] ?? '';
  const scriptTokens = scriptSrc.split(/\s+/).slice(1).filter(Boolean);

  const aiLoopback = (() => {
    try {
      return hostClass(new URL(settings.ai.baseUrl).hostname) === 'loopback';
    } catch {
      return false;
    }
  })();

  const checks: readonly NetworkPrivacyCheck[] = [
    check(
      'csp-connect-src',
      'CSP connect-src allows only this extension and loopback hosts',
      connectTokens.length > 0 && loopbackOnly,
      connectSrc.trim() || 'CSP connect-src directive missing',
    ),
    check(
      'csp-script-src',
      'CSP script-src is exactly \'self\' (no remote code)',
      scriptTokens.length === 1 && scriptTokens[0] === "'self'",
      scriptSrc.trim() || 'CSP script-src directive missing',
    ),
    check(
      'host-permissions',
      'Required host permissions cover loopback only',
      sameSet([...(manifest.host_permissions ?? [])], EXPECTED_HOST_PERMISSIONS),
      (manifest.host_permissions ?? []).join(', ') || 'none',
    ),
    check(
      'optional-host-permissions',
      'Optional host permissions are the per-origin capture patterns only',
      sameSet([...(manifest.optional_host_permissions ?? [])], EXPECTED_OPTIONAL_HOSTS),
      (manifest.optional_host_permissions ?? []).join(', ') || 'none',
    ),
    check(
      'required-permissions',
      'Required API permissions match the documented set',
      sameSet([...(manifest.permissions ?? [])], EXPECTED_REQUIRED_PERMISSIONS),
      (manifest.permissions ?? []).join(', '),
    ),
    check(
      'no-remote-resources',
      'No remote resources in the manifest (icons and entry points are local)',
      (() => {
        const resources: string[] = [
          ...(manifest.icons ? Object.values(manifest.icons) : []),
          manifest.action?.default_icon
            ? Object.values(manifest.action.default_icon).flat()
            : [],
        ].flat().filter((value): value is string => typeof value === 'string');
        return resources.every((value) => !/^https?:\/\//i.test(value));
      })(),
      'manifest resources are relative paths',
    ),
    check(
      'ai-endpoint-loopback',
      'Configured LM Studio endpoint is loopback',
      aiLoopback,
      aiLoopback ? settings.ai.baseUrl : `${settings.ai.baseUrl} (not loopback)`,
    ),
  ];

  return {
    checks,
    passed: checks.every((item) => item.passed),
    ranAt: new Date().toISOString(),
    scope:
      'Runtime check of the declarative network surface (manifest CSP, host permissions, AI endpoint). ' +
      'The release gate additionally scans the built bundle for remote URLs and dynamic code.',
  };
}

/* ------------------------------------------------------------------ */
/* Export bundle (review-then-download, FR-LOG-05)                     */
/* ------------------------------------------------------------------ */

export interface DiagnosticsExport {
  readonly format: 'lnwa-diagnostics';
  readonly version: 1;
  readonly exportedAt: string;
  readonly overview: DiagnosticsOverview;
  readonly networkSelfTest: NetworkSelfTestResult;
  readonly recentLogs: readonly DiagnosticLog[];
  readonly recentAuditEvents: readonly AuditEvent[];
}

export async function buildDiagnosticsExport(): Promise<DiagnosticsExport> {
  const [overview, networkSelfTest, logs, audit] = await Promise.all([
    readDiagnosticsOverview(),
    runNetworkSelfTest(),
    readLogsPage({ limit: 200 }),
    readAuditPage({ limit: 200 }),
  ]);
  return {
    format: 'lnwa-diagnostics',
    version: 1,
    exportedAt: new Date().toISOString(),
    overview,
    networkSelfTest,
    recentLogs: logs.logs,
    recentAuditEvents: audit.events,
  };
}

/* ------------------------------------------------------------------ */
/* Router registration                                                 */
/* ------------------------------------------------------------------ */

const LOG_LEVEL_FILTERS = ['debug', 'info', 'warn', 'error', 'error+warn'] as const;

export function registerDiagnosticsApi(router: MessageRouter): void {
  router.register('diagnostics/overview', async () => ({ overview: await readDiagnosticsOverview() }));

  router.register('diagnostics/logs', async (payload) => {
    const p = asObject(payload, 'diagnostics/logs');
    const level = asOptionalEnum(p['level'], 'level', LOG_LEVEL_FILTERS);
    const limit = p['limit'] === undefined ? undefined : asNumber(p['limit'], 'limit', { min: 1, max: 500, integer: true });
    const offset = p['offset'] === undefined ? undefined : asNumber(p['offset'], 'offset', { min: 0, max: 1_000_000, integer: true });
    const page = await readLogsPage({ level, limit, offset });
    return { logs: page.logs, total: page.total };
  });

  router.register('diagnostics/audit', async (payload) => {
    const p = asObject(payload, 'diagnostics/audit');
    const actor = asOptionalEnum(p['actor'], 'actor', ['user', 'ai'] as const);
    const limit = p['limit'] === undefined ? undefined : asNumber(p['limit'], 'limit', { min: 1, max: 500, integer: true });
    const offset = p['offset'] === undefined ? undefined : asNumber(p['offset'], 'offset', { min: 0, max: 1_000_000, integer: true });
    const page = await readAuditPage({ actor, limit, offset });
    return { events: page.events, total: page.total };
  });

  router.register('diagnostics/network-self-test', async () => ({
    result: await runNetworkSelfTest(),
  }));

  router.register('diagnostics/export-bundle', async () => ({
    bundle: await buildDiagnosticsExport(),
  }));
}
