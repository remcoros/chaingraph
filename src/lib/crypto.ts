import { base64 } from '@scure/base';

/** Version 1 deliberately fixes KDF costs; imported files cannot choose arbitrary work. */
export interface EncryptedEnvelope {
  format: 'chaingraph-workspace';
  version: 1;
  cipher: 'AES-256-GCM';
  kdf: 'PBKDF2-SHA256';
  iterations: 600000;
  salt: string;
  iv: string;
  ciphertext: string;
}

export const MAX_WORKSPACE_BYTES = 32 * 1024 * 1024;
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

function associatedData(envelope: Pick<EncryptedEnvelope, 'salt' | 'iv'>): Uint8Array<ArrayBuffer> {
  return encoder.encode(JSON.stringify({ ...metadata, salt: envelope.salt, iv: envelope.iv }));
}

function decodeBase64(value: unknown, min: number, max: number): Uint8Array<ArrayBuffer> {
  if (
    typeof value !== 'string' ||
    value.length > Math.ceil(max / 3) * 4 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    throw new Error('Invalid encrypted workspace encoding.');
  }
  const bytes = new Uint8Array(base64.decode(value));
  if (bytes.length < min || bytes.length > max || base64.encode(bytes) !== value)
    throw new Error('Invalid encrypted workspace field length.');
  return bytes;
}

function parseEnvelope(input: unknown): {
  envelope: EncryptedEnvelope;
  salt: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: Uint8Array<ArrayBuffer>;
} {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid encrypted workspace.');
  const record = input as Record<string, unknown>;
  const expected = [...Object.keys(metadata), 'salt', 'iv', 'ciphertext'];
  if (
    Object.keys(record).length !== expected.length ||
    expected.some((key) => !Object.hasOwn(record, key))
  )
    throw new Error('Invalid encrypted workspace fields.');
  if (Object.entries(metadata).some(([key, value]) => record[key] !== value))
    throw new Error('Unsupported encrypted workspace format or encryption settings.');
  const salt = decodeBase64(record.salt, 16, 16);
  const iv = decodeBase64(record.iv, 12, 12);
  const ciphertext = decodeBase64(record.ciphertext, 17, MAX_WORKSPACE_BYTES + 16);
  return { envelope: record as unknown as EncryptedEnvelope, salt, iv, ciphertext };
}

/** Caller persists only this envelope. Never store the password or the decrypted data. */
export async function encryptWorkspace(
  data: unknown,
  password: string,
): Promise<EncryptedEnvelope> {
  passwordBytes(password, true).fill(0);
  const json = JSON.stringify(data);
  if (json === undefined || json.length > MAX_WORKSPACE_BYTES)
    throw new Error('Workspace must be JSON and no larger than 32 MiB.');
  const plaintext = encoder.encode(json);
  if (plaintext.byteLength > MAX_WORKSPACE_BYTES)
    throw new Error('Workspace exceeds the 32 MiB limit.');
  const salt = webCrypto().getRandomValues(new Uint8Array(16));
  const iv = webCrypto().getRandomValues(new Uint8Array(12));
  const envelope: EncryptedEnvelope = {
    ...metadata,
    salt: base64.encode(salt),
    iv: base64.encode(iv),
    ciphertext: '',
  };
  try {
    const key = await deriveKey(password, salt, true);
    const encrypted = await webCrypto().subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: associatedData(envelope), tagLength: 128 },
      key,
      plaintext,
    );
    return { ...envelope, ciphertext: base64.encode(new Uint8Array(encrypted)) };
  } finally {
    plaintext.fill(0);
  }
}

/** Decrypted JSON is untrusted: callers must validate their workspace schema before use. */
export async function decryptWorkspace(input: unknown, password: string): Promise<unknown> {
  const { envelope, salt, iv, ciphertext } = parseEnvelope(input);
  const key = await deriveKey(password, salt, false);
  let plaintext: Uint8Array<ArrayBuffer> | undefined;
  try {
    plaintext = new Uint8Array(
      await webCrypto().subtle.decrypt(
        { name: 'AES-GCM', iv, additionalData: associatedData(envelope), tagLength: 128 },
        key,
        ciphertext,
      ),
    );
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)) as unknown;
  } catch {
    throw new Error(
      'Unable to unlock workspace. The password is incorrect or the file was changed.',
    );
  } finally {
    plaintext?.fill(0);
  }
}
