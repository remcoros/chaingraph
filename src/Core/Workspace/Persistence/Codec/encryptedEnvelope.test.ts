import { afterEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { base64 } from '@scure/base';
import {
  decryptWorkspace,
  encryptWorkspace,
  MAX_WORKSPACE_BYTES,
  type EncryptedEnvelope,
} from './encryptedEnvelope';
import { compressWorkspaceBytes, readBoundedStream } from './workspaceCompression';

const password = 'a strong workspace passphrase 🔒';
const data = {
  network: 'testnet4',
  wallets: [{ xpub: 'public-key', label: 'Savings' }],
  notes: '€ & 日本語',
  nodes: [],
};

describe('encrypted workspace boundary', () => {
  it('round trips JSON with fresh salt and nonce for every save', async () => {
    const first = await encryptWorkspace(data, password);
    const second = await encryptWorkspace(data, password);
    expect(first.salt).not.toBe(second.salt);
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(JSON.stringify(first)).not.toContain('Savings');
    expect(JSON.stringify(first)).not.toContain('public-key');
    expect(await decryptWorkspace(JSON.parse(JSON.stringify(first)), password)).toEqual(data);
  });

  it('rejects wrong passwords and tampering with ciphertext, salt, or nonce', async () => {
    const envelope = await encryptWorkspace(data, password);
    await expect(decryptWorkspace(envelope, 'wrong password')).rejects.toThrow('Unable to unlock');
    for (const field of ['ciphertext', 'salt', 'iv'] as const) {
      const bytes = base64.decode(envelope[field]);
      bytes[0] ^= 1;
      await expect(
        decryptWorkspace({ ...envelope, [field]: base64.encode(bytes) }, password),
      ).rejects.toThrow('Unable to unlock');
    }
  });

  it('rejects unsupported versions and arbitrary KDF work before deriving keys', async () => {
    const envelope = await encryptWorkspace(data, password);
    const derive = vi.spyOn(crypto.subtle, 'deriveKey');
    for (const value of [0, -1, 1, 599999, 600001, 99999999999, '600000']) {
      await expect(decryptWorkspace({ ...envelope, iterations: value }, password)).rejects.toThrow(
        'Unsupported',
      );
    }
    await expect(decryptWorkspace({ ...envelope, version: 3 }, password)).rejects.toThrow(
      'Unsupported',
    );
    await expect(decryptWorkspace({ ...envelope, cipher: 'AES-CBC' }, password)).rejects.toThrow(
      'Unsupported',
    );
    await expect(decryptWorkspace({ ...envelope, extra: true }, password)).rejects.toThrow(
      'fields',
    );
    expect(derive).not.toHaveBeenCalled();
  });

  it('rejects malformed and oversized envelopes', async () => {
    const envelope = await encryptWorkspace(data, password);
    for (const input of [
      null,
      [],
      'plaintext',
      {},
      { ...envelope, iv: '====' },
      { ...envelope, salt: 'AAAA' },
      { ...envelope, ciphertext: '' },
    ]) {
      await expect(decryptWorkspace(input, password)).rejects.toThrow();
    }
    await expect(
      decryptWorkspace(
        { ...envelope, ciphertext: 'A'.repeat(Math.ceil((MAX_WORKSPACE_BYTES + 16) / 3) * 4 + 4) },
        password,
      ),
    ).rejects.toThrow('encoding');
    await expect(encryptWorkspace('A'.repeat(MAX_WORKSPACE_BYTES), password)).rejects.toThrow(
      '32 MiB',
    );
    await expect(encryptWorkspace(undefined, password)).rejects.toThrow('JSON');
  });

  it('handles a substantial payload without recursive base64 validation limits', async () => {
    const large = { notes: 'payload'.repeat(150000) };
    const envelope = await encryptWorkspace(large, password);
    expect(await decryptWorkspace(envelope, password)).toEqual(large);
  });

  it('requires a usable password for new encryption', async () => {
    await expect(encryptWorkspace(data, 'short')).rejects.toThrow('8 and 1024');
    await expect(encryptWorkspace(data, 'a'.repeat(1025))).rejects.toThrow('8 and 1024');
  });
});

// Independent construction preserves the exact pre-compression v1 AAD contract and
// lets authenticated malformed compressed data exercise the post-AES boundary.
async function sealBytes(bytes: Uint8Array<ArrayBuffer>, version: 1 | 2 = 2, compression = 'gzip') {
  const salt = new Uint8Array(16).fill(7);
  const iv = new Uint8Array(12).fill(9);
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const header = {
    format: 'chaingraph-workspace',
    version,
    cipher: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: 600000,
    ...(version === 2 ? { compression } : {}),
    salt: base64.encode(salt),
    iv: base64.encode(iv),
  };
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      tagLength: 128,
      additionalData: new TextEncoder().encode(JSON.stringify(header)),
    },
    key,
    bytes,
  );
  return { ...header, ciphertext: base64.encode(new Uint8Array(ciphertext)) };
}

const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const gzipBytes = (bytes: Uint8Array<ArrayBuffer>) => new Uint8Array(gzipSync(bytes));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('versioned workspace compression', () => {
  it('reads legacy v1 payloads and writes only authenticated v2 envelopes', async () => {
    const legacy = await sealBytes(jsonBytes(data), 1);
    expect(await decryptWorkspace(legacy, password)).toEqual(data);
    const current = await encryptWorkspace(data, password);
    expect(current).toMatchObject({ version: 2, compression: 'none', iterations: 600000 });
    const large = { ...data, notes: 'Public synthetic annotation. '.repeat(10000) };
    const compressed = await encryptWorkspace(large, password);
    expect(compressed).toMatchObject({ version: 2, compression: 'gzip' });
    expect(base64.decode(compressed.ciphertext).length).toBeLessThan(jsonBytes(large).length / 10);
    expect(await decryptWorkspace(compressed, password)).toEqual(large);
  });

  it('deliberately skips tiny or incompressible bytes without downgrading format', async () => {
    const tiny = new Uint8Array(1023).fill(65);
    expect(await compressWorkspaceBytes(tiny)).toEqual({ compression: 'none', bytes: tiny });
    const noise = crypto.getRandomValues(new Uint8Array(4096));
    expect(await compressWorkspaceBytes(noise)).toEqual({ compression: 'none', bytes: noise });
    const larger = new Uint8Array(1024).fill(65);
    expect((await compressWorkspaceBytes(larger)).compression).toBe('gzip');
  });

  it('authenticates codec and format changes, and rejects unknown codecs before KDF', async () => {
    const envelope = await encryptWorkspace({ notes: 'abc'.repeat(10000) }, password);
    await expect(
      decryptWorkspace({ ...envelope, compression: 'none' }, password),
    ).rejects.toMatchObject({ code: 'unlock-failed' });
    const { compression: _compression, ...legacyShape } = envelope as Extract<
      EncryptedEnvelope,
      { version: 2 }
    >;
    await expect(decryptWorkspace({ ...legacyShape, version: 1 }, password)).rejects.toMatchObject({
      code: 'unlock-failed',
    });
    for (const compression of ['brotli', 'deflate', 1, null, undefined]) {
      await expect(decryptWorkspace({ ...envelope, compression }, password)).rejects.toMatchObject({
        code: 'unsupported-format',
      });
    }
  });

  it('authenticates before attempting to construct a decompressor', async () => {
    const envelope = await encryptWorkspace({ notes: 'abc'.repeat(10000) }, password);
    const construct = vi.fn(function unsupportedDecompressionStream() {
      throw new Error('unsupported');
    });
    vi.stubGlobal('DecompressionStream', construct);
    await expect(decryptWorkspace(envelope, 'wrong password')).rejects.toMatchObject({
      code: 'unlock-failed',
    });
    expect(construct).not.toHaveBeenCalled();
    await expect(decryptWorkspace(envelope, password)).rejects.toMatchObject({
      code: 'compression-unavailable',
    });
    expect(construct).toHaveBeenCalledOnce();
  });

  it('fails new writes without either compression API but still reads v1 and v2 none', async () => {
    const legacy = await sealBytes(jsonBytes(data), 1);
    const raw = await encryptWorkspace(data, password);
    const compressed = await encryptWorkspace({ notes: 'abc'.repeat(10000) }, password);
    vi.stubGlobal('CompressionStream', undefined);
    await expect(encryptWorkspace(data, password)).rejects.toMatchObject({
      code: 'compression-unavailable',
    });
    expect(await decryptWorkspace(raw, password)).toEqual(data);
    vi.stubGlobal('DecompressionStream', undefined);
    await expect(encryptWorkspace(data, password)).rejects.toMatchObject({
      code: 'compression-unavailable',
    });
    expect(await decryptWorkspace(legacy, password)).toEqual(data);
    expect(await decryptWorkspace(raw, password)).toEqual(data);
    await expect(decryptWorkspace(compressed, password)).rejects.toMatchObject({
      code: 'compression-unavailable',
    });
  });

  it('rejects authenticated truncation, checksum corruption, trailing junk and multiple members', async () => {
    const compressed = gzipBytes(jsonBytes(data));
    const corrupt = compressed.slice();
    corrupt[corrupt.length - 8] ^= 1;
    for (const bytes of [
      compressed.slice(0, -1),
      corrupt,
      new Uint8Array([1, 2, 3]),
      new Uint8Array([...compressed, 1]),
      new Uint8Array([...compressed, ...compressed]),
    ]) {
      await expect(decryptWorkspace(await sealBytes(bytes), password)).rejects.toMatchObject({
        code: 'compression-failed',
      });
    }
  });

  it('rejects expansion beyond 32 MiB while streaming', async () => {
    const bomb = gzipBytes(new Uint8Array(MAX_WORKSPACE_BYTES + 1).fill(65));
    expect(bomb.byteLength).toBeLessThan(100000);
    await expect(decryptWorkspace(await sealBytes(bomb), password)).rejects.toMatchObject({
      code: 'size-limit',
    });
  });

  it('cancels a producer at the first excess chunk and clears retained bytes', async () => {
    const first = new Uint8Array(8).fill(65);
    const excess = new Uint8Array(8).fill(66);
    let pulls = 0;
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          controller.enqueue(pulls++ === 0 ? first : excess);
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    await expect(readBoundedStream(stream, 10)).rejects.toMatchObject({ code: 'size-limit' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(pulls).toBe(2);
    expect(first.every((byte) => byte === 0)).toBe(true);
    expect(excess.every((byte) => byte === 0)).toBe(true);
  });

  it('rejects authenticated invalid UTF-8 or JSON separately from passwords', async () => {
    for (const bytes of [new Uint8Array([0xff]), new TextEncoder().encode('{bad')]) {
      await expect(
        decryptWorkspace(await sealBytes(gzipBytes(bytes)), password),
      ).rejects.toMatchObject({ code: 'invalid-payload' });
    }
  });

  it('reports phase and byte measurements only when requested', async () => {
    const save = {};
    const envelope = await encryptWorkspace(data, password, save);
    const unlock = {};
    await decryptWorkspace(envelope, password, unlock);
    for (const measurement of [save, unlock]) {
      expect(measurement).toMatchObject({
        jsonMs: expect.any(Number),
        compressionMs: expect.any(Number),
        kdfMs: expect.any(Number),
        aesMs: expect.any(Number),
        encodingMs: expect.any(Number),
        plaintextBytes: jsonBytes(data).length,
        encodedBytes: jsonBytes(data).length,
      });
    }
  });
});
