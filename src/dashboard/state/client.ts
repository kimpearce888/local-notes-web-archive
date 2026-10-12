/**
 * Dashboard-side messaging client: wraps chrome.runtime.sendMessage in the
 * shared RPC envelope, validates the response shape, and surfaces coded
 * failures as RpcClientError (mapped from the same protocol the service
 * worker emits). The transport is injectable for tests.
 */

import {
  RPC_KIND,
  isRpcResponse,
  newCorrelationId,
  type RpcErrorCode,
  type RpcRequest,
} from '../../background/protocol';
import type { ApiContract } from './contract';

/** Error carrying the protocol code so UI states can react precisely. */
export class RpcClientError extends Error {
  constructor(readonly code: RpcErrorCode, message: string) {
    super(message);
    this.name = 'RpcClientError';
  }
}

export type RpcTransport = (message: RpcRequest) => Promise<unknown>;

const chromeTransport: RpcTransport = (message) =>
  new Promise((resolve, reject) => {
    // Callback form for maximal chrome-types compatibility; the promise
    // form rejects identically through lastError handling below.
    chrome.runtime.sendMessage(message, (response: unknown) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new RpcClientError('internal-error', lastError.message ?? 'message channel failed'));
        return;
      }
      resolve(response);
    });
  });

export interface ApiClient {
  request<K extends keyof ApiContract>(
    type: K,
    payload: ApiContract[K]['payload'],
  ): Promise<ApiContract[K]['result']>;
}

export function createApiClient(transport: RpcTransport = chromeTransport): ApiClient {
  return {
    async request<K extends keyof ApiContract>(
      type: K,
      payload: ApiContract[K]['payload'],
    ): Promise<ApiContract[K]['result']> {
      const message: RpcRequest = {
        kind: RPC_KIND,
        id: newCorrelationId(),
        type,
        payload,
      };
      let response: unknown;
      try {
        response = await transport(message);
      } catch (error) {
        // Transport failures (worker restarting, channel closed) surface as
        // an honest internal error — never as a fake success.
        throw new RpcClientError(
          'internal-error',
          error instanceof Error ? error.message : 'message channel failed',
        );
      }
      if (!isRpcResponse(response)) {
        throw new RpcClientError('internal-error', 'malformed response from the service worker');
      }
      if (response.ok) {
        return response.result as ApiContract[K]['result'];
      }
      throw new RpcClientError(response.error.code, response.error.message);
    },
  };
}
