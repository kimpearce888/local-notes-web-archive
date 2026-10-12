/**
 * Production capture pipeline wiring (T-023): exactly one capture queue per
 * service worker, driven by the real artifact steps and fed by the
 * link-queued notification hook — every transition into the `queued` state
 * (paste policy, explicit queue action, permission grant) enqueues without
 * polling. Links left `queued` by a worker suspension are requeued on the
 * next worker startup (lifecycle.ts).
 *
 * The singleton lives here (not in the queue module) so tests can drop and
 * re-wire it with `resetCapturePipeline()` without touching production code.
 */

import { createCaptureQueue, onLinkQueued, type CaptureQueue } from './queue';
import { createProductionCaptureSteps } from './steps';

let activePipeline: CaptureQueue | null = null;

export function getCaptureQueue(): CaptureQueue {
  if (activePipeline === null) {
    const queue = createCaptureQueue({ steps: createProductionCaptureSteps() });
    onLinkQueued((link) => {
      // The hook fires after the link is durably `queued` in IndexedDB; the
      // queue re-reads nothing — it owns the in-memory job from here on.
      queue.enqueue(link);
    });
    activePipeline = queue;
  }
  return activePipeline;
}

/** Test hook: drop the singleton so the next access re-wires a fresh queue. */
export function resetCapturePipeline(): void {
  activePipeline = null;
}
