/**
 * Settings panel (T-039, FR-SET-01): the complete settings surface in one
 * modal — appearance (theme, default view/sort), capture behaviour
 * (auto-capture on paste, limits, duplicate handling), granted capture
 * origins with revocation, reminder preferences (notifications, leap-day
 * policy), editor toolbar groups, data retention (revisions, backup
 * warnings, log bounds), and the AI section (enable, loopback endpoint,
 * model selection, permission mode, live connection test) with the honest
 * MCP disclosure (internal tool-calling only — FR-MCP-01..03). Backup
 * export/restore (FR-DATA-03/04) and the onboarding replay live here too.
 *
 * The panel is transport-agnostic: the dashboard injects the RPC calls so
 * unit tests drive it without chrome.
 */

import type { AppSettings, ThemePreference } from '../../core/types';
import type { GrantedOriginInfo } from '../../background/api/permissions';
import type { CommandStatus } from '../../background/api/settings';
import type { ConnectionTestResult, LmStudioModel } from '../../background/ai/client';
import type { BackupExportResult } from '../../background/backup/export';
import type { BackupPreview } from '../../background/backup/restore';
import { TOOLBAR_GROUPS } from '../editor/toolbar';

export interface SettingsPanelCallbacks {
  getSettings(): Promise<AppSettings>;
  patchSettings(patch: Record<string, unknown>): Promise<AppSettings>;
  listGranted(): Promise<{ origins: readonly GrantedOriginInfo[] }>;
  revokeOrigin(origin: string): Promise<{ revoked: boolean }>;
  listModels(): Promise<{ models: LmStudioModel[] }>;
  testConnection(baseUrl?: string): Promise<ConnectionTestResult>;
  exportBackup(): Promise<BackupExportResult>;
  previewBackup(file: File): Promise<BackupPreview>;
  restoreBackup(file: File, mode: 'merge' | 'replace', confirmReplace: boolean): Promise<{
    mode: 'merge' | 'replace';
    imported: { notes: number; reminders: number; snapshots: number; blobs: number };
  }>;
  readCommandStatus(): Promise<CommandStatus>;
  showOnboarding(): void;
  setTheme(preference: ThemePreference): void;
  announce(message: string): void;
}

export interface SettingsPanel {
  open(): void;
  dispose(): void;
}

const SORT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'modified', label: 'Last modified' },
  { value: 'created', label: 'Date created' },
  { value: 'title', label: 'Title' },
  { value: 'reminder', label: 'Reminder due' },
  { value: 'capture', label: 'Capture date' },
  { value: 'relevance', label: 'Relevance' },
];

const AI_PERMISSION_MODES: ReadonlyArray<{ value: string; label: string; hint: string }> = [
  { value: 'read-only', label: 'Read only', hint: 'The assistant can search and read, never write.' },
  { value: 'ask-per-write', label: 'Ask before every write', hint: 'Every write needs your approval (default).' },
  {
    value: 'safe-writes',
    label: 'Safe writes',
    hint: 'Routine edits apply directly; destructive actions (delete, permanent delete) still ask.',
  },
];

const DUPLICATE_MODES: ReadonlyArray<{ value: string; label: string; hint: string }> = [
  { value: 'ask', label: 'Ask me', hint: 'Show a reuse/capture-fresh choice when the URL is already archived.' },
  { value: 'reuse', label: 'Reuse existing capture', hint: 'Silently reuse the newest snapshot for that URL.' },
  { value: 'always-new', label: 'Always capture fresh', hint: 'Always create a new snapshot revision.' },
];

const LEAP_DAY_POLICIES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'feb-28', label: 'February 28 (default)' },
  { value: 'mar-1', label: 'March 1' },
  { value: 'skip', label: 'Skip the year' },
];

function fieldRow(labelText: string, control: HTMLElement, hint?: string): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'settings__row';
  const label = document.createElement('span');
  label.className = 'settings__row-label';
  label.textContent = labelText;
  const value = document.createElement('div');
  value.className = 'settings__row-value';
  value.append(control);
  row.append(label, value);
  if (hint) {
    const note = document.createElement('p');
    note.className = 'settings__hint';
    note.textContent = hint;
    row.append(note);
  }
  return row;
}

function section(panel: HTMLElement, title: string, hint?: string): void {
  const heading = document.createElement('h3');
  heading.className = 'settings__section-title';
  heading.textContent = title;
  panel.append(heading);
  if (hint) {
    const note = document.createElement('p');
    note.className = 'settings__section-hint';
    note.textContent = hint;
    panel.append(note);
  }
}

function radioGroup<T extends string>(
  name: string,
  options: ReadonlyArray<{ value: T; label: string; hint?: string }>,
  value: T,
  onChange: (value: T) => void,
): HTMLFieldSetElement {
  const group = document.createElement('fieldset');
  group.className = 'settings__radios';
  const legend = document.createElement('legend');
  legend.className = 'visually-hidden';
  legend.textContent = name;
  group.append(legend);
  for (const option of options) {
    const line = document.createElement('label');
    line.className = 'settings__radio';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = option.value;
    input.checked = option.value === value;
    input.addEventListener('change', () => {
      if (input.checked) onChange(option.value);
    });
    const text = document.createElement('span');
    text.textContent = option.label;
    line.append(input, text);
    if (option.hint) {
      const hint = document.createElement('span');
      hint.className = 'settings__radio-hint';
      hint.textContent = option.hint;
      line.append(hint);
    }
    group.append(line);
  }
  return group;
}

function checkbox(
  labelText: string,
  checked: boolean,
  onChange: (checked: boolean) => void,
): HTMLLabelElement {
  const line = document.createElement('label');
  line.className = 'settings__check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  const text = document.createElement('span');
  text.textContent = labelText;
  line.append(input, text);
  return line;
}

function numberInput(
  value: number,
  opts: { min: number; max: number; step?: number; suffix?: string },
  onChange: (value: number | null) => void,
): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'settings__number';
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'input';
  input.value = String(value);
  input.min = String(opts.min);
  input.max = String(opts.max);
  input.step = opts.step !== undefined ? String(opts.step) : '1';
  input.addEventListener('change', () => {
    const parsed = Number(input.value);
    if (!Number.isFinite(parsed) || parsed < opts.min || parsed > opts.max) {
      onChange(null);
      return;
    }
    onChange(parsed);
  });
  wrap.append(input);
  if (opts.suffix) {
    const suffix = document.createElement('span');
    suffix.className = 'settings__number-suffix';
    suffix.textContent = opts.suffix;
    wrap.append(suffix);
  }
  return wrap;
}

function selectInput(
  options: ReadonlyArray<{ value: string; label: string }>,
  value: string,
  onChange: (value: string) => void,
): HTMLSelectElement {
  const select = document.createElement('select');
  select.className = 'select';
  for (const option of options) {
    const element = document.createElement('option');
    element.value = option.value;
    element.textContent = option.label;
    select.append(element);
  }
  select.value = value;
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

export function createSettingsPanel(callbacks: SettingsPanelCallbacks): SettingsPanel {
  const dialog = document.createElement('dialog');
  dialog.className = 'dialog dialog--settings';
  dialog.setAttribute('aria-labelledby', 'settings-title');

  const heading = document.createElement('h2');
  heading.id = 'settings-title';
  heading.textContent = 'Settings';

  const content = document.createElement('div');
  content.className = 'settings__content';
  content.setAttribute('aria-busy', 'true');
  content.textContent = 'Loading settings…';

  const actions = document.createElement('div');
  actions.className = 'dialog__actions settings__actions';
  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'btn btn--primary';
  saveButton.textContent = 'Save changes';
  saveButton.disabled = true;
  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.className = 'btn';
  resetButton.textContent = 'Reset';
  resetButton.disabled = true;
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'btn';
  closeButton.textContent = 'Close';
  actions.append(saveButton, resetButton, closeButton);

  dialog.append(heading, content, actions);
  document.body.append(dialog);

  let disposed = false;
  let loadToken = 0;
  /** The patch collected from the draft form (names match AppSettings). */
  const patch: Record<string, unknown> = {};
  /** Draft nested objects — merged into the patch on save. */
  const draft = {
    capture: {} as Record<string, unknown>,
    reminders: {} as Record<string, unknown>,
    editor: {} as Record<string, unknown>,
    backup: {} as Record<string, unknown>,
    ai: {} as Record<string, unknown>,
    logs: {} as Record<string, unknown>,
    toolbar: {} as Record<string, boolean>,
  };

  const markDirty = (): void => {
    if (!saveButton.disabled) return;
    saveButton.disabled = false;
    saveButton.textContent = 'Save changes*';
  };

  const render = (settings: AppSettings, granted: readonly GrantedOriginInfo[], commands: CommandStatus): void => {
    content.setAttribute('aria-busy', 'false');
    content.replaceChildren();
    const panel = document.createElement('div');
    panel.className = 'settings__panel';

    /* ------------------------- Appearance --------------------------- */

    section(panel, 'Appearance');
    const themeGroup = radioGroup<TTheme>(
      'Theme',
      [
        { value: 'system', label: 'Follow system' },
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
      ],
      settings.theme,
      (value) => {
        patch['theme'] = value;
        callbacks.setTheme(value);
        markDirty();
      },
    );
    panel.append(
      fieldRow('Theme', themeGroup, 'Applies immediately; saved with the other changes.'),
      fieldRow(
        'Default view',
        radioGroup(
          'Default view',
          [
            { value: 'grid', label: 'Grid' },
            { value: 'list', label: 'List' },
          ],
          settings.viewMode,
          (value) => {
            patch['viewMode'] = value;
            markDirty();
          },
        ),
      ),
      fieldRow(
        'Default sort',
        selectInput(SORT_OPTIONS, settings.defaultSort.field, (value) => {
          patch['defaultSort'] = { field: value, direction: settings.defaultSort.direction };
          markDirty();
        }),
      ),
    );

    /* -------------------------- Capture ----------------------------- */

    section(
      panel,
      'Web capture',
      'Captures visit only pages you explicitly save, and only after you grant access to that site.',
    );
    panel.append(
      fieldRow(
        'Auto-capture on paste',
        checkbox('Detect and archive pasted links', settings.autoCaptureOnPaste, (checked) => {
          patch['autoCaptureOnPaste'] = checked;
          markDirty();
        }),
        'When off, pasted URLs are still recorded as links but never visited automatically.',
      ),
      fieldRow(
        'Duplicate captures',
        radioGroup('Duplicate capture handling', DUPLICATE_MODES, settings.duplicateCapture, (value) => {
          patch['duplicateCapture'] = value;
          markDirty();
        }),
      ),
      fieldRow(
        'Max archive size',
        numberInput(
          Math.round(settings.capture.maxArchiveBytes / (1024 * 1024)),
          { min: 1, max: 500, suffix: 'MB' },
          (value) => {
            draft.capture.maxArchiveBytes = value === null ? null : value * 1024 * 1024;
            markDirty();
          },
        ),
      ),
      fieldRow(
        'Max screenshot area',
        numberInput(
          Math.round(settings.capture.maxScreenshotPixels / 1_000_000),
          { min: 1, max: 200, suffix: 'megapixels' },
          (value) => {
            draft.capture.maxScreenshotPixels = value === null ? null : value * 1_000_000;
            markDirty();
          },
        ),
        'Very tall pages are captured in tiles up to this area; beyond it the PNG is marked partial.',
      ),
      fieldRow(
        'Capture timeout',
        numberInput(
          Math.round(settings.capture.timeoutMs / 1000),
          { min: 5, max: 300, suffix: 'seconds' },
          (value) => {
            draft.capture.timeoutMs = value === null ? null : value * 1000;
            markDirty();
          },
        ),
      ),
    );

    /* ------------------------ Site access --------------------------- */

    section(
      panel,
      'Site access',
      'Origins you granted for capture. Revoking returns pending captures to "permission required" and never deletes saved archives.',
    );
    const originsList = document.createElement('ul');
    originsList.className = 'settings__origins';
    if (granted.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'settings__empty';
      empty.textContent = 'No site has been granted access yet.';
      originsList.append(empty);
    } else {
      for (const origin of granted) {
        const item = document.createElement('li');
        item.className = 'settings__origin';
        const label = document.createElement('span');
        label.textContent =
          origin.linkCount > 0 ? `${origin.origin} · ${origin.linkCount} links` : origin.origin;
        const revoke = document.createElement('button');
        revoke.type = 'button';
        revoke.className = 'btn btn--ghost';
        revoke.textContent = 'Revoke';
        revoke.addEventListener('click', () => {
          revoke.disabled = true;
          void callbacks
            .revokeOrigin(origin.origin)
            .then((result) => {
              if (result.revoked) {
                item.remove();
                callbacks.announce(`Access to ${origin.origin} revoked.`);
              } else {
                revoke.disabled = false;
              }
            })
            .catch(() => {
              revoke.disabled = false;
              callbacks.announce('Revoking access failed — try again.');
            });
        });
        item.append(label, revoke);
        originsList.append(item);
      }
    }
    panel.append(originsList);

    /* ------------------------ Reminders ------------------------------ */

    section(panel, 'Reminders');
    panel.append(
      fieldRow(
        'Notifications',
        checkbox('Show browser notifications for reminders', settings.reminders.notificationsEnabled, (checked) => {
          draft.reminders.notificationsEnabled = checked;
          markDirty();
        }),
        'Reminders are always visible in the dashboard, even when notifications are off. OS-level settings can silence notifications — the extension cannot query or change them.',
      ),
      fieldRow(
        'February 29 reminders',
        selectInput(LEAP_DAY_POLICIES, settings.reminders.leapDayPolicy, (value) => {
          draft.reminders.leapDayPolicy = value;
          markDirty();
        }),
      ),
    );

    /* -------------------------- Editor ------------------------------ */

    section(
      panel,
      'Editor toolbar',
      'Hide toolbar groups you never use. Every command stays available through keyboard shortcuts and the in-editor help.',
    );
    const toolbarWrap = document.createElement('div');
    toolbarWrap.className = 'settings__toolbar-groups';
    for (const group of TOOLBAR_GROUPS) {
      const enabled = settings.editor.toolbar[group] !== false;
      toolbarWrap.append(
        checkbox(group, enabled, (checked) => {
          draft.toolbar[group] = checked;
          markDirty();
        }),
      );
    }
    panel.append(toolbarWrap);

    /* ---------------------------- Data ------------------------------- */

    section(panel, 'Data and retention');
    panel.append(
      fieldRow(
        'Revision history',
        numberInput(settings.revisionRetention, { min: 20, max: 500, suffix: 'revisions per note' }, (value) => {
          patch['revisionRetention'] = value;
          markDirty();
        }),
      ),
      fieldRow(
        'Backup reminder',
        numberInput(settings.backup.warnAfterDays, { min: 0, max: 365, suffix: 'days without a backup (0 = off)' }, (value) => {
          draft.backup.warnAfterDays = value;
          markDirty();
        }),
      ),
      fieldRow(
        'Technical log ceiling',
        numberInput(Math.round(settings.logs.maxBytes / (1024 * 1024)), { min: 1, max: 50, suffix: 'MB' }, (value) => {
          draft.logs.maxBytes = value === null ? null : value * 1024 * 1024;
          markDirty();
        }),
        'Sanitized technical logs rotate to this size; audit events are kept for the retention below.',
      ),
      fieldRow(
        'Audit retention',
        numberInput(settings.logs.auditRetentionDays, { min: 7, max: 3650, suffix: 'days' }, (value) => {
          draft.logs.auditRetentionDays = value;
          markDirty();
        }),
      ),
    );

    /* --------------------------- Backup ------------------------------ */

    section(
      panel,
      'Backup and restore',
      'The complete ZIP holds notes, reminders, revisions, snapshots and preferences. Nothing is ever uploaded — files go only where you save them.',
    );
    const backupRow = document.createElement('div');
    backupRow.className = 'settings__backup-row';
    const exportButton = document.createElement('button');
    exportButton.type = 'button';
    exportButton.className = 'btn';
    exportButton.textContent = 'Export backup now';
    const backupStatus = document.createElement('span');
    backupStatus.className = 'settings__hint';
    exportButton.addEventListener('click', () => {
      exportButton.disabled = true;
      backupStatus.textContent = 'Preparing archive…';
      void callbacks
        .exportBackup()
        .then((result) => {
          const url = URL.createObjectURL(result.blob);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = result.filename;
          document.body.append(anchor);
          anchor.click();
          anchor.remove();
          window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
          backupStatus.textContent = `Backup downloaded (${result.counts.notes} notes, ${result.counts.snapshots} snapshots).`;
          callbacks.announce('Backup file downloaded.');
        })
        .catch((error: unknown) => {
          backupStatus.textContent = `Backup failed: ${error instanceof Error ? error.message : 'unknown error'}. Your notes are unchanged.`;
          callbacks.announce('Backup export failed.');
        })
        .finally(() => {
          exportButton.disabled = false;
        });
    });
    const restoreButton = document.createElement('button');
    restoreButton.type = 'button';
    restoreButton.className = 'btn';
    restoreButton.textContent = 'Restore backup…';
    restoreButton.addEventListener('click', () => {
      const picker = document.createElement('input');
      picker.type = 'file';
      picker.accept = '.zip';
      picker.addEventListener('change', () => {
        const file = picker.files?.[0];
        if (file) void runRestoreFlow(file);
      });
      picker.click();
    });
    backupRow.append(exportButton, restoreButton, backupStatus);
    panel.append(backupRow);

    /* ----------------------------- AI -------------------------------- */

    section(
      panel,
      'Local AI (LM Studio)',
      'Optional. The assistant runs entirely through your local LM Studio server — the extension only ever contacts 127.0.0.1 or localhost, and every note feature works with AI off.',
    );
    const aiEnabled = checkbox('Enable AI features', settings.ai.enabled, (checked) => {
      draft.ai.enabled = checked;
      markDirty();
    });
    const baseUrlInput = document.createElement('input');
    baseUrlInput.type = 'url';
    baseUrlInput.className = 'input';
    baseUrlInput.value = settings.ai.baseUrl;
    baseUrlInput.placeholder = 'http://127.0.0.1:1234/v1';
    baseUrlInput.addEventListener('change', () => {
      draft.ai.baseUrl = baseUrlInput.value.trim();
      markDirty();
    });
    const modelSelect = document.createElement('select');
    modelSelect.className = 'select';
    const currentModel = document.createElement('option');
    currentModel.value = settings.ai.model ?? '';
    currentModel.textContent = settings.ai.model ?? 'not selected';
    modelSelect.append(currentModel);
    const modelRefresh = document.createElement('button');
    modelRefresh.type = 'button';
    modelRefresh.className = 'btn btn--ghost';
    modelRefresh.textContent = 'Load models';
    modelRefresh.addEventListener('click', () => {
      modelRefresh.disabled = true;
      void callbacks
        .listModels()
        .then(({ models }) => {
          modelSelect.replaceChildren();
          const none = document.createElement('option');
          none.value = '';
          none.textContent = 'not selected';
          modelSelect.append(none);
          for (const model of models) {
            const option = document.createElement('option');
            option.value = model.id;
            option.textContent = model.id;
            modelSelect.append(option);
          }
          modelSelect.value = settings.ai.model ?? '';
        })
        .catch(() => {
          callbacks.announce('Could not list LM Studio models — is it running?');
        })
        .finally(() => {
          modelRefresh.disabled = false;
        });
    });
    modelSelect.addEventListener('change', () => {
      draft.ai.model = modelSelect.value === '' ? null : modelSelect.value;
      markDirty();
    });
    const modelRow = document.createElement('div');
    modelRow.className = 'settings__model-row';
    modelRow.append(modelSelect, modelRefresh);

    const testButton = document.createElement('button');
    testButton.type = 'button';
    testButton.className = 'btn btn--ghost';
    testButton.textContent = 'Test connection';
    const testResult = document.createElement('p');
    testResult.className = 'settings__hint';
    testResult.textContent = '';
    testButton.addEventListener('click', () => {
      testButton.disabled = true;
      testResult.textContent = 'Testing…';
      void callbacks
        .testConnection(baseUrlInput.value.trim() || undefined)
        .then((result) => {
          testResult.textContent = result.ok
            ? `Connected in ${result.latencyMs} ms — ${result.models.length} models available.`
            : `Unreachable: ${result.errorMessage ?? 'unknown error'}. Start LM Studio and check the endpoint; AI stays off, everything else keeps working.`;
        })
        .catch((error: unknown) => {
          testResult.textContent = `Unreachable: ${error instanceof Error ? error.message : 'unknown error'}`;
        })
        .finally(() => {
          testButton.disabled = false;
        });
    });
    panel.append(
      fieldRow('AI features', aiEnabled),
      fieldRow('LM Studio endpoint', baseUrlInput, 'Loopback only (127.0.0.1 or localhost) — other hosts are refused.'),
      fieldRow('Model', modelRow),
      fieldRow('AI timeout', numberInput(Math.round(settings.ai.timeoutMs / 1000), { min: 5, max: 600, suffix: 'seconds' }, (value) => {
        draft.ai.timeoutMs = value === null ? null : value * 1000;
        markDirty();
      })),
      fieldRow('Permission mode', radioGroup('AI permission mode', AI_PERMISSION_MODES, settings.ai.permissionMode, (value) => {
        draft.ai.permissionMode = value;
        markDirty();
      })),
      testButton,
      testResult,
    );
    const disclosure = document.createElement('p');
    disclosure.className = 'settings__hint';
    disclosure.textContent =
      'Disclosure: the AI tools are internal to this extension — there is no external MCP server, no cloud model, ' +
      'and no server status is ever faked. Tool calls are validated, bounded and audited; the model can propose, ' +
      'the app decides.';
    panel.append(disclosure);

    /* -------------------------- Shortcuts ----------------------------- */

    section(panel, 'Keyboard shortcuts');
    const shortcutValue = document.createElement('span');
    shortcutValue.textContent =
      commands.openDashboard === commands.suggested
        ? `${commands.suggested} (active)`
        : commands.openDashboard
          ? `${commands.openDashboard} (reassigned)`
          : `suggested ${commands.suggested} could not be assigned — set it in chrome://extensions/shortcuts`;
    panel.append(
      fieldRow('Open dashboard', shortcutValue),
    );

    /* ------------------------- Onboarding ----------------------------- */

    section(panel, 'Getting started');
    const onboardingButton = document.createElement('button');
    onboardingButton.type = 'button';
    onboardingButton.className = 'btn btn--ghost';
    onboardingButton.textContent = 'Show the introduction again';
    onboardingButton.addEventListener('click', () => {
      dialog.close();
      callbacks.showOnboarding();
    });
    panel.append(onboardingButton);

    content.append(panel);
    saveButton.disabled = true;
    saveButton.textContent = 'Save changes';
    resetButton.disabled = false;
  };

  /** Restore flow: preview → mode → explicit replace confirm → result. */
  const runRestoreFlow = (file: File): void => {
    void callbacks
      .previewBackup(file)
      .then((preview) => {
        const manifest = preview.manifest;
        const review = document.createElement('dialog');
        review.className = 'dialog dialog--review';
        review.setAttribute('aria-labelledby', 'restore-review-title');
        const title = document.createElement('h2');
        title.id = 'restore-review-title';
        title.textContent = 'Restore backup';

        const summary = document.createElement('p');
        summary.className = 'settings__hint';
        summary.textContent =
          `Archive exported ${manifest.exportedAt} by app v${manifest.appVersion} ` +
          `(${manifest.format} v${manifest.backupVersion}) — ${manifest.counts.notes} notes, ` +
          `${manifest.counts.reminders} reminders, ${manifest.counts.snapshots} snapshots, ` +
          `${manifest.counts.attachments} attachments.` +
          (preview.compatible ? '' : ` Compatibility: ${preview.issues.join(' ')}`);

        const modeGroup = radioGroup<'merge' | 'replace'>(
          'Restore mode',
          [
            { value: 'merge', label: 'Merge', hint: 'Add the archive alongside existing notes (same URLs become duplicates you can resolve).' },
            { value: 'replace', label: 'Replace everything', hint: 'Deletes all current data first. Requires explicit confirmation below.' },
          ],
          'merge',
          () => undefined,
        );
        const radios = [...modeGroup.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
        const confirmBox = checkbox(
          'I understand replace deletes my current notes, archives and reminders',
          false,
          () => undefined,
        );
        confirmBox.hidden = true;
        radios[1]?.addEventListener('change', () => {
          confirmBox.hidden = !radios[1]?.checked;
        });
        radios[0]?.addEventListener('change', () => {
          confirmBox.hidden = true;
        });

        const restoreStatus = document.createElement('p');
        restoreStatus.className = 'settings__hint';
        restoreStatus.textContent = '';

        const reviewActions = document.createElement('div');
        reviewActions.className = 'dialog__actions';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn';
        cancel.textContent = 'Cancel';
        const restore = document.createElement('button');
        restore.type = 'button';
        restore.className = 'btn btn--primary';
        restore.textContent = 'Restore';
        restore.addEventListener('click', () => {
          const mode = radios.find((radio) => radio.checked)?.value === 'replace' ? 'replace' : 'merge';
          const confirmInput = confirmBox.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
          const confirmReplace = confirmInput?.checked === true;
          restore.disabled = true;
          restoreStatus.textContent = 'Restoring…';
          void callbacks
            .restoreBackup(file, mode, confirmReplace)
            .then((result) => {
              review.close();
              review.remove();
              callbacks.announce(
                `Restore finished: ${result.imported.notes} notes, ${result.imported.snapshots} snapshots imported (${mode}).`,
              );
              backupDoneNote(`Restore finished (${mode}): ${result.imported.notes} notes, ${result.imported.reminders} reminders, ${result.imported.snapshots} snapshots.`);
            })
            .catch((error: unknown) => {
              restore.disabled = false;
              restoreStatus.textContent = `Restore rejected — your database is untouched: ${error instanceof Error ? error.message : 'unknown error'}`;
            });
        });
        reviewActions.append(cancel, restore);
        review.append(title, summary, modeGroup, confirmBox, restoreStatus, reviewActions);
        document.body.append(review);
        review.showModal();
        cancel.addEventListener('click', () => {
          review.close();
          review.remove();
        });
      })
      .catch((error: unknown) => {
        callbacks.announce('This file is not a valid backup.');
        backupDoneNote(`Not a valid backup: ${error instanceof Error ? error.message : 'unknown error'}`);
      });
  };

  /** Status line appended near the backup row after a restore. */
  const backupDoneNote = (message: string): void => {
    const hint = content.querySelector('.settings__backup-row .settings__hint:last-of-type');
    if (hint instanceof HTMLElement) hint.textContent = message;
  };

  const load = async (): Promise<void> => {
    const token = ++loadToken;
    content.setAttribute('aria-busy', 'true');
    content.textContent = 'Loading settings…';
    saveButton.disabled = true;
    resetButton.disabled = true;
    try {
      const [settings, granted, commands] = await Promise.all([
        callbacks.getSettings(),
        callbacks.listGranted(),
        callbacks.readCommandStatus(),
      ]);
      if (disposed || token !== loadToken) return;
      // Reset the collected patch: a fresh draft starts clean.
      for (const key of Object.keys(patch)) delete patch[key];
      for (const key of Object.keys(draft.capture)) delete draft.capture[key];
      for (const key of Object.keys(draft.reminders)) delete draft.reminders[key];
      for (const key of Object.keys(draft.editor)) delete draft.editor[key];
      for (const key of Object.keys(draft.backup)) delete draft.backup[key];
      for (const key of Object.keys(draft.ai)) delete draft.ai[key];
      for (const key of Object.keys(draft.logs)) delete draft.logs[key];
      for (const key of Object.keys(draft.toolbar)) delete draft.toolbar[key];
      render(settings, granted.origins, commands);
    } catch (error) {
      if (disposed || token !== loadToken) return;
      content.setAttribute('aria-busy', 'false');
      content.replaceChildren();
      const paragraph = document.createElement('p');
      paragraph.className = 'diagnostics__error';
      paragraph.textContent = `Settings could not be read (${error instanceof Error ? error.message : 'unknown error'}). Nothing was changed; try Reset.`;
      content.append(paragraph);
    }
  };

  saveButton.addEventListener('click', () => {
    // Merge nested draft objects into the patch (only touched keys);
    // invalid number inputs (null sentinels) are excluded, not saved.
    const captureClean = stripNulls(draft.capture);
    if (Object.keys(captureClean).length > 0) patch['capture'] = captureClean;
    if (Object.keys(draft.reminders).length > 0) patch['reminders'] = { ...draft.reminders };
    if (Object.keys(draft.toolbar).length > 0) {
      patch['editor'] = { toolbar: { ...draft.toolbar } };
    }
    if (Object.keys(draft.backup).length > 0) patch['backup'] = stripNulls(draft.backup);
    if (Object.keys(draft.ai).length > 0) patch['ai'] = stripNulls(draft.ai);
    if (Object.keys(draft.logs).length > 0) patch['logs'] = stripNulls(draft.logs);
    saveButton.disabled = true;
    saveButton.textContent = 'Saving…';
    void callbacks
      .patchSettings(patch)
      .then(() => {
        saveButton.textContent = 'Saved';
        callbacks.announce('Settings saved.');
        void load();
      })
      .catch((error: unknown) => {
        saveButton.disabled = false;
        saveButton.textContent = 'Save changes*';
        callbacks.announce(
          `Settings were not saved: ${error instanceof Error ? error.message : 'validation failed'}`,
        );
      });
  });
  resetButton.addEventListener('click', () => void load());
  closeButton.addEventListener('click', () => dialog.close());

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

type TTheme = ThemePreference;

/** Remove null sentinel values produced by invalid number inputs. */
function stripNulls(record: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== null) cleaned[key] = value;
  }
  return cleaned;
}
