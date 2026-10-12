/**
 * Application identity and build metadata.
 *
 * Values here are the single source of truth mirrored into public/manifest.json
 * at build time by scripts. The PRD requires the product to identify itself
 * truthfully in diagnostics, logs and exports (FR-LOG-05, FR-DATA-03).
 */
export const APP_NAME = 'Local Notes & Web Archive';
export const APP_ID = 'local-notes-web-archive';
export const APP_VERSION = '1.0.0';
export const SCHEMA_VERSION = 1;
export const DB_NAME = 'local-notes-web-archive';
export const MIN_CHROME_VERSION = 120;

/** Storage keys used in chrome.storage.local for small settings (FR-DATA-01). */
export const SETTINGS_KEY = 'app-settings';
export const ONBOARDING_DONE_KEY = 'onboarding-complete';
