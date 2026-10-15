// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSnapshotsPanel,
  type SnapshotsPanelCallbacks,
} from '../../../../src/dashboard/editor/snapshots-panel';
import {
  createDuplicateDecisionMonitor,
  type DuplicateDecisionCallbacks,
} from '../../../../src/dashboard/views/duplicate-dialog';
import type { WaitingDedupEntry } from '../../../../src/background/capture/queue';
import type { EntityId, Link, LinkCaptureState, Snapshot, UtcTimestamp } from '../../../../src/core/types';

/**
 * T-026 UI (FR-CAP-06/07/08): the snapshots panel previews saved PNGs and
 * extracted text (MHTML bytes are NEVER rendered), exports all three
 * artifacts as user-initiated anchor downloads, compares revisions by
 * timestamp, renames and deletes with confirmations — and the duplicate
 * decision monitor presents parked `ask`-policy decisions one at a time.
 */

let root: HTMLElement;
let objectUrlCounter = 0;
const revokedUrls: string[] = [];

const NOTE_ID = 'note-0001' as EntityId;

beforeEach(() => {
  objectUrlCounter = 0;
  revokedUrls.length = 0;
  (window as unknown as { URL: typeof URL }).URL.createObjectURL = vi.fn(
    () => `blob:object-${++objectUrlCounter}`,
  );
  (window as unknown as { URL: typeof URL }).URL.revokeObjectURL = vi.fn((url: string) => {
    revokedUrls.push(url);
  });
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
  root = document.createElement('div');
  document.body.appendChild(root);
});

afterEach(() => {
  root.remove();
  // Panels append dialogs to document.body — clear leftovers so tests
  // stay isolated even when an assertion fails mid-dialog.
  for (const dialog of Array.from(document.body.querySelectorAll('dialog'))) {
    dialog.remove();
  }
});

interface SnapshotOverrides {
  id?: string;
  title?: string;
  capturedAt?: string;
  status?: Snapshot['status'];
  mhtml?: Snapshot['mhtml'];
  png?: Snapshot['png'];
  text?: Snapshot['text'];
  extractedText?: string;
  warnings?: Snapshot['warnings'];
  mhtmlSize?: number;
  previousSnapshotId?: string | null;
}

function makeSnapshot(overrides: SnapshotOverrides = {}): Snapshot {
  const capturedAt = (overrides.capturedAt ?? '2026-10-01T10:00:00.000Z') as UtcTimestamp;
  return {
    id: (overrides.id ?? 'snap-0001') as EntityId,
    noteId: NOTE_ID,
    linkId: 'link-0001' as EntityId,
    sourceUrl: 'https://example.com/article',
    finalUrl: 'https://example.com/article',
    canonicalUrl: null,
    title: overrides.title ?? 'Example article',
    capturedAt,
    status: overrides.status ?? 'complete',
    mhtml: overrides.mhtml ?? 'saved',
    png: overrides.png ?? 'saved',
    text: overrides.text ?? 'saved',
    mhtmlBlobKey: overrides.mhtml === 'saved' ? ('blob:mhtml-1' as unknown as Snapshot['mhtmlBlobKey']) : null,
    pngBlobKey: overrides.png === 'saved' ? ('blob:png-1' as unknown as Snapshot['pngBlobKey']) : null,
    extractedText: overrides.extractedText ?? 'The readable text of the captured page.',
    mhtmlHash: null,
    pngHash: null,
    format: 'mhtml',
    mhtmlSize: overrides.mhtmlSize ?? 2048,
    pngSize: 40960,
    textSize: (overrides.extractedText ?? 'The readable text of the captured page.').length,
    warnings: overrides.warnings ?? [],
    previousSnapshotId: (overrides.previousSnapshotId ?? null) as Snapshot['previousSnapshotId'],
  };
}

interface PanelHarness {
  callbacks: SnapshotsPanelCallbacks & {
    listed: string[];
    renamed: { id: EntityId; title: string }[];
    removed: EntityId[];
    exports: { id: EntityId; format: string }[];
    pngRequests: EntityId[];
    announced: string[];
    closed: number;
    links: Link[];
    permissionRequests: EntityId[];
    grantResult: boolean;
    retryRequests: EntityId[];
    retryResult: boolean;
    snapshots: Snapshot[];
  };
  panel: ReturnType<typeof createSnapshotsPanel>;
}

async function mountPanel(initial: Snapshot[]): Promise<PanelHarness> {
  const callbacks = {
    listed: [] as string[],
    renamed: [] as { id: EntityId; title: string }[],
    removed: [] as EntityId[],
    exports: [] as { id: EntityId; format: string }[],
    pngRequests: [] as EntityId[],
    announced: [] as string[],
    closed: 0,
    snapshots: [...initial],
    links: [] as Link[],
    permissionRequests: [] as EntityId[],
    grantResult: true,
    retryRequests: [] as EntityId[],
    retryResult: true,
    async listForNote(noteId: EntityId): Promise<readonly Snapshot[]> {
      this.listed.push(noteId);
      return this.snapshots;
    },
    async listLinks(): Promise<readonly Link[]> {
      return this.links;
    },
    async requestCapturePermission(linkId: EntityId): Promise<{ granted: boolean }> {
      this.permissionRequests.push(linkId);
      if (this.grantResult) {
        const link = this.links.find((l) => l.id === linkId);
        if (link) link.captureState = 'queued';
      }
      return { granted: this.grantResult };
    },
    async retryCapture(linkId: EntityId): Promise<boolean> {
      this.retryRequests.push(linkId);
      if (this.retryResult) {
        const link = this.links.find((l) => l.id === linkId);
        if (link) link.captureState = 'queued';
      }
      return this.retryResult;
    },
    async getPng(snapshotId: EntityId): Promise<Blob | null> {
      this.pngRequests.push(snapshotId);
      return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
    },
    async exportArtifact(
      snapshotId: EntityId,
      format: 'mhtml' | 'png' | 'text',
    ): Promise<{ blob: Blob; filename: string }> {
      this.exports.push({ id: snapshotId, format });
      if (format === 'text') {
        return { blob: new Blob(['extracted'], { type: 'text/plain' }), filename: 'a.txt' };
      }
      throw new Error('not requested in this test');
    },
    async rename(snapshotId: EntityId, title: string): Promise<boolean> {
      this.renamed.push({ id: snapshotId, title });
      const target = this.snapshots.find((s) => s.id === snapshotId);
      if (target) target.title = title;
      return true;
    },
    async remove(snapshotId: EntityId): Promise<boolean> {
      this.removed.push(snapshotId);
      this.snapshots = this.snapshots.filter((s) => s.id !== snapshotId);
      return true;
    },
    announce(message: string): void {
      this.announced.push(message);
    },
    onClose(): void {
      this.closed += 1;
    },
  };
  const panel = createSnapshotsPanel(NOTE_ID, callbacks);
  root.append(panel.element);
  // The panel loads its first list asynchronously — wait for it to land.
  await waitFor(() => callbacks.listed.length > 0);
  return { callbacks, panel };
}

async function flush(millis = 10): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, millis));
}

async function waitFor<T>(probe: () => T | Promise<T>, timeoutMs = 4000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await flush(10);
  }
}

function rowButtons(row: HTMLElement): HTMLButtonElement[] {
  return Array.from(row.querySelectorAll('button')) as HTMLButtonElement[];
}

async function openPreview(panel: PanelHarness['panel']): Promise<HTMLDialogElement> {
  const row = panel.element.querySelector('.snapshots-panel__row') as HTMLElement;
  const preview = rowButtons(row).find((b) => b.textContent === 'Preview') as HTMLButtonElement;
  preview.click();
  // The preview dialog is appended after its async PNG fetch resolves.
  await waitFor(() => document.querySelector('.dialog--preview') !== null);
  return document.querySelector('.dialog--preview') as HTMLDialogElement;
}

describe('snapshots panel', () => {
  it('carries an in-surface Close control that invokes onClose (UX-02)', async () => {
    const { panel, callbacks } = await mountPanel([]);
    const close = panel.element.querySelector('.panel-header__close') as HTMLButtonElement;
    expect(close).toBeTruthy();
    expect(close.getAttribute('aria-label')).toBe('Close snapshots');
    close.click();
    expect(callbacks.closed).toBe(1);
  });
  it('renders rows with status chips, artifact summaries and warning counts', async () => {
    const { panel } = await mountPanel([
      makeSnapshot({
        id: 'snap-1',
        title: 'First capture',
        warnings: [{ kind: 'lazy-content', detail: '3 lazy images' }],
      }),
      makeSnapshot({ id: 'snap-2', title: '', status: 'partial', png: 'failed' }),
    ]);

    const rows = panel.element.querySelectorAll('.snapshots-panel__row');
    expect(rows.length).toBe(2);

    const first = rows[0] as HTMLElement;
    expect(first.querySelector('.snapshot-status--complete')?.textContent).toBe('complete');
    expect(first.querySelector('.snapshots-panel__title')?.textContent).toBe('First capture');
    expect(first.querySelector('.snapshots-panel__meta')?.textContent).toContain(
      'Page copy saved · Screenshot saved · Text saved',
    );
    expect(first.querySelector('.snapshots-panel__meta')?.textContent).toContain('1 warning');

    const second = rows[1] as HTMLElement;
    expect(second.querySelector('.snapshot-status--partial')?.textContent).toBe('partial');
    expect(second.querySelector('.snapshots-panel__title')?.textContent).toBe('Untitled snapshot');
    expect(second.querySelector('.snapshots-panel__meta')?.textContent).toContain('Screenshot failed');

    expect(panel.element.querySelector('.snapshots-panel__empty')?.hasAttribute('hidden')).toBe(
      true,
    );
  });

  it('shows the empty state with guidance and no count when there are no snapshots', async () => {
    const { panel } = await mountPanel([]);
    await flush();
    expect(panel.element.querySelectorAll('.snapshots-panel__row').length).toBe(0);
    const empty = panel.element.querySelector('.snapshots-panel__empty') as HTMLElement;
    expect(empty.hasAttribute('hidden')).toBe(false);
    expect(empty.textContent).toContain('No snapshots yet');
    expect(panel.element.querySelector('.snapshots-panel__count')?.textContent).toBe('');
  });

  it('shows the snapshot count label', async () => {
    const { panel } = await mountPanel([makeSnapshot({ id: 'a' }), makeSnapshot({ id: 'b' })]);
    await waitFor(
      () => panel.element.querySelector('.snapshots-panel__count')?.textContent === '2 snapshots',
    );
  });

  it('previews the saved PNG and extracted text, and never renders MHTML bytes (FR-CAP-06)', async () => {
    const { callbacks, panel } = await mountPanel([makeSnapshot()]);
    const dialog = await openPreview(panel);
    await waitFor(() => callbacks.pngRequests.length > 0);

    const image = dialog.querySelector('.snapshot-preview__image') as HTMLImageElement;
    expect(image).not.toBeNull();
    expect(image.src).toMatch(/^blob:object-/);
    expect(image.alt).toContain('screenshot');

    const textBlock = dialog.querySelector('.snapshot-preview__text-block') as HTMLElement;
    expect(textBlock.textContent).toBe('The readable text of the captured page.');

    // The honest MHTML note is present; no iframe/embed/object anywhere.
    expect(dialog.querySelector('.snapshot-preview__mhtml-note')?.textContent).toContain(
      'never opened inside the app',
    );
    expect(dialog.querySelector('iframe')).toBeNull();
    expect(dialog.querySelector('embed')).toBeNull();
    expect(dialog.querySelector('object')).toBeNull();
    expect(dialog.querySelector('.snapshot-preview__meta')?.textContent).toContain('2026-10-01');
  });

  it('previews truthfully when the PNG artifact was not saved', async () => {
    const { callbacks, panel } = await mountPanel([makeSnapshot({ png: 'failed' })]);
    const dialog = await openPreview(panel);
    await flush();
    expect(dialog.querySelector('img')).toBeNull();
    expect(dialog.textContent).toContain('No screenshot in this snapshot (PNG failed)');
    expect(callbacks.pngRequests.length).toBe(0);
  });

  it('gates export buttons on artifact states, including Export text', async () => {
    const { panel } = await mountPanel([makeSnapshot({ png: 'failed', text: 'not-attempted' })]);
    const dialog = await openPreview(panel);
    await flush();

    const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>('.dialog__actions button')).map(
      (b) => b as HTMLButtonElement,
    );
    const byLabel = new Map(buttons.map((b) => [b.textContent ?? '', b]));
    expect(byLabel.get('Export saved page…')?.disabled).toBe(false);
    expect(byLabel.get('Export PNG…')?.disabled).toBe(true);
    expect(byLabel.get('Export text…')?.disabled).toBe(true);
    expect(byLabel.get('Export PNG…')?.title).toContain('PNG artifact was not saved');
    expect(byLabel.get('Export text…')?.title).toContain('No extracted text');
  });

  it('exports the text artifact as a user-initiated anchor download', async () => {
    const { callbacks, panel } = await mountPanel([makeSnapshot()]);
    const dialog = await openPreview(panel);
    await flush();

    const clicks: { download: string | null; href: string }[] = [];
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicks.push({ download: this.getAttribute('download'), href: this.href });
      });

    const exportText = Array.from(dialog.querySelectorAll<HTMLButtonElement>('.dialog__actions button')).find(
      (b) => b.textContent === 'Export text…',
    ) as HTMLButtonElement;
    exportText.click();
    await waitFor(() => clicks.length > 0);

    expect(callbacks.exports).toEqual([{ id: 'snap-0001' as EntityId, format: 'text' }]);
    expect(clicks[0]!.download).toBe('a.txt');
    expect(clicks[0]!.href).toMatch(/^blob:object-/);
    expect(callbacks.announced.join(' ')).toContain('a.txt');
    clickSpy.mockRestore();
  });

  it('disables the row saved-page export action when the archive was not saved', async () => {
    const { panel } = await mountPanel([makeSnapshot({ mhtml: 'failed' })]);
    const row = panel.element.querySelector('.snapshots-panel__row') as HTMLElement;
    const exportButton = rowButtons(row).find((b) => b.textContent === 'Export saved page…') as HTMLButtonElement;
    expect(exportButton.disabled).toBe(true);
    expect(exportButton.title).toContain('complete saved copy of the page was not stored');
  });

  it('surfaces a truthful error when the export refuses to produce a file', async () => {
    const { callbacks, panel } = await mountPanel([makeSnapshot()]);
    callbacks.exportArtifact = async () => {
      throw new Error('the mhtml artifact of this snapshot was not saved');
    };
    const row = panel.element.querySelector('.snapshots-panel__row') as HTMLElement;
    const exportButton = rowButtons(row).find((b) => b.textContent === 'Export saved page…') as HTMLButtonElement;
    exportButton.click();
    await waitFor(
      () =>
        panel.element.querySelector('.snapshots-panel__status--error')?.textContent?.includes(
          'failed',
        ) === true,
    );
  });

  it('compares two revisions by timestamp in Earlier/Later order', async () => {
    const { callbacks, panel } = await mountPanel([
      makeSnapshot({ id: 'snap-new', capturedAt: '2026-10-05T10:00:00.000Z', title: 'Newer' }),
      makeSnapshot({ id: 'snap-old', capturedAt: '2026-10-01T10:00:00.000Z', title: 'Older' }),
    ]);
    const rows = Array.from(panel.element.querySelectorAll('.snapshots-panel__row')) as HTMLElement[];

    // First click selects the newer snapshot.
    rowButtons(rows[0]!).find((b) => b.textContent === 'Compare…')!.click();
    const status = panel.element.querySelector('.snapshots-panel__status') as HTMLElement;
    expect(status.textContent).toContain('Selected for comparison');

    // Comparing the SAME snapshot is refused.
    rowButtons(rows[0]!).find((b) => b.textContent === 'Compare…')!.click();
    expect(panel.element.querySelector('.dialog--compare')).toBeNull();
    expect(status.textContent).toContain('DIFFERENT snapshot');

    // Comparing the older one opens the dialog.
    rowButtons(rows[1]!).find((b) => b.textContent === 'Compare…')!.click();
    const dialog = document.querySelector('.dialog--compare') as HTMLDialogElement;
    expect(dialog).not.toBeNull();
    const columns = dialog.querySelectorAll('.snapshot-compare__column');
    expect(columns.length).toBe(2);
    expect(columns[0]?.querySelector('h3')?.textContent).toContain('Older');
    expect(columns[1]?.querySelector('h3')?.textContent).toContain('Newer');
    expect(dialog.querySelector('.snapshot-compare__excerpt')?.textContent).toContain(
      'The readable text',
    );
    await waitFor(() => callbacks.pngRequests.length > 0);
  });

  it('renames through a dialog and refreshes the row', async () => {
    const { callbacks, panel } = await mountPanel([makeSnapshot({ title: 'Before' })]);
    const row = panel.element.querySelector('.snapshots-panel__row') as HTMLElement;
    rowButtons(row).find((b) => b.textContent === 'Rename')!.click();

    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    const input = dialog.querySelector('input[type="text"]') as HTMLInputElement;
    input.value = '  Renamed title  ';
    Array.from(dialog.querySelectorAll<HTMLButtonElement>('.dialog__actions button'))
      .find((b) => b.textContent === 'Rename')!
      .click();
    await waitFor(
      () => panel.element.querySelector('.snapshots-panel__title')?.textContent === 'Renamed title',
    );

    expect(callbacks.renamed).toEqual([
      { id: 'snap-0001' as EntityId, title: 'Renamed title' },
    ]);
    expect(panel.element.querySelector('.snapshots-panel__status')?.textContent).toContain(
      'Renamed the snapshot',
    );
  });

  it('refuses an empty rename without calling the API', async () => {
    const { callbacks, panel } = await mountPanel([makeSnapshot({ title: 'Keep me' })]);
    const row = panel.element.querySelector('.snapshots-panel__row') as HTMLElement;
    rowButtons(row).find((b) => b.textContent === 'Rename')!.click();

    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    const input = dialog.querySelector('input[type="text"]') as HTMLInputElement;
    input.value = '   ';
    Array.from(dialog.querySelectorAll<HTMLButtonElement>('.dialog__actions button'))
      .find((b) => b.textContent === 'Rename')!
      .click();
    await flush();
    expect(callbacks.renamed.length).toBe(0);
    expect(dialog.open).toBe(true);
  });

  it('deletes after an explicit confirmation and refreshes the list', async () => {
    const { callbacks, panel } = await mountPanel([makeSnapshot({ id: 'snap-x' })]);
    const row = panel.element.querySelector('.snapshots-panel__row') as HTMLElement;

    rowButtons(row).find((b) => b.textContent === 'Delete…')!.click();
    const confirmDialog = document.querySelector('.dialog--confirm') as HTMLDialogElement;
    expect(confirmDialog.textContent).toContain('Delete snapshot?');

    // Cancel keeps the snapshot.
    Array.from(confirmDialog.querySelectorAll<HTMLButtonElement>('.dialog__actions button'))
      .find((b) => b.textContent === 'Cancel')!
      .click();
    await flush();
    expect(callbacks.removed.length).toBe(0);

    // Confirm removes it.
    rowButtons(row).find((b) => b.textContent === 'Delete…')!.click();
    const again = document.querySelector('.dialog--confirm') as HTMLDialogElement;
    Array.from(again.querySelectorAll<HTMLButtonElement>('.dialog__actions button'))
      .find((b) => b.textContent === 'Delete snapshot')!
      .click();
    await waitFor(() => callbacks.removed.length === 1);
    expect(callbacks.removed[0]).toBe('snap-x' as EntityId);
    await waitFor(() => panel.element.querySelectorAll('.snapshots-panel__row').length === 0);
    expect(panel.element.querySelector('.snapshots-panel__empty')?.hasAttribute('hidden')).toBe(
      false,
    );
  });

  it('refresh() re-reads the list so new captures appear', async () => {
    const { callbacks, panel } = await mountPanel([makeSnapshot({ id: 'snap-1' })]);
    callbacks.snapshots.push(makeSnapshot({ id: 'snap-2', title: 'Second' }));
    await panel.refresh();
    const titles = Array.from(
      panel.element.querySelectorAll('.snapshots-panel__title'),
    ).map((t) => t.textContent);
    expect(titles).toContain('Second');
    expect(panel.element.querySelector('.snapshots-panel__count')?.textContent).toBe(
      '2 snapshots',
    );
  });

  it('dispose removes the element and revokes tracked object URLs', async () => {
    const { panel } = await mountPanel([makeSnapshot()]);
    const dialog = await openPreview(panel);
    await waitFor(() => objectUrlCounter > 0);
    panel.dispose();
    expect(dialog.parentElement).toBeNull();
    expect(panel.element.parentElement).toBeNull();
    expect(revokedUrls.length).toBeGreaterThan(0);
  });

  it('lists listing failures truthfully', async () => {
    const callbacks: SnapshotsPanelCallbacks = {
      listForNote: async (): Promise<readonly Snapshot[]> => {
        throw new Error('database unavailable');
      },
      listLinks: async (): Promise<readonly Link[]> => [],
      requestCapturePermission: async (): Promise<{ granted: boolean }> => ({ granted: false }),
      retryCapture: async (): Promise<boolean> => false,
      getPng: async (): Promise<null> => null,
      exportArtifact: async (): Promise<{ blob: Blob; filename: string }> => {
        throw new Error('unreachable');
      },
      rename: async (): Promise<boolean> => false,
      remove: async (): Promise<boolean> => false,
      announce: (): void => undefined,
      onClose: (): void => undefined,
    };
    const panel = createSnapshotsPanel(NOTE_ID, callbacks);
    root.append(panel.element);
    await flush();
    expect(panel.element.querySelector('.snapshots-panel__status--error')?.textContent).toContain(
      'Listing snapshots failed',
    );
  });
});

describe('duplicate decision monitor (FR-CAP-08 ask policy)', () => {
  function makeEntry(linkId: string, url: string, enqueuedAt: string): WaitingDedupEntry {
    return {
      linkId: linkId as EntityId,
      noteId: NOTE_ID,
      url,
      duplicateUrl: 'https://example.com/earlier',
      enqueuedAt: enqueuedAt as UtcTimestamp,
    };
  }

  interface MonitorCallbacks extends DuplicateDecisionCallbacks {
    waiting: WaitingDedupEntry[];
    resolutions: { linkId: EntityId; resolution: string }[];
    announced: string[];
    statusCalls: number;
    failStatus: boolean;
  }

  function makeCallbacks(waiting: WaitingDedupEntry[]): MonitorCallbacks {
    return {
      waiting,
      resolutions: [],
      announced: [],
      statusCalls: 0,
      failStatus: false,
      async status(): Promise<{ waitingDedup: readonly WaitingDedupEntry[] }> {
        this.statusCalls += 1;
        if (this.failStatus) throw new Error('queue unreachable');
        return { waitingDedup: this.waiting };
      },
      async resolveDuplicate(linkId: EntityId, resolution: 'reuse' | 'new'): Promise<boolean> {
        this.resolutions.push({ linkId, resolution });
        this.waiting = this.waiting.filter((entry) => entry.linkId !== linkId);
        return true;
      },
      announce(message: string): void {
        this.announced.push(message);
      },
    };
  }

  function dialogButtons(): HTMLButtonElement[] {
    const dialog = document.querySelector('.dialog--confirm') as HTMLDialogElement | null;
    if (!dialog) return [];
    return Array.from(dialog.querySelectorAll('button')) as HTMLButtonElement[];
  }

  it('presents the oldest parked decision and resolves reuse', async () => {
    const callbacks = makeCallbacks([
      makeEntry('link-a', 'https://example.com/a', '2026-10-01T00:00:00.000Z'),
      makeEntry('link-b', 'https://example.com/b', '2026-10-02T00:00:00.000Z'),
    ]);
    const monitor = createDuplicateDecisionMonitor(callbacks);
    await monitor.refresh();

    const dialog = document.querySelector('.dialog--confirm') as HTMLDialogElement;
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain('This page is already captured');
    expect(dialog.textContent).toContain('https://example.com/a'); // oldest first
    expect(dialog.textContent).toContain('https://example.com/earlier');

    dialogButtons().find((b) => b.textContent === 'Reuse existing capture')!.click();
    await waitFor(() => callbacks.resolutions.length === 1);
    expect(callbacks.resolutions[0]).toEqual({ linkId: 'link-a' as EntityId, resolution: 'reuse' });
    expect(callbacks.announced.join(' ')).toContain('Reusing the existing capture');

    // The next waiting decision is presented after the first resolves.
    await waitFor(() => document.querySelector('.dialog--confirm') !== null);
    expect(document.querySelector('.dialog--confirm')?.textContent).toContain(
      'https://example.com/b',
    );
    monitor.dispose();
  });

  it('resolves a fresh capture on the second choice', async () => {
    const callbacks = makeCallbacks([makeEntry('link-1', 'https://example.com/one', '2026-10-01T00:00:00.000Z')]);
    const monitor = createDuplicateDecisionMonitor(callbacks);
    await monitor.refresh();

    dialogButtons().find((b) => b.textContent === 'Capture fresh copy')!.click();
    await waitFor(() => callbacks.resolutions.length === 1);
    expect(callbacks.resolutions[0]!.resolution).toBe('new');
    expect(callbacks.announced.join(' ')).toContain('Capturing a fresh copy');
    monitor.dispose();
  });

  it('never re-prompts the same link and keeps one dialog at a time', async () => {
    const callbacks = makeCallbacks([makeEntry('link-1', 'https://example.com/one', '2026-10-01T00:00:00.000Z')]);
    const monitor = createDuplicateDecisionMonitor(callbacks);
    await monitor.refresh();
    expect(document.querySelectorAll('.dialog--confirm').length).toBe(1);

    // Refresh while the dialog is open: no second dialog.
    await monitor.refresh();
    expect(document.querySelectorAll('.dialog--confirm').length).toBe(1);

    dialogButtons().find((b) => b.textContent === 'Reuse existing capture')!.click();
    await waitFor(() => callbacks.resolutions.length === 1);

    // The entry is gone from the queue; a refresh must not re-prompt it.
    await monitor.refresh();
    await flush();
    expect(document.querySelector('.dialog--confirm')).toBeNull();
    expect(callbacks.resolutions.length).toBe(1);
    monitor.dispose();
  });

  it('tolerates an unreachable queue status without presenting anything', async () => {
    const callbacks = makeCallbacks([]);
    callbacks.failStatus = true;
    const monitor = createDuplicateDecisionMonitor(callbacks);
    await monitor.refresh();
    expect(document.querySelector('.dialog--confirm')).toBeNull();
    expect(callbacks.statusCalls).toBe(1);
    monitor.dispose();
  });

  it('dispose stops presenting new decisions', async () => {
    const callbacks = makeCallbacks([makeEntry('link-1', 'https://example.com/one', '2026-10-01T00:00:00.000Z')]);
    const monitor = createDuplicateDecisionMonitor(callbacks);
    monitor.dispose();
    await monitor.refresh();
    expect(document.querySelector('.dialog--confirm')).toBeNull();
    expect(callbacks.statusCalls).toBe(0);
  });

  it('survives a failing resolution and still closes the dialog', async () => {
    const callbacks = makeCallbacks([makeEntry('link-1', 'https://example.com/one', '2026-10-01T00:00:00.000Z')]);
    callbacks.resolveDuplicate = async () => {
      throw new Error('rpc failed');
    };
    const monitor = createDuplicateDecisionMonitor(callbacks);
    await monitor.refresh();

    dialogButtons().find((b) => b.textContent === 'Reuse existing capture')!.click();
    await waitFor(() => document.querySelector('.dialog--confirm') === null);
    expect(callbacks.announced.length).toBe(0); // no false success announcement
    monitor.dispose();
  });
});

describe('grant-access affordance (QA-D06)', () => {
  it('shows Grant access for a permission-required link and requests the permission on click', async () => {
    const { callbacks, panel } = await mountPanel([]);
    const r = panel.element;
    callbacks.links = [{ id: 'link-1' as EntityId, noteId: NOTE_ID, originalUrl: 'https://example.com/x', dedupKey: 'k1', anchorText: '', origin: 'https://example.com', createdAt: '2026-01-01T00:00:00.000Z' as UtcTimestamp, snapshotId: null, captureState: 'permission-required' as LinkCaptureState }];
    await panel.refresh();
    const grantRow = r.querySelector('.snapshots-panel__grant-row');
    expect(grantRow).not.toBeNull();
    expect(grantRow?.textContent).toContain('Capture waiting for access to https://example.com.');
    const button = grantRow?.querySelector('button');
    expect(button?.textContent).toBe('Grant access…');
    await (button as HTMLButtonElement).click();
    await waitFor(() => callbacks.permissionRequests.length === 1);
    expect(callbacks.permissionRequests[0]).toBe('link-1' as EntityId);
    expect(callbacks.announced.some((m) => m.includes('Access granted'))).toBe(true);
    // Granted link no longer waits: the affordance disappears on refresh.
    await waitFor(() => r.querySelector('.snapshots-panel__grant-row') === null);
  });

  it('hides the affordance when no link is waiting on permission', async () => {
    const { callbacks, panel } = await mountPanel([]);
    const r = panel.element;
    callbacks.links = [{ id: 'link-2' as EntityId, noteId: NOTE_ID, originalUrl: 'https://other.test/y', dedupKey: 'k2', anchorText: '', origin: 'https://other.test', createdAt: '2026-01-01T00:00:00.000Z' as UtcTimestamp, snapshotId: null, captureState: 'captured' as LinkCaptureState }];
    await panel.refresh();
    expect(r.querySelector('.snapshots-panel__grant-row')).toBeNull();
    expect((r.querySelector('.snapshots-panel__grant') as HTMLElement).hidden).toBe(true);
  });
});

describe('retry-capture affordance (QA-D07)', () => {
  it('shows Retry capture for a failed link and re-queues it on click', async () => {
    const { callbacks, panel } = await mountPanel([]);
    const r = panel.element;
    callbacks.links = [{ id: 'link-f1' as EntityId, noteId: NOTE_ID, originalUrl: 'https://fail.test/x', dedupKey: 'kf1', anchorText: '', origin: 'https://fail.test', createdAt: '2026-01-01T00:00:00.000Z' as UtcTimestamp, snapshotId: null, captureState: 'failed' as LinkCaptureState }];
    await panel.refresh();
    const retryRow = r.querySelector('.snapshots-panel__retry-row');
    expect(retryRow).not.toBeNull();
    expect(retryRow?.textContent).toContain('Capture failed for https://fail.test.');
    const button = retryRow?.querySelector('button');
    expect(button?.textContent).toBe('Retry capture');
    await (button as HTMLButtonElement).click();
    await waitFor(() => callbacks.retryRequests.length === 1);
    expect(callbacks.retryRequests[0]).toBe('link-f1' as EntityId);
    expect(callbacks.announced.some((m) => m.includes('Retrying the capture of https://fail.test'))).toBe(true);
    // Re-queued link no longer failed: the affordance disappears on refresh.
    await waitFor(() => r.querySelector('.snapshots-panel__retry-row') === null);
  });

  it('hides the retry affordance when no link is failed and reports honestly when re-queueing fails', async () => {
    const { callbacks, panel } = await mountPanel([]);
    const r = panel.element;
    callbacks.links = [{ id: 'link-f2' as EntityId, noteId: NOTE_ID, originalUrl: 'https://ok.test/y', dedupKey: 'kf2', anchorText: '', origin: 'https://ok.test', createdAt: '2026-01-01T00:00:00.000Z' as UtcTimestamp, snapshotId: null, captureState: 'queued' as LinkCaptureState }];
    await panel.refresh();
    expect(r.querySelector('.snapshots-panel__retry-row')).toBeNull();
    expect((r.querySelector('.snapshots-panel__retry') as HTMLElement).hidden).toBe(true);
    // Honest failure path: retryCapture resolving false keeps the row + a status message.
    callbacks.retryResult = false;
    callbacks.links[0]!.captureState = 'failed' as LinkCaptureState;
    await panel.refresh();
    const button = r.querySelector<HTMLButtonElement>('.snapshots-panel__retry-row button');
    expect(button).not.toBeNull();
    await button!.click();
    await waitFor(() => callbacks.retryRequests.length === 1);
    const status = r.querySelector('.snapshots-panel__status') as HTMLElement;
    expect(status.textContent).toContain('could not be re-queued');
    expect(r.querySelector('.snapshots-panel__retry-row')).not.toBeNull();
  });
});

describe('recapture affordance (QA-D09)', () => {
  it('shows Capture fresh copy… for a captured link and re-queues it on click', async () => {
    const { callbacks, panel } = await mountPanel([]);
    const r = panel.element;
    callbacks.links = [{ id: 'link-c1' as EntityId, noteId: NOTE_ID, originalUrl: 'https://recap.test/x', dedupKey: 'kc1', anchorText: '', origin: 'https://recap.test', createdAt: '2026-01-01T00:00:00.000Z' as UtcTimestamp, snapshotId: 'snap-0001' as EntityId, captureState: 'captured' as LinkCaptureState }];
    await panel.refresh();
    const rows = r.querySelectorAll('.snapshots-panel__retry-row');
    expect(rows.length).toBe(1);
    expect(rows[0]?.textContent).toContain('A fresh capture of https://recap.test adds a new revision you can compare.');
    const button = rows[0]?.querySelector('button');
    expect(button?.textContent).toBe('Capture fresh copy…');
    await (button as HTMLButtonElement).click();
    await waitFor(() => callbacks.retryRequests.length === 1);
    expect(callbacks.retryRequests[0]).toBe('link-c1' as EntityId);
    expect(callbacks.announced.some((m) => m.includes('Capturing a fresh copy of https://recap.test'))).toBe(true);
  });

  it('hides the recapture affordance for captured links without a snapshot', async () => {
    const { callbacks, panel } = await mountPanel([]);
    const r = panel.element;
    callbacks.links = [{ id: 'link-c2' as EntityId, noteId: NOTE_ID, originalUrl: 'https://bare.test/y', dedupKey: 'kc2', anchorText: '', origin: 'https://bare.test', createdAt: '2026-01-01T00:00:00.000Z' as UtcTimestamp, snapshotId: null, captureState: 'captured' as LinkCaptureState }];
    await panel.refresh();
    expect(r.querySelector('.snapshots-panel__retry-row')).toBeNull();
    expect((r.querySelector('.snapshots-panel__retry') as HTMLElement).hidden).toBe(true);
  });
});
