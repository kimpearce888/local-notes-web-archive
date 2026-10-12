/**
 * Most-recent-recoverable-edit recovery (PRD §4.3): a crash journal in
 * sessionStorage captures the newest unsaved editor snapshot. It survives
 * renderer crashes and browser restarts-with-session-restore (tab-scoped),
 * so an unexpected failure never costs more than the debounce window. The
 * journal is cleared after every successful save and never outlives the
 * note it belongs to.
 */

import type { EntityId, UtcTimestamp } from '../../core/types';

export interface RecoveryEntry {
  readonly noteId: EntityId;
  readonly title: string;
  readonly subtitle: string;
  readonly editorDoc: object | null;
  readonly plainText: string;
  readonly at: UtcTimestamp;
}

const JOURNAL_KEY = 'lnwa-recovery-journal';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storage(): StorageLike | null {
  try {
    return window.sessionStorage;
  } catch {
    return null; // storage disabled — recovery degrades to off, honestly
  }
}

/** Records the newest unsaved snapshot for a note (throttle upstream). */
export function writeRecoveryEntry(entry: RecoveryEntry): void {
  const store = storage();
  if (!store) return;
  try {
    const journal = readJournal(store);
    journal[entry.noteId] = entry;
    // Bounded: keep at most the 16 most recent entries.
    const entries = Object.values(journal).sort((a, b) => (a.at < b.at ? 1 : -1));
    const trimmed: Record<string, RecoveryEntry> = {};
    for (const item of entries.slice(0, 16)) trimmed[item.noteId] = item;
    store.setItem(JOURNAL_KEY, JSON.stringify(trimmed));
  } catch {
    // Quota or serialization failures must never disrupt editing.
  }
}

/** The recoverable snapshot for a note, when it is newer than the saved note. */
export function readRecoveryEntry(
  noteId: EntityId,
  savedUpdatedAt: UtcTimestamp,
): RecoveryEntry | null {
  const store = storage();
  if (!store) return null;
  const entry = readJournal(store)[noteId];
  if (!entry) return null;
  if (entry.at <= savedUpdatedAt) return null;
  return entry;
}

export function clearRecoveryEntry(noteId: EntityId): void {
  const store = storage();
  if (!store) return;
  try {
    const journal = readJournal(store);
    delete journal[noteId];
    store.setItem(JOURNAL_KEY, JSON.stringify(journal));
  } catch {
    // Ignore — clearing is best-effort.
  }
}

function readJournal(store: StorageLike): Record<string, RecoveryEntry> {
  const raw = store.getItem(JOURNAL_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed as Record<string, RecoveryEntry>;
  } catch {
    return {};
  }
}

/** Test hook: wipe the whole journal. */
export function clearRecoveryJournal(): void {
  storage()?.removeItem(JOURNAL_KEY);
}
