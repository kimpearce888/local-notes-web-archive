/**
 * Duplicate-capture decision monitor (T-026, FR-CAP-08): the user-visible
 * confirmation the `ask` duplicate policy requires. The capture queue parks
 * links that duplicate an existing capture; this module watches the queue
 * status and presents one decision dialog at a time — reuse the existing
 * archive or capture a fresh one.
 *
 * The monitor is refresh-driven: the dashboard calls `refresh()` whenever a
 * capture-progress event arrives (queue.ts broadcasts them to open dashboard
 * tabs) and once at boot — no polling loop.
 */

import type { EntityId } from '../../core/types';
import type { WaitingDedupEntry } from '../../background/capture/queue';

export interface DuplicateDecisionCallbacks {
  /** Current queue status (waitingDedup entries, oldest first). */
  status(): Promise<{ waitingDedup: readonly WaitingDedupEntry[] }>;
  /** Answer the parked decision. */
  resolveDuplicate(linkId: EntityId, resolution: 'reuse' | 'new'): Promise<boolean>;
  announce(message: string): void;
}

export interface DuplicateDecisionMonitor {
  /** Re-check the queue and present newly waiting decisions. */
  refresh(): Promise<void>;
  /** Stop presenting (dashboard teardown). */
  dispose(): void;
}

/** URL shown in the dialog: origin+path, no credentials can exist (gate). */
function displayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

export function createDuplicateDecisionMonitor(
  callbacks: DuplicateDecisionCallbacks,
): DuplicateDecisionMonitor {
  /** Link ids already presented (or resolved) — never re-prompt. */
  const presented = new Set<EntityId>();
  let dialogOpen = false;
  let disposed = false;

  const presentDecision = (entry: WaitingDedupEntry): void => {
    dialogOpen = true;

    const dialog = document.createElement('dialog');
    dialog.className = 'dialog dialog--confirm';
    const heading = document.createElement('h2');
    heading.textContent = 'This page is already captured';

    const body = document.createElement('p');
    body.textContent = `${displayUrl(entry.url)} already has a saved capture (from ${displayUrl(entry.duplicateUrl)}). Reuse the existing archive, or capture a fresh copy now?`;

    const actions = document.createElement('div');
    actions.className = 'dialog__actions';

    const reuseButton = document.createElement('button');
    reuseButton.type = 'button';
    reuseButton.className = 'btn';
    reuseButton.textContent = 'Reuse existing capture';
    const freshButton = document.createElement('button');
    freshButton.type = 'button';
    freshButton.className = 'btn btn--primary';
    freshButton.textContent = 'Capture fresh copy';

    const answer = (resolution: 'reuse' | 'new'): void => {
      freshButton.disabled = true;
      reuseButton.disabled = true;
      void (async () => {
        const ok = await callbacks
          .resolveDuplicate(entry.linkId, resolution)
          .catch(() => false);
        dialog.close();
        if (ok) {
          callbacks.announce(
            resolution === 'reuse'
              ? 'Reusing the existing capture.'
              : 'Capturing a fresh copy of the page.',
          );
        }
        dialogOpen = false;
        // Present the next waiting decision, if any.
        await refresh();
      })();
    };

    reuseButton.addEventListener('click', () => answer('reuse'));
    freshButton.addEventListener('click', () => answer('new'));

    actions.append(reuseButton, freshButton);
    dialog.append(heading, body, actions);
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (dialogOpen) dialogOpen = false;
    });
    document.body.append(dialog);
    dialog.showModal();
    reuseButton.focus();
  };

  async function refresh(): Promise<void> {
    if (disposed || dialogOpen) return;
    let waiting: readonly WaitingDedupEntry[];
    try {
      waiting = (await callbacks.status()).waitingDedup;
    } catch {
      // The queue status is unreachable — nothing to present; the parked
      // links stay durable in IndexedDB and re-prompt on the next refresh.
      return;
    }
    // Entries whose dialog was already answered may still be resolving;
    // present only genuinely new decisions, oldest first.
    const next = waiting.find((entry) => !presented.has(entry.linkId));
    if (next) {
      presented.add(next.linkId);
      presentDecision(next);
    }
  }

  return {
    refresh,
    dispose(): void {
      disposed = true;
      presented.clear();
    },
  };
}
