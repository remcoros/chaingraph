/** Synthetic-only Node Web API surrogate. No browser, backend, storage or private fixtures. */
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { base64 } from '@scure/base';
import { parseWorkspace } from '../src/domain/workspace';
import type { Workspace } from '../src/domain/types';
import { decryptWorkspace, encryptWorkspace, type WorkspaceCryptoTimings } from '../src/lib/crypto';
import {
  compressWorkspaceBytes,
  readBoundedStream,
  MAX_WORKSPACE_BYTES,
} from '../src/lib/workspaceCompression';
import {
  compressionWalletFixture,
  tinyCompressionFixture,
  incompressibleFixture,
} from '../tests/fixtures/workspace-compression';

const password = 'public synthetic benchmark password';
const encoder = new TextEncoder();
const metadata = {
  format: 'chaingraph-workspace',
  version: 1,
  cipher: 'AES-256-GCM',
  kdf: 'PBKDF2-SHA256',
  iterations: 600000,
} as const;
type LegacyEnvelope = typeof metadata & { salt: string; iv: string; ciphertext: string };
const now = () => performance.now();
const rounds = 5;

// Benchmark-only reproduction of the original v1 pipeline, including base64
// canonicality checks, fresh salts/IVs, password byte wiping and unchanged AAD.
// Keeping this local avoids a production "save legacy" escape hatch.
async function legacyKey(salt: Uint8Array<ArrayBuffer>) {
  const bytes = encoder.encode(password);
  try {
    const material = await crypto.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveKey']);
    return await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  } finally {
    bytes.fill(0);
  }
}
function legacyAAD(envelope: Pick<LegacyEnvelope, 'salt' | 'iv'>) {
  return encoder.encode(JSON.stringify({ ...metadata, salt: envelope.salt, iv: envelope.iv }));
}
function decode(value: string, min: number, max: number): Uint8Array<ArrayBuffer> {
  assert(
    value.length <= Math.ceil(max / 3) * 4 &&
      value.length % 4 === 0 &&
      /^[A-Za-z0-9+/]*={0,2}$/.test(value),
  );
  const bytes = new Uint8Array(base64.decode(value));
  assert(bytes.length >= min && bytes.length <= max && base64.encode(bytes) === value);
  return bytes;
}
async function legacyEncrypt(
  workspace: Workspace,
  timings: WorkspaceCryptoTimings,
): Promise<LegacyEnvelope> {
  let start = now();
  assert(password.length >= 8 && password.length <= 1024);
  encoder.encode(password).fill(0);
  const json = JSON.stringify(workspace);
  assert(json !== undefined && json.length <= MAX_WORKSPACE_BYTES);
  const plaintext = encoder.encode(json);
  assert(plaintext.length <= MAX_WORKSPACE_BYTES);
  timings.jsonMs = now() - start;
  timings.plaintextBytes = plaintext.length;
  timings.encodedBytes = plaintext.length;
  timings.compressionMs = 0;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const envelope = {
    ...metadata,
    salt: base64.encode(salt),
    iv: base64.encode(iv),
    ciphertext: '',
  };
  try {
    start = now();
    const key = await legacyKey(salt);
    timings.kdfMs = now() - start;
    start = now();
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: legacyAAD(envelope), tagLength: 128 },
      key,
      plaintext,
    );
    timings.aesMs = now() - start;
    start = now();
    const result = { ...envelope, ciphertext: base64.encode(new Uint8Array(encrypted)) };
    timings.encodingMs = now() - start;
    return result;
  } finally {
    plaintext.fill(0);
  }
}
async function legacyDecrypt(
  envelope: LegacyEnvelope,
  timings: WorkspaceCryptoTimings,
): Promise<unknown> {
  let start = now();
  const expected = [...Object.keys(metadata), 'salt', 'iv', 'ciphertext'];
  assert(
    Object.keys(envelope).length === expected.length &&
      expected.every((key) => Object.hasOwn(envelope, key)),
  );
  assert(
    Object.entries(metadata).every(
      ([key, value]) => envelope[key as keyof LegacyEnvelope] === value,
    ),
  );
  const salt = decode(envelope.salt, 16, 16);
  const iv = decode(envelope.iv, 12, 12);
  const ciphertext = decode(envelope.ciphertext, 17, MAX_WORKSPACE_BYTES + 16);
  timings.encodingMs = now() - start;
  start = now();
  const key = await legacyKey(salt);
  timings.kdfMs = now() - start;
  let plaintext: Uint8Array<ArrayBuffer> | undefined;
  try {
    start = now();
    plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, additionalData: legacyAAD(envelope), tagLength: 128 },
        key,
        ciphertext,
      ),
    );
    timings.aesMs = now() - start;
    timings.plaintextBytes = plaintext.length;
    timings.encodedBytes = plaintext.length;
    timings.compressionMs = 0;
    start = now();
    const result = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(plaintext),
    ) as unknown;
    timings.jsonMs = now() - start;
    return result;
  } finally {
    plaintext?.fill(0);
  }
}

type Measurement = { totalMs: number; validationMs: number } & WorkspaceCryptoTimings;
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
function summarize(samples: Measurement[]) {
  const fields = [
    'totalMs',
    'validationMs',
    'jsonMs',
    'compressionMs',
    'kdfMs',
    'aesMs',
    'encodingMs',
  ] as const;
  return {
    ...Object.fromEntries(
      fields.map((field) => [
        field,
        Number(median(samples.map((sample) => sample[field] ?? 0)).toFixed(2)),
      ]),
    ),
    totalRangeMs: [
      Math.min(...samples.map((s) => s.totalMs)),
      Math.max(...samples.map((s) => s.totalMs)),
    ].map((ms) => Number(ms.toFixed(2))),
  };
}
async function benchmark(name: string, workspace: Workspace) {
  const samples = {
    legacySave: [] as Measurement[],
    legacyUnlock: [] as Measurement[],
    v2Save: [] as Measurement[],
    v2Unlock: [] as Measurement[],
  };
  let sizes = {};
  for (let round = -1; round < rounds; round++) {
    // Alternate format order to limit systematic warmup/thermal bias. One full unrecorded round.
    for (const legacy of round % 2 === 0 ? [false, true] : [true, false]) {
      const save: Measurement = { totalMs: 0, validationMs: 0 };
      let start = now();
      let phase = now();
      const validated = parseWorkspace(workspace, false);
      save.validationMs = now() - phase;
      const envelope = legacy
        ? await legacyEncrypt(validated, save)
        : await encryptWorkspace(validated, password, save);
      save.totalMs = now() - start;
      const unlock: Measurement = { totalMs: 0, validationMs: 0 };
      start = now();
      const decoded = legacy
        ? await legacyDecrypt(envelope as LegacyEnvelope, unlock)
        : await decryptWorkspace(envelope, password, unlock);
      phase = now();
      const restored = parseWorkspace(decoded, true);
      unlock.validationMs = now() - phase;
      unlock.totalMs = now() - start;
      // Equality and envelope formatting happen outside measurements. Never print either payload.
      assert(isDeepStrictEqual(restored, validated), 'Workspace round trip mismatch.');
      if (round >= 0) {
        samples[legacy ? 'legacySave' : 'v2Save'].push(save);
        samples[legacy ? 'legacyUnlock' : 'v2Unlock'].push(unlock);
      }
      const envelopeBytes = encoder.encode(JSON.stringify(envelope)).length;
      sizes = {
        ...sizes,
        ...(legacy
          ? { legacyEnvelopeBytes: envelopeBytes }
          : {
              jsonBytes: save.plaintextBytes,
              encodedBytes: save.encodedBytes,
              v2EnvelopeBytes: envelopeBytes,
              compression: 'compression' in envelope ? envelope.compression : undefined,
            }),
      };
    }
  }
  return {
    name,
    wallets: workspace.wallets.length,
    addresses: workspace.wallets.reduce((total, wallet) => total + wallet.addresses.length, 0),
    transactions: Object.keys(workspace.transactions).length,
    ...sizes,
    ...Object.fromEntries(Object.entries(samples).map(([key, values]) => [key, summarize(values)])),
  };
}

async function codecProbe() {
  const bytes = incompressibleFixture();
  const gzip = await readBoundedStream(
    new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')),
    bytes.length + 1024,
  );
  const result = await compressWorkspaceBytes(bytes);
  assert.equal(result.compression, 'none');
  assert(isDeepStrictEqual(result.bytes, bytes), 'Incompressible probe mismatch.');
  return {
    inputBytes: bytes.length,
    gzipBytes: gzip.length,
    selectedCodec: result.compression,
    selectedBytes: result.bytes.length,
  };
}

async function compareNativeCodecs(name: string, workspace: Workspace) {
  const bytes = encoder.encode(JSON.stringify(parseWorkspace(workspace, false)));
  const result: Record<string, unknown> = {
    name: `${name}-native-codecs`,
    jsonBytes: bytes.length,
  };
  for (const codec of nativeBrotli ? ['gzip', 'brotli'] : ['gzip']) {
    const compression: number[] = [];
    const decompression: number[] = [];
    let encodedBytes = 0;
    for (let round = -1; round < rounds; round++) {
      let start = now();
      const encoded = await readBoundedStream(
        new Blob([bytes]).stream().pipeThrough(new CompressionStream(codec as CompressionFormat)),
        MAX_WORKSPACE_BYTES,
      );
      const compressMs = now() - start;
      start = now();
      const restored = await readBoundedStream(
        new Blob([encoded])
          .stream()
          .pipeThrough(new DecompressionStream(codec as CompressionFormat)),
        MAX_WORKSPACE_BYTES,
      );
      const decompressMs = now() - start;
      assert(isDeepStrictEqual(restored, bytes), 'Codec round trip mismatch.');
      encodedBytes = encoded.length;
      if (round >= 0) {
        compression.push(compressMs);
        decompression.push(decompressMs);
      }
    }
    result[codec] = {
      encodedBytes,
      compressionMs: Number(median(compression).toFixed(2)),
      decompressionMs: Number(median(decompression).toFixed(2)),
    };
  }
  return result;
}

// Probe the native API only. No added Brotli package, WASM codec or Node-only zlib path.
let nativeBrotli = false;
try {
  new CompressionStream('brotli' as CompressionFormat);
  new DecompressionStream('brotli' as CompressionFormat);
  nativeBrotli = true;
} catch {
  /* Missing Brotli is an expected runtime capability result. */
}

const fixtures = [
  ['tiny-empty', tinyCompressionFixture()],
  ['small-wallet', compressionWalletFixture(20, 3)],
  ['large-wallet', compressionWalletFixture(1000, 5)],
] as const;
console.log(
  JSON.stringify({
    runtime: process.version,
    platform: process.platform,
    arch: process.arch,
    warmups: 1,
    rounds,
    nativeBrotli,
    scope:
      'Node native Web API surrogate; excludes worker startup/cloning, browser storage, UI and fixture construction',
  }),
);
for (const [name, workspace] of fixtures) {
  if (!process.argv.includes('--codecs-only'))
    console.log(JSON.stringify(await benchmark(name, workspace)));
  if (name !== 'tiny-empty')
    console.log(JSON.stringify(await compareNativeCodecs(name, workspace)));
}
console.log(JSON.stringify({ name: 'incompressible-binary-codec-probe', ...(await codecProbe()) }));
