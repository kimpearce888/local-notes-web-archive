// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createApiClient, RpcClientError } from '../../../src/dashboard/state/client';
import { RPC_KIND, isRpcResponse, newCorrelationId } from '../../../src/background/protocol';

/** Capturing transport: records requests, replies with scripted responses. */
function capturingTransport(
  script: (message: unknown) => unknown,
): { transport: ReturnType<typeof makeTransport>; requests: unknown[] } {
  const requests: unknown[] = [];
  const transport = async (message: unknown): Promise<unknown> => {
    requests.push(message);
    return script(message);
  };
  return { transport, requests };
}

function makeTransport(fn: (message: unknown) => unknown): Parameters<typeof createApiClient>[0] {
  return fn as Parameters<typeof createApiClient>[0];
}

describe('messaging client', () => {
  it('wraps requests in the RPC envelope with fresh correlation ids', async () => {
    const { transport, requests } = capturingTransport(() => ({
      kind: RPC_KIND,
      id: 'unused',
      ok: true,
      result: { pong: true },
    }));
    const client = createApiClient(makeTransport(transport));
    await client.request('app/ping', { probe: 'x' });
    const envelope = requests[0] as { kind: string; id: string; type: string; payload: unknown };
    expect(envelope.kind).toBe(RPC_KIND);
    expect(envelope.type).toBe('app/ping');
    expect(envelope.payload).toEqual({ probe: 'x' });
    expect(envelope.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('echoes the correlation id so responses can be matched', async () => {
    let seenId = '';
    const { transport } = capturingTransport((message) => {
      seenId = (message as { id: string }).id;
      return { kind: RPC_KIND, id: seenId, ok: true, result: { note: { id: 'n1' } } };
    });
    const client = createApiClient(makeTransport(transport));
    await client.request('notes/get', { noteId: 'n1' as never });
    expect(seenId.length).toBe(36);
  });

  it('unwraps successful results', async () => {
    const { transport } = capturingTransport(() => ({
      kind: RPC_KIND,
      id: newCorrelationId(),
      ok: true,
      result: { counts: { active: 2, archived: 0, trashed: 0 } },
    }));
    const client = createApiClient(makeTransport(transport));
    const result = await client.request('notes/counts', {});
    expect(result.counts.active).toBe(2);
  });

  it('raises coded RpcClientError for handler failures', async () => {
    const { transport } = capturingTransport(() => ({
      kind: RPC_KIND,
      id: newCorrelationId(),
      ok: false,
      error: { code: 'conflict', message: 'stale revision' },
    }));
    const client = createApiClient(makeTransport(transport));
    const error = await client.request('notes/save', {} as never).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcClientError);
    expect((error as RpcClientError).code).toBe('conflict');
    expect((error as RpcClientError).message).toBe('stale revision');
  });

  it('rejects malformed responses honestly', async () => {
    const { transport } = capturingTransport(() => ({ something: 'else' }));
    const client = createApiClient(makeTransport(transport));
    await expect(client.request('app/ping', {})).rejects.toThrow(/malformed response/i);
  });

  it('rejects transport failures without faking success', async () => {
    const transport = async (): Promise<unknown> => {
      throw new Error('message channel closed');
    };
    const client = createApiClient(makeTransport(transport));
    const error = await client.request('app/ping', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcClientError);
    expect((error as RpcClientError).code).toBe('internal-error');
  });

  it('serialises concurrent requests independently', async () => {
    const ids: string[] = [];
    const { transport } = capturingTransport((message) => {
      const id = (message as { id: string }).id;
      ids.push(id);
      return { kind: RPC_KIND, id, ok: true, result: {} };
    });
    const client = createApiClient(makeTransport(transport));
    await Promise.all([client.request('app/ping', {}), client.request('app/ping', {})]);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('isRpcResponse', () => {
  it('accepts success and failure shapes, rejects junk', () => {
    expect(isRpcResponse({ kind: RPC_KIND, id: 'a', ok: true, result: null })).toBe(true);
    expect(
      isRpcResponse({ kind: RPC_KIND, id: 'a', ok: false, error: { code: 'not-found', message: 'x' } }),
    ).toBe(true);
    expect(isRpcResponse({ kind: RPC_KIND, id: '', ok: true, result: null })).toBe(false);
    expect(isRpcResponse({ kind: RPC_KIND, id: 'a', ok: 'yes' })).toBe(false);
    expect(isRpcResponse({ kind: RPC_KIND, id: 'a', ok: false, error: null })).toBe(false);
    expect(isRpcResponse(null)).toBe(false);
  });
});

describe('default chrome transport', () => {
  it('uses chrome.runtime.sendMessage with a callback and lastError handling', async () => {
    const sendMessage = vi.fn((_message: unknown, callback: (response: unknown) => void) => {
      void chrome.runtime.lastError; // read like the real implementation
      callback({ kind: RPC_KIND, id: 'fixed', ok: true, result: { pong: true } });
    });
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: { sendMessage, lastError: undefined },
    };
    try {
      const client = createApiClient();
      const result = await client.request('app/ping', {});
      expect(result.pong).toBe(true);
      expect(sendMessage).toHaveBeenCalledTimes(1);
    } finally {
      delete (globalThis as Record<string, unknown>)['chrome'];
    }
  });
});
