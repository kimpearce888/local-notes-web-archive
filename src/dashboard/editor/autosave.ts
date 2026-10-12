/**
 * Autosave (PRD §4.3): debounced persistence of the full editor document
 * plus its plain-text projection through the controller's save flow, with a
 * visible save state at all times. The editor's own undo/redo history is
 * never touched — saving is not an editing action. A flush() is provided
 * for view switches and unload guards.
 */

export interface AutosaveTask {
  /** Snapshot producer — called when the debounce fires. */
  readonly snapshot: () => {
    title: string;
    subtitle: string;
    editorDoc: object | null;
    plainText: string;
  };
  /** Persist function — resolves with the new revision head or null on failure. */
  readonly save: (input: {
    title: string;
    subtitle: string;
    editorDoc: object | null;
    plainText: string;
  }) => Promise<unknown>;
  /** Called after every save attempt (success or failure). */
  readonly onSaved?: (ok: boolean) => void;
}

export interface AutosaveManager {
  /** Schedules a debounced save after content changed. */
  schedule(): void;
  /** Cancels any pending timer without saving. */
  cancel(): void;
  /** Saves immediately if there is anything pending. */
  flush(): Promise<void>;
  dispose(): void;
}

export const AUTOSAVE_DEBOUNCE_MS = 800;

export function createAutosave(
  task: AutosaveTask,
  debounceMs: number = AUTOSAVE_DEBOUNCE_MS,
): AutosaveManager {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;
  let inFlight: Promise<void> | null = null;

  async function run(): Promise<void> {
    if (!pending) return;
    pending = false;
    const snapshot = task.snapshot();
    try {
      await task.save(snapshot);
      task.onSaved?.(true);
    } catch {
      // save() already surfaces failures through the save-state flow.
      task.onSaved?.(false);
    }
  }

  return {
    schedule(): void {
      pending = true;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        inFlight = run();
      }, debounceMs);
    },
    cancel(): void {
      pending = false;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
    async flush(): Promise<void> {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (inFlight) await inFlight;
      if (pending) await run();
    },
    dispose(): void {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = false;
    },
  };
}
