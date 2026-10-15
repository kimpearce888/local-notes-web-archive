import { describe, expect, it, vi } from 'vitest';
import { MessageRouter, toRpcError } from '../../../../src/background/router';
import { RPC_KIND, rpcSuccess, type RpcRequest } from '../../../../src/background/protocol';
import { NoteConflictError, NoteNotFoundError } from '../../../../src/core/repo/notes';
import { TagNotFoundError, DuplicateTagError } from '../../../../src/core/repo/tags';
import { CategoryNotFoundError } from '../../../../src/core/repo/categories';
import { ReminderNotFoundError } from '../../../../src/core/repo/reminders';
import { InvalidUrlError } from '../../../../src/core/repo/links';
import { DatabaseUnavailableError, MigrationFailedError } from '../../../../src/core/db/open';

function request(type: string, payload: unknown, id = 'req-1'): RpcRequest {
  return { kind: RPC_KIND, id, type, payload };
}

describe('MessageRouter.dispatch', () => {
  it('routes to the registered handler and echoes the correlation id', async () => {
    const router = new MessageRouter();
    router.register('demo/echo', async (payload) => ({ echoed: payload }));
    const response = await router.dispatch(request('demo/echo', { a: 1 }, 'corr-7'));
    expect(response).toEqual({
      kind: RPC_KIND,
      id: 'corr-7',
      ok: true,
      result: { echoed: { a: 1 } },
    });
  });

  it('returns not-handled for unknown message types', async () => {
    const router = new MessageRouter();
    const response = await router.dispatch(request('nope/missing', {}));
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('not-handled');
      expect(response.error.message).toContain('nope/missing');
    }
  });

  it('reports concurrent requests with their own correlation ids', async () => {
    const router = new MessageRouter();
    const gate = { resolve: null as null | (() => void) };
    const opened = new Promise<void>((resolve) => {
      gate.resolve = resolve;
    });
    router.register('demo/slow', async () => {
      await opened;
      return 'done';
    });
    const first = router.dispatch(request('demo/slow', {}, 'corr-a'));
    const second = router.dispatch(request('demo/slow', {}, 'corr-b'));
    gate.resolve?.();
    const [a, b] = await Promise.all([first, second]);
    expect(rpcSuccess('corr-a', 'done')).toEqual(a);
    expect(rpcSuccess('corr-b', 'done')).toEqual(b);
  });

  it('rejects duplicate handler registration', () => {
    const router = new MessageRouter();
    router.register('demo/one', async () => null);
    expect(() => router.register('demo/one', async () => null)).toThrow(/duplicate handler/);
  });

  it('lists registered types sorted', () => {
    const router = new MessageRouter();
    router.register('b/second', async () => null);
    router.register('a/first', async () => null);
    expect(router.listTypes()).toEqual(['a/first', 'b/second']);
    expect(router.has('a/first')).toBe(true);
    expect(router.has('missing')).toBe(false);
  });

  it('does not leak stack traces on internal errors and bounds the message', async () => {
    const router = new MessageRouter();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    router.register('demo/boom', async () => {
      throw new Error('deep failure');
    });
    router.register('demo/long', async () => {
      throw new Error('x'.repeat(500));
    });
    const response = await router.dispatch(request('demo/boom', {}));
    expect(response.ok).toBe(false);
    if (!response.ok) {
      // Only the message travels — never the stack.
      expect(response.error.code).toBe('internal-error');
      expect(response.error.message).toBe('deep failure');
    }
    const long = await router.dispatch(request('demo/long', {}));
    if (!long.ok) {
      expect(long.error.message.length).toBeLessThanOrEqual(300);
    }
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe('toRpcError domain mapping', () => {
  it('maps note conflicts (FR-NOTE-07)', () => {
    const error = toRpcError(new NoteConflictError('note-1' as never, 'rev-2' as never, 'rev-1' as never));
    expect(error.code).toBe('conflict');
    expect(error.message).toContain('FR-NOTE-07');
  });

  it('maps missing entities to not-found', () => {
    expect(toRpcError(new NoteNotFoundError('n' as never)).code).toBe('not-found');
    expect(toRpcError(new TagNotFoundError('t' as never)).code).toBe('not-found');
    expect(toRpcError(new CategoryNotFoundError('c' as never)).code).toBe('not-found');
    expect(toRpcError(new ReminderNotFoundError('r' as never)).code).toBe('not-found');
  });

  it('maps duplicate tag keys and invalid URLs', () => {
    expect(toRpcError(new DuplicateTagError('work')).code).toBe('duplicate');
    expect(toRpcError(new InvalidUrlError('ftp://x')).code).toBe('invalid-url');
  });

  it('maps database failures with their distinct codes', () => {
    expect(toRpcError(new DatabaseUnavailableError('boom')).code).toBe('database-unavailable');
    expect(toRpcError(new MigrationFailedError(1, 2, 'corrupt blob')).code).toBe('migration-failed');
  });

  it('maps non-error throwables to internal-error without crashing', () => {
    const error = toRpcError('a plain string');
    expect(error.code).toBe('internal-error');
    expect(error.message).toBe('a plain string');
  });
});
