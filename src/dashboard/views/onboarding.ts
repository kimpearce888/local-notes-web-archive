/**
 * First-run onboarding (T-039, FR-SET-02; restructured T-089/T-084
 * register UX-14): one accessible dialog that used to explain five privacy
 * points and never taught the product. It is now product-first: three
 * concrete first actions (create a note, save a web page, tag a note)
 * lead, the privacy promise and the backup advice condense behind them,
 * and the primary button IS the first action — "Create my first note"
 * completes onboarding and creates the note. "Skip for now" keeps the
 * plain dismiss path; "Open Settings first" keeps the pre-configuration
 * path (it still does not complete onboarding — the T-067 re-show
 * behavior is unchanged). Nothing here gates the app; the dialog informs
 * and leaves.
 */

export interface OnboardingCallbacks {
  /** Persist the completion flag (settings/set-onboarding-complete). */
  complete(): Promise<void>;
  /** Open the settings panel (AI endpoint configuration lives there). */
  openSettings(): void;
  /** Create the user's first note (T-089, UX-14: concrete first step). */
  createFirstNote(): void;
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

/** What to DO first — the product tour the register asked for. */
const START_SECTIONS: readonly OnboardingSection[] = [
  {
    title: 'Write your first note',
    body:
      'Click "New Note" (or press Alt+Shift+C) and start typing — formatting, images and tables are in ' +
      'the toolbar above the note. Everything saves automatically.',
  },
  {
    title: 'Save any web page for offline reading',
    body:
      'Click "Save a web page…" on the left and paste a link, or right-click a page in Chrome and choose ' +
      '"Save page as note". A complete copy of the page is stored on this device; you will be asked before ' +
      'each site is accessed.',
  },
  {
    title: 'Organize with tags, find anything',
    body:
      'Add tags right inside a note (under the subtitle). Use the search box and the Filters button to ' +
      'narrow the list; reminders live in the note\u2019s Reminders button.',
  },
];

/** The data promises, condensed (the full permission/AI detail stays in
 *  Settings where it belongs). */
const PRIVACY_SECTIONS: readonly OnboardingSection[] = [
  {
    title: 'Everything stays on this device',
    body:
      'Notes, saved pages, reminders and attachments live in this browser\u2019s local storage — no account, ' +
      'no cloud copy, no telemetry. Optional AI features run through LM Studio on your machine only ' +
      '(127.0.0.1), and every feature works without them.',
  },
  {
    title: 'Back up before big changes',
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
    'Your notebook and web archive — everything on this device, no account needed. Three ways to start:';

  const list = document.createElement('ol');
  list.className = 'onboarding__list';
  for (const item of [...START_SECTIONS, ...PRIVACY_SECTIONS]) {
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

  const skipButton = document.createElement('button');
  skipButton.type = 'button';
  skipButton.className = 'btn';
  skipButton.textContent = 'Skip for now';
  skipButton.addEventListener('click', () => {
    skipButton.disabled = true;
    void callbacks
      .complete()
      .then(() => {
        callbacks.announce('Onboarding complete. Your notes stay on this device.');
        dialog.close();
      })
      .catch(() => {
        skipButton.disabled = false;
        callbacks.announce('Could not save the onboarding state — it will show again next time.');
      });
  });

  // T-089 (UX-14): the primary action is the first thing the product wants
  // the user to DO, not an abstract dismissal.
  const createButton = document.createElement('button');
  createButton.type = 'button';
  createButton.className = 'btn btn--primary';
  createButton.textContent = 'Create my first note';
  createButton.addEventListener('click', () => {
    createButton.disabled = true;
    void callbacks
      .complete()
      .then(() => {
        callbacks.announce('Onboarding complete. Creating your first note.');
        dialog.close();
        callbacks.createFirstNote();
      })
      .catch(() => {
        createButton.disabled = false;
        callbacks.announce('Could not save the onboarding state — it will show again next time.');
      });
  });

  actions.append(settingsButton, skipButton, createButton);
  dialog.append(heading, intro, list, actions);
  document.body.append(dialog);

  return {
    open(): void {
      // T-067 (audit D-05): a re-shown onboarding must never present a
      // permanently disabled action — every fresh presentation resets all
      // three buttons so the dialog is always dismissible by its paths.
      skipButton.disabled = false;
      createButton.disabled = false;
      if (!dialog.open) dialog.showModal();
      createButton.focus();
    },
    dispose(): void {
      dialog.remove();
    },
  };
}
