import { WorkspaceCryptoError } from './workspaceCodecError';
export const MAX_WORKSPACE_BYTES = 32 * 1024 * 1024;
export const MIN_COMPRESSION_BYTES = 1024;

export type WorkspaceCompression = 'none' | 'gzip';

function byteStream(
  bytes: Uint8Array<ArrayBuffer>,
  chunkSize: number,
): ReadableStream<Uint8Array<ArrayBuffer>> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
}

/** Check both APIs even for tiny saves: an unsupported browser must not silently downgrade. */
export function requireWorkspaceCompression(): void {
  if (typeof CompressionStream !== 'function' || typeof DecompressionStream !== 'function') {
    throw new WorkspaceCryptoError('compression-unavailable');
  }
  try {
    new CompressionStream('gzip');
    new DecompressionStream('gzip');
  } catch {
    throw new WorkspaceCryptoError('compression-unavailable');
  }
}

/** Count each output chunk before retaining it, cancelling as soon as the bound is exceeded. */
export async function readBoundedStream(
  stream: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > limit - length) {
        value.fill(0);
        throw new WorkspaceCryptoError('size-limit');
      }
      length += value.byteLength;
      chunks.push(value);
    }
    const result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  } finally {
    // Cancellation also stops native decompression from continuing after an expansion limit.
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
    for (const chunk of chunks) chunk.fill(0);
  }
}

export async function compressWorkspaceBytes(
  plaintext: Uint8Array<ArrayBuffer>,
): Promise<{ compression: WorkspaceCompression; bytes: Uint8Array<ArrayBuffer> }> {
  requireWorkspaceCompression();
  if (plaintext.byteLength < MIN_COMPRESSION_BYTES) {
    return { compression: 'none', bytes: plaintext };
  }
  try {
    // Once gzip reaches the input size it cannot win; cancel instead of retaining overhead.
    const bytes = await readBoundedStream(
      byteStream(plaintext, 16 * 1024).pipeThrough(new CompressionStream('gzip')),
      plaintext.byteLength - 1,
    );
    return { compression: 'gzip', bytes };
  } catch (error) {
    if (error instanceof WorkspaceCryptoError && error.code === 'size-limit') {
      return { compression: 'none', bytes: plaintext };
    }
    throw new WorkspaceCryptoError('compression-failed');
  }
}

/** Call only after AES-GCM authentication has succeeded. No unbounded arrayBuffer collector. */
export async function decompressWorkspaceBytes(
  authenticated: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof DecompressionStream !== 'function') {
    throw new WorkspaceCryptoError('compression-unavailable');
  }
  let decompressor: DecompressionStream;
  try {
    decompressor = new DecompressionStream('gzip');
  } catch {
    throw new WorkspaceCryptoError('compression-unavailable');
  }
  try {
    return await readBoundedStream(
      // Bound each native transform's input as well as the retained output. A single
      // large compressed chunk must not queue its entire expanded workspace at once.
      byteStream(authenticated, 1024).pipeThrough(decompressor),
      MAX_WORKSPACE_BYTES,
    );
  } catch (error) {
    if (error instanceof WorkspaceCryptoError) throw error;
    throw new WorkspaceCryptoError('compression-failed');
  }
}
