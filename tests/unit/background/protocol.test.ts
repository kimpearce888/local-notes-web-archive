import { describe, expect, it } from 'vitest';
import {
  RPC_KIND,
  isRpcRequest,
  newCorrelationId,
  rpcFailure,
  rpcSuccess,
  PayloadValidationError,
  UnsupportedError,
} from '../../../src/background/protocol';

describe('RPC protocol envelope', () => {
  it('accepts a well-formed request', () => {
    const request = { kind: RPC_KIND, id: 'abc', type: 'notes/create', payload: { title: 'x' } };
    expect(isRpcRequest(request)).toBe(true);
  });

  it('accepts a request whose payload is null or missing content', () => {
    expect(isRpcRequest({ kind: RPC_KIND, id: 'abc', type: 'app/ping', payload: null })).toBe(true);
    expect(isRpcRequest({ kind: RPC_KIND, id: 'abc', type: 'app/ping', payload: {} })).toBe(true);
  });

  it('rejects non-objects, arrays and null', () => {
    expect(isRpcRequest(null)).toBe(false);
    expect(isRpcRequest(undefined)).toBe(false);
    expect(isRpcRequest('notes/create')).toBe(false);
    expect(isRpcRequest([RPC_KIND, 'abc'])).toBe(false);
  });

  it('rejects wrong kind, missing/empty id and missing type', () => {
    expect(isRpcRequest({ id: 'abc', type: 'notes/create', payload: {} })).toBe(false);
    expect(isRpcRequest({ kind: 'other', id: 'abc', type: 'notes/create', payload: {} })).toBe(false);
    expect(isRpcRequest({ kind: RPC_KIND, type: 'notes/create', payload: {} })).toBe(false);
    expect(isRpcRequest({ kind: RPC_KIND, id: '', type: 'notes/create', payload: {} })).toBe(false);
    expect(isRpcRequest({ kind: RPC_KIND, id: 'abc', payload: {} })).toBe(false);
    expect(isRpcRequest({ kind: RPC_KIND, id: 'abc', type: '', payload: {} })).toBe(false);
  });

  it('rejects envelopes without a payload key', () => {
    expect(isRpcRequest({ kind: RPC_KIND, id: 'abc', type: 'notes/create' })).toBe(false);
  });
});

describe('correlation ids', () => {
  it('generates distinct UUID-shaped ids', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      const id = newCorrelationId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      seen.add(id);
    }
    expect(seen.size).toBe(100);
  });
});

describe('response constructors', () => {
  it('normalizes an undefined result to null over the wire', () => {
    const response = rpcSuccess('id-1', undefined);
    expect(response).toEqual({ kind: RPC_KIND, id: 'id-1', ok: true, result: null });
  });

  it('carries coded errors', () => {
    const response = rpcFailure('id-2', 'conflict', 'stale revision');
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error).toEqual({ code: 'conflict', message: 'stale revision' });
    }
  });
});

describe('protocol error classes', () => {
  it('maps validation errors to invalid-request', () => {
    const error = new PayloadValidationError('title: expected a string');
    expect(error.code).toBe('invalid-request');
    expect(error.message).toBe('title: expected a string');
  });

  it('maps unsupported errors to unsupported', () => {
    expect(new UnsupportedError('no alarms API').code).toBe('unsupported');
  });
});
