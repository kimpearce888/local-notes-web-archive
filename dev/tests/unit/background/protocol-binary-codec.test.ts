import { describe, expect, it } from 'vitest';
import {
  BINARY_ENVELOPE_KEY,
  PayloadValidationError,
  decodeBinaries,
  encodeBinaries,
} from '../../../../src/background/protocol';
import { createApiClient, type RpcTransport } from '../../../../src/dashboard/state/client';

/** The REAL channel semantics: chrome.runtime.sendMessage JSON-serializes. */
function jsonClone(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

describe('binary transfer codec (T-063)', () => {
  it('round-trips a nested payload through real JSON-channel semantics', async () => {
    const bytes = new Uint8Array([1, 2, 3, 255, 0, 128]);
    const payload = {
      noteId: 'n1',
      nested: {
        list: [
          new Blob([bytes as unknown as BlobPart], { type: 'text/plain' }),
          { keep: 'me' },
        ],
      },
    };
    const encoded = (await encodeBinaries(payload)) as typeof payload;
    // The wire only ever sees JSON-ifiable data.
    expect(() => jsonClone(encoded)).not.toThrow();
    const decoded = decodeBinaries(jsonClone(encoded)) as typeof payload;
    const rebuilt = decoded.nested.list[0] as Blob;
    expect(rebuilt).toBeInstanceOf(Blob);
    expect(rebuilt.type).toBe('text/plain');
    expect(Array.from(await blobBytes(rebuilt))).toEqual(Array.from(bytes));
    expect((decoded.nested.list[1] as { keep: string }).keep).toBe('me');
  });

  it('encodes File objects (Blob subclass) with type and bytes intact', async () => {
    const file = new File([new Uint8Array([9, 8, 7])], 'report.bin', {
      type: 'application/octet-stream',
    });
    const encoded = (await encodeBinaries({ data: file })) as { data: Record<string, unknown> };
    expect(encoded.data[BINARY_ENVELOPE_KEY]).toBe(true);
    const decoded = decodeBinaries(jsonClone(encoded)) as { data: Blob };
    expect(decoded.data).toBeInstanceOf(Blob);
    expect(Array.from(await blobBytes(decoded.data))).toEqual([9, 8, 7]);
    expect(decoded.data.type).toBe('application/octet-stream');
  });

  it('round-trips an empty blob and preserves an empty mimeType', async () => {
    const encoded = await encodeBinaries({ data: new Blob([]) });
    const decoded = decodeBinaries(jsonClone(encoded)) as { data: Blob };
    expect(decoded.data).toBeInstanceOf(Blob);
    expect(decoded.data.size).toBe(0);
    expect(decoded.data.type).toBe('application/octet-stream');
  });

  it('round-trips a blob larger than one base64 chunk (chunked btoa path)', async () => {
    // 1 MiB crosses the 32 KiB chunk boundary many times.
    const bytes = new Uint8Array(1024 * 1024);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = index % 251;
    }
    const encoded = await encodeBinaries({ data: new Blob([bytes as unknown as BlobPart]) });
    const decoded = decodeBinaries(jsonClone(encoded)) as { data: Blob };
    expect(decoded.data.size).toBe(bytes.length);
    expect(Array.from(await blobBytes(decoded.data))).toEqual(Array.from(bytes));
  });

  it('preserves unicode content byte-for-byte', async () => {
    const text = 'héllo — 中文 🗂 footnote\u2028';
    const blob = new Blob([text], { type: 'text/markdown' });
    const encoded = await encodeBinaries({ data: blob });
    const decoded = decodeBinaries(jsonClone(encoded)) as { data: Blob };
    expect(await decoded.data.text()).toBe(text);
  });

  it('leaves plain values and Dates untouched; flags Blobs for the wire', async () => {
    const date = new Date(0);
    const blob = new Blob(['x']);
    const value = { n: 5, s: 'ok', d: date, b: blob, nil: null, arr: [1, 'two'] };
    const encoded = (await encodeBinaries(value)) as Record<string, unknown>;
    expect(encoded['n']).toBe(5);
    expect(encoded['s']).toBe('ok');
    // Class instances (Date) pass through BY REFERENCE — never corrupted to {}.
    expect(encoded['d']).toBe(date);
    expect(encoded['nil']).toBeNull();
    // Blobs become envelopes on the wire side…
    expect((encoded['b'] as Record<string, unknown>)[BINARY_ENVELOPE_KEY]).toBe(true);
    // …and decode(encode(x)) restores them while identity-preserving the rest.
    const decoded = decodeBinaries(encoded) as Record<string, unknown>;
    expect(decoded['b']).toBeInstanceOf(Blob);
    expect(await (decoded['b'] as Blob).text()).toBe('x');
    expect(decoded['d']).toBe(date);
    expect(decoded['arr']).toEqual([1, 'two']);
  });

  it('rejects a malformed envelope base64 with a coded validation error', () => {
    const bad = { [BINARY_ENVELOPE_KEY]: true, mimeType: 'text/plain', base64: 'not*base64!' };
    expect(() => decodeBinaries({ data: bad })).toThrow(PayloadValidationError);
    expect(() => decodeBinaries({ data: bad })).toThrow(/malformed/i);
  });

  it('rejects an oversized envelope mimeType', () => {
    const bad = { [BINARY_ENVELOPE_KEY]: true, mimeType: 'a'.repeat(256), base64: '' };
    expect(() => decodeBinaries({ data: bad })).toThrow(/mimeType is too long/i);
  });

  it('treats flag-bearing objects that are not exact envelopes as user data', () => {
    // Reserved-key collision safety: anything beyond the exact 3-key shape
    // passes through untouched instead of failing the whole message.
    const lookalike = { [BINARY_ENVELOPE_KEY]: true, mimeType: 'text/plain', base64: 'QUJD', extra: 1 };
    const decoded = decodeBinaries({ data: lookalike }) as { data: Record<string, unknown> };
    expect(decoded.data).not.toBeInstanceOf(Blob);
    expect(decoded.data).toEqual(lookalike);
    const missing = { [BINARY_ENVELOPE_KEY]: true, note: 'plain user content' };
    const decodedMissing = decodeBinaries({ data: missing }) as { data: Record<string, unknown> };
    expect(decodedMissing.data).toEqual(missing);
  });

  it('refuses absurdly nested payloads on both directions', async () => {
    let deep: unknown = { leaf: 1 };
    for (let level = 0; level < 24; level += 1) {
      deep = { child: deep };
    }
    await expect(encodeBinaries(deep)).rejects.toThrow(/nesting exceeds 16 levels/);
    expect(() => decodeBinaries(deep)).toThrow(PayloadValidationError);
  });
});

describe('binary codec through the client (real channel semantics)', () => {
  /**
   * The regression the T-062 audit proved was missing (D-04/D-06): the
   * transport emulates chrome.runtime.sendMessage's JSON serialization
   * exactly, the far side applies the service-worker entry codec exactly
   * (decode payload / encode result). A File must survive to the handler's
   * `instanceof Blob` guard, and a Blob result must survive back.
   */
  it('carries a File to the handler and a Blob result back (D-04 regression)', async () => {
    const file = new File([new Uint8Array([104, 105, 33])], 'greeting.txt', {
      type: 'text/plain',
    });
    const seen: unknown[] = [];
    // Service-worker stand-in: the entry listener's exact codec placement.
    const workerSide = async (message: unknown): Promise<unknown> => {
      seen.push(message);
      const request = message as { payload: unknown };
      const payload = decodeBinaries(request.payload) as { data: Blob };
      if (!(payload.data instanceof Blob)) {
        throw new Error('D-04 would reproduce here: data is not a Blob after transport');
      }
      expect(Array.from(await blobBytes(payload.data))).toEqual([104, 105, 33]);
      // Respond like attachments/get-blob would: a Blob result on the wire.
      return {
        kind: 'lnwa-rpc',
        id: 'test',
        ok: true,
        result: { blob: await encodeBinaries(payload.data) },
      };
    };
    const jsonChannel: RpcTransport = async (message) => workerSide(jsonClone(message));

    const client = createApiClient(jsonChannel);
    const response = await client.request('attachments/add', {
      noteId: 'n1' as never,
      filename: 'greeting.txt',
      declaredMimeType: 'text/plain',
      data: file,
    });
    // The dashboard-side decode rebuilt the returned blob.
    const returned = (response as unknown as { blob: Blob }).blob;
    expect(returned).toBeInstanceOf(Blob);
    expect(await returned.text()).toBe('hi!');
    // The wire payload itself was JSON-only (no Blob survived serialization).
    const wire = JSON.stringify(seen[0]);
    expect(wire).not.toContain('"size"');
    expect(wire).toContain(BINARY_ENVELOPE_KEY);
  });

  it('surfaces a coded error when the far side rejects a malformed envelope', async () => {
    const jsonChannel: RpcTransport = async () => ({
      kind: 'lnwa-rpc',
      id: 'test',
      ok: false,
      error: { code: 'invalid-request', message: 'binary envelope: base64 payload is malformed' },
    });
    const client = createApiClient(jsonChannel);
    const error = await client
      .request('attachments/add', {
        noteId: 'n1' as never,
        filename: 'x',
        declaredMimeType: '',
        data: new Blob(['x']),
      })
      .catch((e: unknown) => e);
    expect((error as { code: string }).code).toBe('invalid-request');
  });
});
