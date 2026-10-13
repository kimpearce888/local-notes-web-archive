/**
 * First-run onboarding (T-039, FR-SET-02): one accessible dialog that states
 * the local-storage promise, the permission model (capture only with
 * per-origin grants), the optional nature of LM Studio AI, the honest
 * reminder limits, and the data-loss risk with the backup advice. Core
 * flows are usable with AI and notifications off — nothing here gates the
 * app; the dialog informs and leaves.
 */

export interface OnboardingCallbacks {
  /** Persist the completion flag (settings/set-onboarding-complete). */
  complete(): Promise<void>;
  /** Open the settings panel (AI endpoint configuration lives there). */
  openSettings(): void;
  announce(message: string): void;
}

export interface OnboardingOverlay {
  open(): void;
  dispose(): void;
}

interface OnboardingSection {
  readonly title: string;
  readonly body: string;
}

const SECTIONS: readonly OnboardingSection[] = [
  {
    title: 'Everything stays on this device',
    body:
      'Notes, archived pages, reminders and attachments live in this browser\u2019s local storage. ' +
      'There is no account, no cloud copy and no telemetry — nothing leaves your machine unless you ' +
      'export a file yourself.',
  },
  {
    title: 'Saving web pages asks first',
    body:
      'When you save a page, the extension asks for access to that site only when you click ' +
      '\u201cAllow access and capture\u201d. You can revoke access at any time in Settings; saved archives ' +
      'are never deleted by revoking.',
  },
  {
    title: 'Local AI is optional',
    body:
      'AI features (search help, summaries, tag suggestions) work only if you run LM Studio locally and ' +
      'enable them in Settings. The connection is limited to 127.0.0.1 or localhost. Every feature works ' +
      'without it.',
  },
  {
    title: 'Reminders have honest limits',
    body:
      'Reminders appear in the dashboard always; browser notifications depend on Chrome and your ' +
      'operating system settings, and alarms can be lost when the browser is fully closed. Missed ' +
      'occurrences are coalesced and still shown as overdue.',
  },
  {
    title: 'Protect against data loss',
    body:
      'Uninstalling the extension, removing the Chrome profile or clearing extension data deletes ' +
      'everything with no recovery. Export a complete backup ZIP from Settings before such actions — ' +
      'it restores on any machine.',
  },
];

export function createOnboardingOverlay(callbacks: OnboardingCallbacks): OnboardingOverlay {
  const dialog = document.createElement('dialog');
  dialog.className = 'dialog dialog--onboarding';
  dialog.setAttribute('aria-labelledby', 'onboarding-title');

  const heading = document.createElement('h2');
  heading.id = 'onboarding-title';
  heading.textContent = 'Welcome to Local Notes & Web Archive';

  const intro = document.createElement('p');
  intro.className = 'onboarding__intro';
  intro.textContent =
    'A local-first notebook and web archive. Here is what that means for your data — five short points, no account required.';

  const list = document.createElement('ol');
  list.className = 'onboarding__list';
  for (const item of SECTIONS) {
    const entry = document.createElement('li');
    entry.className = 'onboarding__item';
    const title = document.createElement('h3');
    title.textContent = item.title;
    const body = document.createElement('p');
    body.textContent = item.body;
    entry.append(title, body);
    list.append(entry);
  }

  const actions = document.createElement('div');
  actions.className = 'dialog__actions onboarding__actions';

  const settingsButton = document.createElement('button');
  settingsButton.type = 'button';
  settingsButton.className = 'btn';
  settingsButton.textContent = 'Open Settings first';
  settingsButton.addEventListener('click', () => {
    dialog.close();
    callbacks.openSettings();
  });

  const startButton = document.createElement('button');
  startButton.type = 'button';
  startButton.className = 'btn btn--primary';
  startButton.textContent = 'Get started';
  startButton.addEventListener('click', () => {
    startButton.disabled = true;
    void callbacks
      .complete()
      .then(() => {
        callbacks.announce('Onboarding complete. Your notes stay on this device.');
        dialog.close();
      })
      .catch(() => {
        startButton.disabled = false;
        callbacks.announce('Could not save the onboarding state — it will show again next time.');
      });
  });

  actions.append(settingsButton, startButton);
  dialog.append(heading, intro, list, actions);
  document.body.append(dialog);

  return {
    open(): void {
      if (!dialog.open) dialog.showModal();
      startButton.focus();
    },
    dispose(): void {
      dialog.remove();
    },
  };
}
