// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createOnboardingOverlay } from '../../../src/dashboard/views/onboarding';

/**
 * T-039 onboarding (FR-SET-02): the five honest sections render, completing
 * persists the flag and closes, and a failing completion keeps the dialog
 * with a truthful announcement. Nothing gates app usage.
 */

interface Harness {
  overlay: ReturnType<typeof createOnboardingOverlay>;
  completions: number;
  settingsOpened: number;
  announced: string[];
  failComplete(value: boolean): void;
}

function mountOverlay(): Harness {
  const completions = { count: 0 };
  const settingsOpened = { count: 0 };
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
  it('renders the five FR-SET-02 sections with honest content', () => {
    const harness = mountOverlay();
    harness.overlay.open();
    const text = dialogOf().textContent ?? '';
    expect(text).toContain('Everything stays on this device');
    expect(text).toContain('Saving web pages asks first');
    expect(text).toContain('Local AI is optional');
    expect(text).toContain('Reminders have honest limits');
    expect(text).toContain('Protect against data loss');
    expect(text).toContain('no account');
    expect(text).toContain('127.0.0.1 or localhost');
    expect(text).toContain('Export a complete backup ZIP');
    harness.overlay.dispose();
  });

  it('completes, announces and closes on Get started', async () => {
    const harness = mountOverlay();
    harness.overlay.open();
    const dialog = dialogOf();
    const start = [...dialog.querySelectorAll('button')].find(
      (button) => button.textContent === 'Get started',
    );
    start?.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(harness.completions).toBe(1);
    expect(harness.announced).toContain('Onboarding complete. Your notes stay on this device.');
    expect(dialog.open).toBe(false);
    harness.overlay.dispose();
  });

  it('keeps the dialog and announces honestly when the flag cannot be saved', async () => {
    const harness = mountOverlay();
    harness.failComplete(true);
    harness.overlay.open();
    const dialog = dialogOf();
    const start = [...dialog.querySelectorAll('button')].find(
      (button) => button.textContent === 'Get started',
    );
    start?.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(harness.completions).toBe(0);
    expect(harness.announced[0]).toContain('will show again next time');
    expect(dialog.open).toBe(true);
    harness.overlay.dispose();
  });

  it('re-enables Get started every time the overlay is re-shown (T-067, audit D-05)', async () => {
    // The audit: Settings -> "Show the introduction again" presented a
    // permanently disabled primary button (Escape-only exit) because the
    // click handler only re-enabled it on FAILURE. Every open() resets it.
    const harness = mountOverlay();
    harness.overlay.open();
    const dialog = dialogOf();
    const start = [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === 'Get started',
    );

    // First completion disables the button and closes the dialog.
    start?.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(harness.completions).toBe(1);
    expect(dialog.open).toBe(false);
    expect(start?.disabled).toBe(true);

    // Re-show (the settings "Show the introduction again" path): the button
    // is enabled again and completes a second time.
    harness.overlay.open();
    expect(dialog.open).toBe(true);
    expect(start?.disabled).toBe(false);
    start?.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(harness.completions).toBe(2);
    expect(dialog.open).toBe(false);
    harness.overlay.dispose();
  });

  it('routes Open Settings first through the callback and closes', () => {
    const harness = mountOverlay();
    harness.overlay.open();
    const dialog = dialogOf();
    const settings = [...dialog.querySelectorAll('button')].find(
      (button) => button.textContent === 'Open Settings first',
    );
    settings?.click();
    expect(harness.settingsOpened).toBe(1);
    expect(dialog.open).toBe(false);
    harness.overlay.dispose();
  });
});
