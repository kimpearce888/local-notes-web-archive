// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOnboardingOverlay } from '../../../../src/dashboard/views/onboarding';

/**
 * T-039 onboarding (FR-SET-02), restructured T-089 (T-084 register UX-14):
 * the dialog teaches the PRODUCT first (three concrete first actions) with
 * the privacy promise and backup advice condensed behind them; the primary
 * action IS the first step ("Create my first note" completes AND creates),
 * "Skip for now" keeps the plain dismiss path, and a failing completion
 * keeps the dialog with a truthful announcement. Nothing gates app usage.
 */

interface Harness {
  overlay: ReturnType<typeof createOnboardingOverlay>;
  completions: number;
  settingsOpened: number;
  firstNotesCreated: number;
  announced: string[];
  failComplete(value: boolean): void;
}

function mountOverlay(): Harness {
  const completions = { count: 0 };
  const settingsOpened = { count: 0 };
  const firstNotesCreated = { count: 0 };
  const announced: string[] = [];
  let fail = false;
  const overlay = createOnboardingOverlay({
    complete: async () => {
      if (fail) throw new Error('storage unavailable');
      completions.count++;
    },
    openSettings: () => {
      settingsOpened.count++;
    },
    createFirstNote: () => {
      firstNotesCreated.count++;
    },
    announce: (message) => announced.push(message),
  });
  return {
    overlay,
    get completions() {
      return completions.count;
    },
    get settingsOpened() {
      return settingsOpened.count;
    },
    get firstNotesCreated() {
      return firstNotesCreated.count;
    },
    announced,
    failComplete(value) {
      fail = value;
    },
  };
}

function dialogOf(): HTMLDialogElement {
  const dialog = document.querySelector('dialog.dialog--onboarding');
  if (!dialog) throw new Error('onboarding dialog not mounted');
  return dialog as HTMLDialogElement;
}

function button(label: string): HTMLButtonElement {
  const found = [...dialogOf().querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === label,
  );
  if (!found) throw new Error(`button not found: ${label}`);
  return found;
}

beforeEach(() => {
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

describe('onboarding overlay', () => {
  it('teaches the product first, then the data promises (T-089, UX-14)', () => {
    const harness = mountOverlay();
    harness.overlay.open();
    const text = dialogOf().textContent ?? '';
    // Three concrete first actions lead.
    expect(text).toContain('Write your first note');
    expect(text).toContain('New Note');
    expect(text).toContain('Save any web page for offline reading');
    expect(text).toContain('Save a web page…');
    expect(text).toContain('Organize with tags, find anything');
    // The data promises condense behind them and stay honest.
    expect(text).toContain('Everything stays on this device');
    expect(text).toContain('no account');
    expect(text).toContain('Back up before big changes');
    expect(text).toContain('Export a complete backup ZIP');
    harness.overlay.dispose();
  });

  it('completes, creates the first note, announces and closes on the primary action', async () => {
    const harness = mountOverlay();
    harness.overlay.open();
    const dialog = dialogOf();
    button('Create my first note').click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(harness.completions).toBe(1);
    expect(harness.firstNotesCreated).toBe(1);
    expect(harness.announced).toContain('Onboarding complete. Creating your first note.');
    expect(dialog.open).toBe(false);
    harness.overlay.dispose();
  });

  it('Skip for now completes without creating anything', async () => {
    const harness = mountOverlay();
    harness.overlay.open();
    const dialog = dialogOf();
    button('Skip for now').click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(harness.completions).toBe(1);
    expect(harness.firstNotesCreated).toBe(0);
    expect(harness.announced).toContain('Onboarding complete. Your notes stay on this device.');
    expect(dialog.open).toBe(false);
    harness.overlay.dispose();
  });

  it('keeps the dialog and announces honestly when the flag cannot be saved', async () => {
    const harness = mountOverlay();
    harness.failComplete(true);
    harness.overlay.open();
    const dialog = dialogOf();
    button('Create my first note').click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(harness.completions).toBe(0);
    expect(harness.announced[0]).toContain('will show again next time');
    expect(dialog.open).toBe(true);
    harness.overlay.dispose();
  });

  it('re-enables every action each time the overlay is re-shown (T-067, audit D-05)', async () => {
    const harness = mountOverlay();
    harness.overlay.open();
    const dialog = dialogOf();
    const create = button('Create my first note');
    const skip = button('Skip for now');

    // First completion disables the buttons and closes the dialog.
    create.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(harness.completions).toBe(1);
    expect(dialog.open).toBe(false);
    expect(create.disabled).toBe(true);

    // Re-show (the settings "Show the introduction again" path): the
    // buttons are enabled again and the dismiss path completes.
    harness.overlay.open();
    expect(dialog.open).toBe(true);
    expect(create.disabled).toBe(false);
    expect(skip.disabled).toBe(false);
    skip.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(harness.completions).toBe(2);
    expect(dialog.open).toBe(false);
    harness.overlay.dispose();
  });

  it('routes Open Settings first through the callback and closes without completing', () => {
    const harness = mountOverlay();
    harness.overlay.open();
    const dialog = dialogOf();
    button('Open Settings first').click();
    expect(harness.settingsOpened).toBe(1);
    expect(harness.completions).toBe(0);
    expect(dialog.open).toBe(false);
    harness.overlay.dispose();
  });
});

describe('onboarding open() focuses the primary action', () => {
  it('focuses Create my first note so Enter starts the product tour', () => {
    const harness = mountOverlay();
    harness.overlay.open();
    const focused = document.activeElement;
    expect(focused instanceof HTMLButtonElement).toBe(true);
    expect((focused as HTMLButtonElement).textContent).toBe('Create my first note');
    vi.restoreAllMocks();
    harness.overlay.dispose();
  });
});
