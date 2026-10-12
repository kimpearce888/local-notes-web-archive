/**
 * Temporary capture-tab driver (FR-CAP-03/04, PRD §9).
 *
 * Captures NEVER reuse the user's tabs and never activate a tab just to
 * capture it (FR-CAP-10): each job opens ONE background (inactive) tab,
 * waits for its load to complete, and the caller closes it in a finally
 * path — `closeDrivenTab` is idempotent so cleanup cannot leak tabs even
 * when the job times out, is canceled, or throws mid-capture.
 *
 * The driver reports the post-navigation URL and title so the queue can
 * validate redirects (FR-CAP-04): the final origin must still be the origin
 * the user authorized.
 */

export interface DrivenTab {
  readonly tabId: number;
  /** URL after navigation settled (may differ from the requested URL). */
  readonly finalUrl: string;
  readonly title: string;
}

export type TabDriveFailureKind = 'timeout' | 'tab-closed' | 'create-failed';

export class TabDriveError extends Error {
  constructor(
    readonly kind: TabDriveFailureKind,
    detail: string,
  ) {
    super(`capture tab failed (${kind}): ${detail}`);
    this.name = 'TabDriveError';
  }
}

interface ChromeTabLike {
  readonly id?: number;
  readonly url?: string;
  readonly title?: string;
  readonly status?: string;
}

/** Wait for `condition` to hold, bounded by a deadline. */
function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs: number,
  onTimeout: () => string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const startedAt = Date.now();
    const poll = async (): Promise<void> => {
      try {
        if (await condition()) {
          resolve();
          return;
        }
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new TabDriveError('timeout', onTimeout()));
        return;
      }
      setTimeout(() => void poll(), 25);
    };
    void poll();
  });
}

/**
 * Open the temporary inactive tab and wait for its load to complete.
 * `timeoutMs` is the remaining navigation budget for the job. The tab is
 * removed again on timeout or when the tab disappears before loading.
 */
export async function openInactiveTab(url: string, timeoutMs: number): Promise<DrivenTab> {
  let created: chrome.tabs.Tab;
  try {
    created = await chrome.tabs.create({ url, active: false });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new TabDriveError('create-failed', detail);
  }
  const tabId = created.id;
  if (tabId === undefined || tabId === null) {
    throw new TabDriveError('create-failed', 'tabs.create returned no tab id');
  }

  let closed = false;
  const onRemoved = (removedId: number): void => {
    if (removedId === tabId) closed = true;
  };
  chrome.tabs.onRemoved.addListener(onRemoved);
  const readTab = async (): Promise<ChromeTabLike | null> => {
    try {
      return await chrome.tabs.get(tabId);
    } catch {
      return null; // tab is gone
    }
  };
  const loaded = async (): Promise<boolean> => {
    if (closed) throw new TabDriveError('tab-closed', 'the capture tab was closed before it finished loading');
    const tab = await readTab();
    if (!tab) throw new TabDriveError('tab-closed', 'the capture tab disappeared before it finished loading');
    return tab.url !== undefined && tab.status === 'complete';
  };

  try {
    await waitFor(loaded, Math.max(timeoutMs, 0), () => 'page did not finish loading within the capture budget');
    const tab = await readTab();
    if (!tab || tab.url === undefined) {
      throw new TabDriveError('tab-closed', 'the capture tab disappeared after loading');
    }
    return { tabId, finalUrl: tab.url, title: tab.title ?? '' };
  } catch (error) {
    // Never leak the temporary tab when the drive fails.
    await closeDrivenTab(tabId);
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    chrome.tabs.onRemoved.removeListener(onRemoved);
  }
}

/** Close the temporary capture tab. Idempotent and never throws. */
export async function closeDrivenTab(tabId: number): Promise<void> {
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    // Already closed (by the user, by a crash, or by a previous cleanup) —
    // cleanup is best-effort and must not mask the job's real outcome.
  }
}
