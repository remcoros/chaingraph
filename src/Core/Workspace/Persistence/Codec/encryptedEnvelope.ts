import { base64 } from '@scure/base';
import {
  compressWorkspaceBytes,
  decompressWorkspaceBytes,
  MAX_WORKSPACE_BYTES,
  type WorkspaceCompression,
} from './workspaceCompression';
import { WorkspaceCryptoError } from './workspaceCodecError';

export { MAX_WORKSPACE_BYTES } from './workspaceCompression';

interface EnvelopeFields {
  format: 'chaingraph-workspace';
  cipher: 'AES-256-GCM';
  kdf: 'PBKDF2-SHA256';
  iterations: 600000;
  salt: string;
  iv: string;
  ciphertext: string;
}

/** Format 2 defines gzip (one complete member) or raw UTF-8 JSON; codec is authenticated. */
export type EncryptedEnvelope = EnvelopeFields &
  ({ version: 1 } | { version: 2; compression: WorkspaceCompression });

/** Optional in-memory benchmark counters. Never record passwords, keys or workspace data. */
export interface WorkspaceCryptoTimings {
  jsonMs?: number;
  compressionMs?: number;
  kdfMs?: number;
  aesMs?: number;
  encodingMs?: number;
  plaintextBytes?: number;
  encodedBytes?: number;
}

export const MAX_ENCRYPTED_FILE_BYTES = Math.ceil((MAX_WORKSPACE_BYTES + 16) / 3) * 4 + 1024;
const iterations = 600000 as const;
const encoder = new TextEncoder();
const metadata = {
  format: 'chaingraph-workspace',
  version: 1,
  cipher: 'AES-256-GCM',
  kdf: 'PBKDF2-SHA256',
  iterations,
} as const;

function webCrypto(): Crypto {
  if (!globalThis.crypto?.subtle)
    throw new Error('Workspace encryption requires HTTPS or localhost with Web Crypto support.');
  return globalThis.crypto;
}

function passwordBytes(password: string, creating: boolean): Uint8Array<ArrayBuffer> {
  if (typeof password !== 'string' || (creating && password.length < 8) || password.length > 1024) {
    throw new Error('Use a workspace password between 8 and 1024 characters.');
  }
  return encoder.encode(password);
}

async function deriveKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  creating: boolean,
): Promise<CryptoKey> {
  const bytes = passwordBytes(password, creating);
  try {
    const material = await webCrypto().subtle.importKey('raw', bytes, 'PBKDF2', false, [
      'deriveKey',
    ]);
    return await webCrypto().subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  } finally {
    bytes.fill(0);
  }
}

function associatedData(envelope: EncryptedEnvelope): Uint8Array<ArrayBuffer> {
  // Preserve the exact v1 JSON property order for all existing encrypted backups.
  const authenticatedMetadata =
    envelope.version === 1
      ? metadata
      : { ...metadata, version: 2, compression: envelope.compression };
  return encoder.encode(
    JSON.stringify({ ...authenticatedMetadata, salt: envelope.salt, iv: envelope.iv }),
  );
}

function decodeBase64(value: unknown, min: number, max: number): Uint8Array<ArrayBuffer> {
  if (
    typeof value !== 'string' ||
    value.length > Math.ceil(max / 3) * 4 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    throw new WorkspaceCryptoError('invalid-envelope');
  }
  try {
    const bytes = new Uint8Array(base64.decode(value));
    if (bytes.length < min || bytes.length > max || base64.encode(bytes) !== value)
      throw new WorkspaceCryptoError('invalid-envelope');
    return bytes;
  } catch {
    throw new WorkspaceCryptoError('invalid-envelope');
  }
}

/** Cheap metadata check for the public index; full base64 decoding stays in the worker. */
export function assertEnvelopeHeader(input: unknown): asserts input is EncryptedEnvelope {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new WorkspaceCryptoError('invalid-envelope');
  const record = input as Record<string, unknown>;
  if (
    record.format !== metadata.format ||
    (record.version !== 1 && record.version !== 2) ||
    record.cipher !== metadata.cipher ||
    record.kdf !== metadata.kdf ||
    record.iterations !== metadata.iterations ||
    (record.version === 2 && record.compression !== 'none' && record.compression !== 'gzip')
  )
    throw new WorkspaceCryptoError('unsupported-format');
  const expected = [
    ...Object.keys(metadata),
    'salt',
    'iv',
    'ciphertext',
    ...(record.version === 2 ? ['compression'] : []),
  ];
  if (
    Object.keys(record).length !== expected.length ||
    expected.some((key) => !Object.hasOwn(record, key)) ||
    typeof record.salt !== 'string' ||
    record.salt.length !== 24 ||
    typeof record.iv !== 'string' ||
    record.iv.length !== 16 ||
    typeof record.ciphertext !== 'string' ||
    record.ciphertext.length < 24 ||
    record.ciphertext.length > Math.ceil((MAX_WORKSPACE_BYTES + 16) / 3) * 4
  )
    throw new WorkspaceCryptoError('invalid-envelope');
}

function parseEnvelope(input: unknown): {
  envelope: EncryptedEnvelope;
  salt: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: Uint8Array<ArrayBuffer>;
} {
  assertEnvelopeHeader(input);
  const salt = decodeBase64(input.salt, 16, 16);
  const iv = decodeBase64(input.iv, 12, 12);
  const ciphertext = decodeBase64(input.ciphertext, 17, MAX_WORKSPACE_BYTES + 16);
  return { envelope: input, salt, iv, ciphertext };
}

/** Caller persists only this envelope. Never store the password or the decrypted data. */
export async function encryptWorkspace(
  data: unknown,
  password: string,
  timings?: WorkspaceCryptoTimings,
): Promise<EncryptedEnvelope> {
  passwordBytes(password, true).fill(0);
  let started = performance.now();
  const json = JSON.stringify(data);
  if (json === undefined) throw new Error('Workspace must be JSON and no larger than 32 MiB.');
  if (json.length > MAX_WORKSPACE_BYTES) throw new WorkspaceCryptoError('size-limit');
  const plaintext = encoder.encode(json);
  let payload: Uint8Array<ArrayBuffer> | undefined;
  try {
    if (plaintext.byteLength > MAX_WORKSPACE_BYTES) throw new WorkspaceCryptoError('size-limit');
    if (timings) {
      timings.jsonMs = performance.now() - started;
      timings.plaintextBytes = plaintext.byteLength;
    }
    started = performance.now();
    const compressed = await compressWorkspaceBytes(plaintext);
    payload = compressed.bytes;
    if (timings) {
      timings.compressionMs = performance.now() - started;
      timings.encodedBytes = payload.byteLength;
    }
    const salt = webCrypto().getRandomValues(new Uint8Array(16));
    const iv = webCrypto().getRandomValues(new Uint8Array(12));
    const envelope: EncryptedEnvelope = {
      ...metadata,
      version: 2,
      compression: compressed.compression,
      salt: base64.encode(salt),
      iv: base64.encode(iv),
      ciphertext: '',
    };
    started = performance.now();
    const key = await deriveKey(password, salt, true);
    if (timings) timings.kdfMs = performance.now() - started;
    started = performance.now();
    const encrypted = await webCrypto().subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: associatedData(envelope), tagLength: 128 },
      key,
      payload,
    );
    if (timings) timings.aesMs = performance.now() - started;
    started = performance.now();
    const ciphertext = base64.encode(new Uint8Array(encrypted));
    if (timings) timings.encodingMs = performance.now() - started;
    return { ...envelope, ciphertext };
  } finally {
    plaintext.fill(0);
    payload?.fill(0);
  }
}

/** Decrypted JSON is untrusted: callers must migrate and validate the workspace before use. */
export async function decryptWorkspace(
  input: unknown,
  password: string,
  timings?: WorkspaceCryptoTimings,
): Promise<unknown> {
  let started = performance.now();
  const { envelope, salt, iv, ciphertext } = parseEnvelope(input);
  if (timings) timings.encodingMs = performance.now() - started;
  started = performance.now();
  const key = await deriveKey(password, salt, false);
  if (timings) timings.kdfMs = performance.now() - started;
  let authenticated: Uint8Array<ArrayBuffer> | undefined;
  let plaintext: Uint8Array<ArrayBuffer> | undefined;
  try {
    started = performance.now();
    try {
      authenticated = new Uint8Array(
        await webCrypto().subtle.decrypt(
          { name: 'AES-GCM', iv, additionalData: associatedData(envelope), tagLength: 128 },
          key,
          ciphertext,
        ),
      );
    } catch {
      throw new WorkspaceCryptoError('unlock-failed');
    }
    if (timings) {
      timings.aesMs = performance.now() - started;
      timings.encodedBytes = authenticated.byteLength;
    }
    started = performance.now();
    plaintext =
      envelope.version === 2 && envelope.compression === 'gzip'
        ? await decompressWorkspaceBytes(authenticated)
        : authenticated;
    if (plaintext.byteLength > MAX_WORKSPACE_BYTES) throw new WorkspaceCryptoError('size-limit');
    if (timings) {
      timings.compressionMs = performance.now() - started;
      timings.plaintextBytes = plaintext.byteLength;
    }
    started = performance.now();
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)) as unknown;
    } catch {
      throw new WorkspaceCryptoError('invalid-payload');
    } finally {
      if (timings) timings.jsonMs = performance.now() - started;
    }
  } finally {
    plaintext?.fill(0);
    authenticated?.fill(0);
  }
}
