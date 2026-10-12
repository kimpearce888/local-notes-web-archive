/**
 * LM Studio client (FR-AI-01/02/03/10): OpenAI-compatible Chat Completions
 * over native fetch, from the SERVICE WORKER ONLY (never from page content
 * or an embedded webpage). Only loopback endpoints are accepted —
 * non-loopback AI URLs are out of scope for this architecture.
 *
 * Every failure is a structured, truthful outcome (FR-AI-10): an unavailable
 * LM Studio, an unloaded model, an API format difference or a timeout NEVER
 * pretends success, and core features (notes/search/capture/reminders) are
 * unaffected because this module is only reachable through AI RPCs.
 */

export type AiClientErrorCode =
  | 'invalid-base-url'
  | 'disabled'
  | 'timeout'
  | 'unreachable'
  | 'server-error'
  | 'response-invalid';

export class AiClientError extends Error {
  constructor(
    readonly code: AiClientErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AiClientError';
  }
}

/** Default loopback endpoint (FR-AI-01). */
export const DEFAULT_AI_BASE_URL = 'http://127.0.0.1:1234/v1';

// NOTE: WHATWG URL keeps the brackets for IPv6 hostnames.
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * Validate an AI base URL: http(s) AND loopback host only. Returns the
 * normalized URL (credentials/search/hash stripped, no trailing slash) or
 * throws invalid-base-url.
 */
export function resolveAiBaseUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AiClientError('invalid-base-url', `"${rawUrl}" is not a valid URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AiClientError(
      'invalid-base-url',
      `"${url.protocol}" is not an http(s) protocol — only http/https loopback endpoints are accepted`,
    );
  }
  const hostname = url.hostname.toLowerCase();
  if (!LOOPBACK_HOSTS.has(hostname)) {
    throw new AiClientError(
      'invalid-base-url',
      `"${hostname}" is not a loopback host — only 127.0.0.1, localhost and ::1 are accepted`,
    );
  }
  url.hash = '';
  url.search = '';
  url.username = '';
  url.password = '';
  return new URL(url.toString().replace(/\/+$/, ''));
}

/** Injected fetch for tests; defaults to the global fetch. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface LmStudioClient {
  /** GET /models — connection + model listing in one round trip. */
  listModels(options?: { baseUrl?: string; timeoutMs?: number }): Promise<LmStudioModel[]>;
  /** POST /chat/completions with timeout + structured errors. */
  chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
}

export interface LmStudioModel {
  readonly id: string;
}

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string | null;
  readonly tool_calls?: readonly ToolCall[];
  readonly tool_call_id?: string;
}

export interface ToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: { name: string; arguments: string };
}

export interface ToolDefinition {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
}

export interface ChatCompletionRequest {
  readonly messages: readonly ChatMessage[];
  readonly tools?: readonly ToolDefinition[];
  readonly tool_choice?: 'auto' | 'none';
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export interface ChatCompletionResponse {
  readonly message: ChatMessage;
  readonly finishReason: string | null;
  readonly usage: { promptTokens: number; completionTokens: number } | null;
}

/** Minimal shape the settings' "connection test" reports (FR-AI-03). */
export interface ConnectionTestResult {
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly models: readonly string[];
  readonly error: AiClientErrorCode | null;
  readonly errorMessage: string | null;
}

export interface LmStudioClientOptions {
  readonly baseUrl: string;
  readonly timeoutMs: number;
}

export function createLmStudioClient(
  options: LmStudioClientOptions,
  fetchLike: FetchLike = (input, init) => fetch(input, init),
): LmStudioClient {
  const endpoint = (path: string, baseUrlOverride?: string): string => {
    const base = resolveAiBaseUrl(baseUrlOverride ?? options.baseUrl);
    return `${base.toString()}${path}`;
  };

  async function requestJson(
    path: string,
    init: RequestInit,
    baseUrl: string | undefined,
    timeoutMs: number,
    what: string,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchLike(endpoint(path, baseUrl), {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof AiClientError) {
        // URL-gate failures pass through unchanged (never masked).
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AiClientError('timeout', `${what} timed out after ${timeoutMs}ms`);
      }
      throw new AiClientError(
        'unreachable',
        `LM Studio is unreachable (${error instanceof Error ? error.message : String(error)}) — is the local server started?`,
      );
    }
    clearTimeout(timer);
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new AiClientError(
        'server-error',
        `${what} failed: HTTP ${response.status} ${response.statusText}${body.length > 0 ? ` — ${body.slice(0, 300)}` : ''}`,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new AiClientError(
        'response-invalid',
        `${what} returned a non-JSON response — is this an LM Studio OpenAI-compatible endpoint?`,
      );
    }
  }

  return {
    async listModels(listOptions = {}): Promise<LmStudioModel[]> {
      const parsed = await requestJson(
        '/models',
        { method: 'GET' },
        listOptions.baseUrl,
        listOptions.timeoutMs ?? options.timeoutMs,
        'Listing models',
      );
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !Array.isArray((parsed as { data?: unknown }).data)
      ) {
        throw new AiClientError(
          'response-invalid',
          'The /models response has no "data" array — is this an LM Studio OpenAI-compatible endpoint?',
        );
      }
      const models: LmStudioModel[] = [];
      for (const entry of (parsed as { data: unknown[] }).data) {
        if (typeof entry === 'object' && entry !== null) {
          const id = (entry as { id?: unknown }).id;
          if (typeof id === 'string' && id.length > 0) models.push({ id });
        }
      }
      return models;
    },

    async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
      const body: Record<string, unknown> = {
        messages: request.messages,
      };
      if (request.tools !== undefined && request.tools.length > 0) {
        body['tools'] = request.tools;
        body['tool_choice'] = request.tool_choice ?? 'auto';
      }
      if (request.temperature !== undefined) body['temperature'] = request.temperature;
      if (request.maxTokens !== undefined) body['max_tokens'] = request.maxTokens;
      const parsed = await requestJson(
        '/chat/completions',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        undefined,
        options.timeoutMs,
        'Chat completion',
      );
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !Array.isArray((parsed as { choices?: unknown }).choices) ||
        (parsed as { choices: unknown[] }).choices.length === 0
      ) {
        throw new AiClientError(
          'response-invalid',
          'The chat completion response has no "choices" — is a model loaded in LM Studio?',
        );
      }
      const choice = (
        parsed as { choices: { message?: unknown; finish_reason?: unknown }[] }
      ).choices[0]!;
      const message = choice.message;
      if (typeof message !== 'object' || message === null) {
        throw new AiClientError('response-invalid', 'The chat completion choice has no message');
      }
      const usage = (parsed as { usage?: unknown }).usage;
      const usageOut =
        typeof usage === 'object' && usage !== null
          ? {
              promptTokens: Number((usage as { prompt_tokens?: unknown }).prompt_tokens ?? 0) || 0,
              completionTokens:
                Number((usage as { completion_tokens?: unknown }).completion_tokens ?? 0) || 0,
            }
          : null;
      return {
        message: message as ChatMessage,
        finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : null,
        usage: usageOut,
      };
    },
  };
}

/**
 * Connection test for the settings screen (FR-AI-03): one /models round
 * trip measuring latency, reporting models or a truthful error. The
 * optional override lets the settings screen test a candidate URL before
 * saving it.
 */
export async function testLmStudioConnection(
  options: LmStudioClientOptions,
  fetchLike: FetchLike = (input, init) => fetch(input, init),
): Promise<ConnectionTestResult> {
  const started = Date.now();
  try {
    const client = createLmStudioClient(options, fetchLike);
    const models = await client.listModels();
    return {
      ok: true,
      latencyMs: Date.now() - started,
      models: models.map((model) => model.id),
      error: null,
      errorMessage: null,
    };
  } catch (error) {
    if (error instanceof AiClientError) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        models: [],
        error: error.code,
        errorMessage: error.message,
      };
    }
    return {
      ok: false,
      latencyMs: Date.now() - started,
      models: [],
      error: 'unreachable',
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}
