// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSavePageDialog } from '../../../src/dashboard/views/save-page-dialog';

/**
 * T-089 (register UX-13): the web-archive feature's visible entry point.
 * Pins the dialog contract: http(s) validation with honest messages, the
 * save round trip (queued vs link-gate rejection announcements), Enter
 * parity, the reset-on-close behavior (no stale errors), and honest
 * failure reporting. The full RPC round trip and capture pipeline are
 * proven by the E2E battery against the built extension.
 */

interface Harness {
  dialog: ReturnType<typeof createSavePageDialog>;
  savedUrls: string[];
  queued: boolean[];
  announced: string[];
  setFail(value: boolean): void;
}

function mount(): Harness {
  const savedUrls: string[] = [];
  const queued: boolean[] = [];
  const announced: string[] = [];
  const state = { fail: false };
  const dialog = createSavePageDialog({
    saveUrl: async (url) => {
      if (state.fail) throw new Error('rpc down');
      savedUrls.push(url);
      // Truth-shaped: the link gate accepted everything in these tests
      // unless the caller pre-seeded a rejection.
      const accepted = !queued.includes(false);
      queued.push(accepted);
      return { queued: accepted };
    },
    announce: (message) => announced.push(message),
  });
  return {
    dialog,
    savedUrls,
    queued,
    announced,
    setFail: (value) => {
      state.fail = value;
    },
  };
}

function element(): HTMLDialogElement {
  const found = document.querySelector('dialog.dialog--save-page');
  if (!found) throw new Error('save-page dialog not mounted');
  return found as HTMLDialogElement;
}

function input(): HTMLInputElement {
  const found = element().querySelector<HTMLInputElement>('#save-page-input');
  if (!found) throw new Error('url input missing');
  return found;
}

function click(label: string): void {
  const found = [...element().querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === label,
  );
  if (!found) throw new Error(`button not found: ${label}`);
  found.click();
}

function statusText(): string {
  const status = element().querySelector('.save-page__status') as HTMLElement | null;
  return status?.textContent ?? '';
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

describe('save-page dialog', () => {
  it('renders the plain-language explanation and focuses the input on open', () => {
    const harness = mount();
    harness.dialog.open();
    expect(element().open).toBe(true);
    expect(element().textContent).toContain('Paste a link (http or https)');
    expect(element().textContent).toContain('you will be asked before the extension accesses that site');
    expect(document.activeElement).toBe(input());
    harness.dialog.dispose();
  });

  it('refuses empty and non-http(s) input with honest messages', () => {
    const harness = mount();
    harness.dialog.open();
    input().value = '';
    click('Save page');
    expect(statusText()).toContain('Paste a page link first');
    input().value = 'ftp://example.com/page';
    click('Save page');
    expect(statusText()).toContain('Only http(s) links can be saved');
    expect(harness.savedUrls).toHaveLength(0);
    harness.dialog.dispose();
  });

  it('saves the URL, closes and announces the queued capture', async () => {
    const harness = mount();
    harness.dialog.open();
    input().value = 'https://example.com/article';
    click('Save page');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(harness.savedUrls).toEqual(['https://example.com/article']);
    expect(element().open).toBe(false);
    expect(harness.announced.at(-1)).toContain('capture is being prepared');
    harness.dialog.dispose();
  });

  it('announces honestly when the link gate rejected the URL', async () => {
    const harness = mount();
    harness.queued.push(false); // next save is a link-gate rejection
    harness.dialog.open();
    input().value = 'https://example.com/rejected';
    click('Save page');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(harness.announced.at(-1)).toContain('link was not accepted for capture');
    expect(element().open).toBe(false);
    harness.dialog.dispose();
  });

  it('reports failures truthfully and keeps the dialog for a retry', async () => {
    const harness = mount();
    harness.setFail(true);
    harness.dialog.open();
    input().value = 'https://example.com/failing';
    click('Save page');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(statusText()).toContain('Saving the page failed — nothing was created');
    expect(element().open).toBe(true);
    harness.dialog.dispose();
  });

  it('submits on Enter and resets error state after a close', async () => {
    const harness = mount();
    harness.dialog.open();
    // Trigger a validation error first.
    input().value = 'not-a-url';
    click('Save page');
    expect(statusText()).toContain('Only http(s) links');
    // Close, re-open: the stale error and value are gone.
    click('Cancel');
    harness.dialog.open();
    expect(input().value).toBe('');
    expect(statusText()).toBe('');
    // Enter submits.
    input().value = 'https://example.com/enter';
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(harness.savedUrls).toEqual(['https://example.com/enter']);
    expect(element().open).toBe(false);
    harness.dialog.dispose();
  });
});
