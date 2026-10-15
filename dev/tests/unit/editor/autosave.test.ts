// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutosave } from '../../../../src/dashboard/editor/autosave';
import {
  clearRecoveryEntry,
  clearRecoveryJournal,
  readRecoveryEntry,
  writeRecoveryEntry,
} from '../../../../src/dashboard/editor/recovery';

describe('autosave manager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeTask() {
    const saves: unknown[] = [];
    const task = {
      snapshot: () => ({ title: 'T', subtitle: '', editorDoc: null, plainText: 'body' }),
      save: vi.fn(async (input: unknown) => {
        saves.push(input);
        return saves.length;
      }),
      onSaved: vi.fn(),
    };
    return { task, saves };
  }

  it('debounces bursts into one save', async () => {
    const { task, saves } = makeTask();
    const autosave = createAutosave(task, 500);
    autosave.schedule();
    autosave.schedule();
    autosave.schedule();
    expect(task.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(saves).toHaveLength(1);
    autosave.dispose();
  });

  it('flush() persists immediately and is idempotent', async () => {
    const { task, saves } = makeTask();
    const autosave = createAutosave(task, 500);
    autosave.schedule();
    await autosave.flush();
    expect(saves).toHaveLength(1);
    await autosave.flush(); // nothing pending anymore
    expect(saves).toHaveLength(1);
    autosave.dispose();
  });

  it('cancel() drops the pending save', async () => {
    const { task } = makeTask();
    const autosave = createAutosave(task, 500);
    autosave.schedule();
    autosave.cancel();
    await vi.advanceTimersByTimeAsync(600);
    expect(task.save).not.toHaveBeenCalled();
    autosave.dispose();
  });

  it('reports save failures without throwing', async () => {
    const task = {
      snapshot: () => ({ title: 'T', subtitle: '', editorDoc: null, plainText: '' }),
      save: vi.fn(async () => {
        throw new Error('boom');
      }),
      onSaved: vi.fn(),
    };
    const autosave = createAutosave(task, 100);
    autosave.schedule();
    await vi.advanceTimersByTimeAsync(200);
    expect(task.onSaved).toHaveBeenCalledWith(false);
    autosave.dispose();
  });
});

describe('crash journal (most-recent recoverable edit)', () => {
  beforeEach(() => {
    clearRecoveryJournal();
  });
  afterEach(() => {
    clearRecoveryJournal();
  });

  const NOTE_ID = '00000000-0000-4000-8000-000000000001' as never;

  it('round-trips entries and only surfaces newer-than-saved snapshots', () => {
    const savedAt = '2026-10-12T10:00:00.000Z' as never;
    writeRecoveryEntry({
      noteId: NOTE_ID,
      title: 'Recovered',
      subtitle: '',
      editorDoc: { type: 'doc', content: [] },
      plainText: 'newer text',
      at: '2026-10-12T10:00:05.000Z' as never,
    });
    const entry = readRecoveryEntry(NOTE_ID, savedAt);
    expect(entry?.plainText).toBe('newer text');
    expect(entry?.title).toBe('Recovered');

    // Older journal entries are ignored.
    expect(readRecoveryEntry(NOTE_ID, '2026-10-12T11:00:00.000Z' as never)).toBeNull();
  });

  it('clears entries per note after successful saves', () => {
    writeRecoveryEntry({
      noteId: NOTE_ID,
      title: 'x',
      subtitle: '',
      editorDoc: null,
      plainText: '',
      at: '2026-10-12T10:00:05.000Z' as never,
    });
    clearRecoveryEntry(NOTE_ID);
    expect(readRecoveryEntry(NOTE_ID, '2026-10-12T10:00:00.000Z' as never)).toBeNull();
  });

  it('keeps at most 16 entries, newest first', () => {
    for (let i = 0; i < 20; i += 1) {
      writeRecoveryEntry({
        noteId: `00000000-0000-4000-8000-${String(100000000 + i).slice(0, 12)}` as never,
        title: `note ${i}`,
        subtitle: '',
        editorDoc: null,
        plainText: '',
        at: new Date(Date.parse('2026-10-12T10:00:00.000Z') + i * 1000).toISOString() as never,
      });
    }
    // The newest (note 19) survives; the oldest (note 0..3) are trimmed.
    expect(
      readRecoveryEntry(
        `00000000-0000-4000-8000-${String(100000000 + 19).slice(0, 12)}` as never,
        '2026-10-12T09:00:00.000Z' as never,
      )?.title,
    ).toBe('note 19');
    expect(
      readRecoveryEntry(
        `00000000-0000-4000-8000-${String(100000000).slice(0, 12)}` as never,
        '2026-10-12T09:00:00.000Z' as never,
      ),
    ).toBeNull();
  });
});
