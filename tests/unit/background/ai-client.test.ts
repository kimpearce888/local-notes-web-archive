import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, type InstalledMock } from './chrome-mock';
import { closeWorkerResources, repo } from '../../../src/background/db';
import { MessageRouter } from '../../../src/background/router';
import { registerAllApi } from '../../../src/background/api';
import {
  AiClientError,
  createLmStudioClient,
  resolveAiBaseUrl,
  testLmStudioConnection,
  type FetchLike,
} from '../../../src/background/ai/client';
import { getSettings } from '../../../src/core/repo/settings';
import { newCorrelationId, RPC_KIND, type RpcRequest, type RpcResponse } from '../../../src/background/protocol';
import { DB_NAME } from '../../../src/core/version';

/**
 * T-029 LM Studio client (FR-AI-01/02/03/10): loopback-only URL gate,
 * /models connection test with latency, chat completion plumbing with
 * timeouts and structured errors, and graceful degradation — AI failures
 * are truthful coded errors that never touch core features.
 */

let router: MessageRouter;
let installed: InstalledMock;
const originalFetch = globalThis.fetch;

function call(type: string, payload: unknown): Promise<RpcResponse> {
  const request: RpcRequest = { kind: RPC_KIND, id: newCorrelationId(), type, payload };
  return router.dispatch(request);
}

beforeEach(() => {
  installed = installChromeMock();
  router = new MessageRouter();
  registerAllApi(router);
});

afterEach(async () => {
  vi.restoreAllMocks();
  (globalThis as Record<string, unknown>)['fetch'] = originalFetch;
  await closeWorkerResources();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
  installed.uninstall();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('resolveAiBaseUrl (FR-AI-01 loopback gate)', () => {
  it('accepts the documented loopback forms', () => {
    expect(resolveAiBaseUrl('http://127.0.0.1:1234/v1').toString()).toBe('http://127.0.0.1:1234/v1');
    expect(resolveAiBaseUrl('http://localhost:1234/v1').toString()).toBe('http://localhost:1234/v1');
    expect(resolveAiBaseUrl('http://[::1]:1234/v1').toString()).toBe('http://[::1]:1234/v1');
    expect(resolveAiBaseUrl('https://127.0.0.1:8443/v1/').toString()).toBe('https://127.0.0.1:8443/v1');
    expect(resolveAiBaseUrl('http://LOCALHOST:1234').toString()).toBe('http://localhost:1234/');
    // Credentials, query and hash are stripped (no silent exfiltration path).
    expect(resolveAiBaseUrl('http://user:pass@127.0.0.1:1234/v1?x=1#f').toString()).toBe(
      'http://127.0.0.1:1234/v1',
    );
  });

  it('rejects non-loopback hosts, bad schemes and malformed URLs', () => {
    const rejections = [
      'http://192.168.1.10:1234/v1',
      'http://example.com:1234/v1',
      'http://0.0.0.0:1234/v1',
      'http://10.0.0.1/v1',
      'ws://127.0.0.1:1234/v1',
      'chrome-extension://127.0.0.1',
      'not a url',
      '',
    ];
    for (const url of rejections) {
      expect(() => resolveAiBaseUrl(url)).toThrow(AiClientError);
      try {
        resolveAiBaseUrl(url);
      } catch (error) {
        expect((error as AiClientError).code).toBe('invalid-base-url');
      }
    }
  });
});

describe('client operations over an injected fetch', () => {
  const OPTIONS = { baseUrl: 'http://127.0.0.1:1234/v1', timeoutMs: 5000 };

  it('lists models from a compatible /models response', async () => {
    const fetchLike: FetchLike = vi.fn(async () =>
      jsonResponse({ data: [{ id: 'qwen2.5-7b-instruct' }, { id: 'llama-3.1-8b' }] }),
    );
    const client = createLmStudioClient(OPTIONS, fetchLike);
    const models = await client.listModels();
    expect(models.map((m) => m.id)).toEqual(['qwen2.5-7b-instruct', 'llama-3.1-8b']);
    expect(fetchLike).toHaveBeenCalledWith(
      'http://127.0.0.1:1234/v1/models',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('rejects responses without a data array (API format check)', async () => {
    const fetchLike: FetchLike = vi.fn(async () => jsonResponse({ object: 'list', data: 'nope' }));
    const client = createLmStudioClient(OPTIONS, fetchLike);
    await expect(client.listModels()).rejects.toMatchObject({
      code: 'response-invalid',
    });
  });

  it('rejects non-JSON responses truthfully', async () => {
    const fetchLike: FetchLike = vi.fn(
      async () => new Response('<html>Not an API</html>', { status: 200 }),
    );
    const client = createLmStudioClient(OPTIONS, fetchLike);
    await expect(client.listModels()).rejects.toMatchObject({ code: 'response-invalid' });
  });

  it('surfaces connection refusal as unreachable with actionable guidance', async () => {
    const fetchLike: FetchLike = vi.fn(async () => {
      throw new TypeError('fetch failed: ECONNREFUSED');
    });
    const client = createLmStudioClient(OPTIONS, fetchLike);
    const error = await client.listModels().catch((e: unknown) => e as AiClientError);
    expect(error).toBeInstanceOf(AiClientError);
    expect((error as AiClientError).code).toBe('unreachable');
    expect((error as AiClientError).message).toContain('is the local server started?');
  });

  it('times out through the abort signal with the configured budget', async () => {
    const fetchLike: FetchLike = vi.fn(
      (input: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const abort = new Error('aborted');
            abort.name = 'AbortError';
            reject(abort);
          });
        }),
    );
    const client = createLmStudioClient({ baseUrl: OPTIONS.baseUrl, timeoutMs: 50 }, fetchLike);
    const error = await client.listModels().catch((e: unknown) => e as AiClientError);
    expect((error as AiClientError).code).toBe('timeout');
    expect((error as AiClientError).message).toContain('50ms');
  });

  it('reports HTTP failures with status and bounded body', async () => {
    const fetchLike: FetchLike = vi.fn(async () =>
      jsonResponse({ error: { message: 'no model loaded' } }, 500),
    );
    const client = createLmStudioClient(OPTIONS, fetchLike);
    const error = await client.listModels().catch((e: unknown) => e as AiClientError);
    expect((error as AiClientError).code).toBe('server-error');
    expect((error as AiClientError).message).toContain('HTTP 500');
    expect((error as AiClientError).message).toContain('no model loaded');
  });

  it('sends chat completions with tools and parses the response', async () => {
    const fetchLike: FetchLike = vi.fn(async (input: string, init: RequestInit) => {
      expect(input).toBe('http://127.0.0.1:1234/v1/chat/completions');
      const body = JSON.parse(String(init.body)) as {
        messages: unknown[];
        tools?: unknown[];
        tool_choice?: string;
        max_tokens?: number;
      };
      expect(body.messages).toHaveLength(2);
      expect(body.tools).toHaveLength(1);
      expect(body.tool_choice).toBe('auto');
      expect(body.max_tokens).toBe(512);
      return jsonResponse({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'search_notes', arguments: '{"query":"capture"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 120, completion_tokens: 8 },
      });
    });
    const client = createLmStudioClient(OPTIONS, fetchLike);
    const response = await client.chatCompletion({
      messages: [
        { role: 'system', content: 'You manage notes.' },
        { role: 'user', content: 'Find capture notes' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'search_notes',
            description: 'Search notes',
            parameters: { type: 'object', properties: {} },
          },
        },
      ],
      maxTokens: 512,
    });
    expect(response.message.tool_calls?.[0]?.function.name).toBe('search_notes');
    expect(response.finishReason).toBe('tool_calls');
    expect(response.usage).toEqual({ promptTokens: 120, completionTokens: 8 });
  });

  it('rejects chat responses without choices (no model loaded)', async () => {
    const fetchLike: FetchLike = vi.fn(async () => jsonResponse({ choices: [] }));
    const client = createLmStudioClient(OPTIONS, fetchLike);
    const error = await client
      .chatCompletion({ messages: [{ role: 'user', content: 'hi' }] })
      .catch((e: unknown) => e as AiClientError);
    expect((error as AiClientError).code).toBe('response-invalid');
    expect((error as AiClientError).message).toContain('is a model loaded');
  });
});

describe('testLmStudioConnection (FR-AI-03 settings screen)', () => {
  it('reports ok with latency and models', async () => {
    const fetchLike: FetchLike = vi.fn(async () =>
      jsonResponse({ data: [{ id: 'model-a' }, { id: 'model-b' }] }),
    );
    const result = await testLmStudioConnection(
      { baseUrl: 'http://localhost:1234/v1', timeoutMs: 1000 },
      fetchLike,
    );
    expect(result.ok).toBe(true);
    expect(result.models).toEqual(['model-a', 'model-b']);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeNull();
  });

  it('reports truthful failures with the structured error code', async () => {
    const fetchLike: FetchLike = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const result = await testLmStudioConnection(
      { baseUrl: 'http://localhost:1234/v1', timeoutMs: 1000 },
      fetchLike,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('unreachable');
    expect(result.errorMessage).toContain('local server started');
  });

  it('reports invalid base URLs without any network attempt', async () => {
    const fetchLike: FetchLike = vi.fn(async () => {
      throw new Error('must not be called');
    });
    const result = await testLmStudioConnection(
      { baseUrl: 'http://example.com:1234/v1', timeoutMs: 1000 },
      fetchLike,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid-base-url');
    expect(fetchLike).not.toHaveBeenCalled();
  });
});

describe('ai RPCs over the router (service worker only, FR-AI-02)', () => {
  it('ai/test-connection uses the stored settings and reports results', async () => {
    const settings = await getSettings(await repo());
    expect(settings.ai.baseUrl).toBe('http://127.0.0.1:1234/v1');

    const fetchSpy = vi.fn(async () => jsonResponse({ data: [{ id: 'local-model' }] }));
    (globalThis as Record<string, unknown>)['fetch'] = fetchSpy;

    const response = await call('ai/test-connection', {});
    expect(response.ok).toBe(true);
    if (response.ok) {
      const result = response.result as unknown as {
        result: { ok: boolean; models: string[]; error: string | null };
      };
      expect(result.result.ok).toBe(true);
      expect(result.result.models).toEqual(['local-model']);
    }
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:1234/v1/models',
      expect.anything(),
    );
  });

  it('ai/list-models honors a candidate baseUrl override (loopback-gated)', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ data: [{ id: 'other-model' }] }));
    (globalThis as Record<string, unknown>)['fetch'] = fetchSpy;

    const response = await call('ai/list-models', { baseUrl: 'http://localhost:9999/v1' });
    expect(response.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith('http://localhost:9999/v1/models', expect.anything());
  });

  it('rejects non-loopback overrides with a coded failure, no network call', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ data: [] }));
    (globalThis as Record<string, unknown>)['fetch'] = fetchSpy;

    const response = await call('ai/list-models', { baseUrl: 'http://example.com/v1' });
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('invalid-request');
      expect(response.error.message).toContain('not a loopback host');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('maps LM Studio unavailability to the unsupported code (FR-AI-10)', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new TypeError('fetch failed: ECONNREFUSED');
    });
    (globalThis as Record<string, unknown>)['fetch'] = fetchSpy;

    // ai/list-models propagates client errors as coded RPC failures.
    const response = await call('ai/list-models', {});
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('unsupported');
      expect(response.error.message).toContain('LM Studio is unreachable');
    }

    // ai/test-connection answers with a truthful result envelope (the
    // settings screen shows the error, not an RPC failure).
    const test = await call('ai/test-connection', {});
    expect(test.ok).toBe(true);
    if (test.ok) {
      const result = test.result as unknown as {
        result: { ok: boolean; error: string | null; errorMessage: string | null };
      };
      expect(result.result.ok).toBe(false);
      expect(result.result.error).toBe('unreachable');
      expect(result.result.errorMessage).toContain('LM Studio is unreachable');
    }

    // Core features remain untouched: notes still work through the same router.
    const note = await call('notes/create', { title: 'still alive', plainText: 'yes' });
    expect(note.ok).toBe(true);
  });
});
