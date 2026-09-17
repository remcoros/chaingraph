import type { SavedWorkspace } from '../savedWorkspace';
import {
  assertEnvelopeHeader,
  MAX_ENCRYPTED_FILE_BYTES,
  type EncryptedEnvelope,
} from '../Codec/encryptedEnvelope';
import { WorkspaceCryptoError } from '../Codec/workspaceCodecError';
import { operationError, operationErrorCode } from '../workspacePersistenceError';
import { indexedEnvelopeStorage, type EnvelopeStorage } from './indexedEnvelopeStorage';
export const INLINE_INDEX_LIMIT = 1024 * 1024;
export const STORAGE_KEY = 'chaingraph.encrypted-workspaces.v1';

/** Browser-private physical record for one public saved-workspace entry. */
interface BrowserSavedWorkspace extends SavedWorkspace {
  envelope?: EncryptedEnvelope;
  envelopeRef?: string;
}

export interface WorkspaceStorageOptions {
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  envelopes?: EnvelopeStorage;
}

function validEnvelope(value: unknown): value is EncryptedEnvelope {
  if (!value || typeof value !== 'object') return false;
  const envelope = value as EncryptedEnvelope;
  return !(
    Object.keys(envelope).sort().join(',') !==
      (envelope.version === 2
        ? 'cipher,ciphertext,compression,format,iterations,iv,kdf,salt,version'
        : 'cipher,ciphertext,format,iterations,iv,kdf,salt,version') ||
    envelope.format !== 'chaingraph-workspace' ||
    (envelope.version !== 1 && envelope.version !== 2) ||
    (envelope.version === 2 && !['none', 'gzip'].includes(envelope.compression)) ||
    envelope.cipher !== 'AES-256-GCM' ||
    envelope.kdf !== 'PBKDF2-SHA256' ||
    envelope.iterations !== 600000 ||
    typeof envelope.salt !== 'string' ||
    !/^[A-Za-z0-9+/]{22}==$/.test(envelope.salt) ||
    typeof envelope.iv !== 'string' ||
    !/^[A-Za-z0-9+/]{16}$/.test(envelope.iv) ||
    typeof envelope.ciphertext !== 'string' ||
    envelope.ciphertext.length < 24 ||
    envelope.ciphertext.length > MAX_ENCRYPTED_FILE_BYTES ||
    envelope.ciphertext.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(envelope.ciphertext)
  );
}

function parseSaved(raw: string | null): BrowserSavedWorkspace[] {
  if (raw === null) return [];
  const records: unknown = JSON.parse(raw);
  if (!Array.isArray(records) || records.length > 100)
    throw new Error('Invalid saved workspace index.');
  const ids = new Set<string>();
  for (const record of records) {
    const envelope = record?.envelope;
    if (envelope) assertEnvelopeHeader(envelope);
    if (
      !record ||
      typeof record.id !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(record.id) ||
      ids.has(record.id) ||
      (record.publicName !== undefined &&
        (typeof record.publicName !== 'string' ||
          !record.publicName.trim() ||
          record.publicName.length > 100)) ||
      typeof record.savedAt !== 'string' ||
      !Number.isFinite(Date.parse(record.savedAt)) ||
      (record.envelopeRef !== undefined
        ? typeof record.envelopeRef !== 'string' ||
          !/^indexeddb:[0-9a-f-]{36}$/i.test(record.envelopeRef) ||
          envelope !== undefined
        : !validEnvelope(envelope))
    ) {
      throw new Error('Invalid saved workspace index or encrypted envelope.');
    }
    ids.add(record.id);
  }
  return records as BrowserSavedWorkspace[];
}

/** Owns the public browser index, encrypted blobs and cross-tab publication. */
export class WorkspaceStorage {
  private storedRaw: string | null = null;
  private storageInvalid = false;
  private saved: BrowserSavedWorkspace[] = [];
  private envelopes?: EnvelopeStorage;
  readonly initialError: string;

  constructor(private readonly options: WorkspaceStorageOptions = {}) {
    this.envelopes = options.envelopes;
    if (!this.envelopes) {
      try {
        if (globalThis.indexedDB) this.envelopes = indexedEnvelopeStorage(globalThis.indexedDB);
      } catch {
        // Some restricted browser contexts disallow IndexedDB while allowing localStorage.
      }
    }
    let error = '';
    try {
      this.storedRaw = this.storage().getItem(STORAGE_KEY);
      this.saved = parseSaved(this.storedRaw);
    } catch (cause) {
      this.storageInvalid = true;
      error =
        cause instanceof WorkspaceCryptoError && cause.code === 'unsupported-format'
          ? operationError(cause.code).message
          : 'Saved workspace storage is unreadable or malformed. Existing data was preserved. Export any open workspace; repair or restore browser storage before saving.';
    }
    this.initialError = error;
  }

  getSaved = (): SavedWorkspace[] => this.publicSaved();

  private publicSaved(): SavedWorkspace[] {
    return this.saved.map(({ id, publicName, savedAt }) => ({ id, publicName, savedAt }));
  }

  private storage() {
    return this.options.storage ?? globalThis.localStorage;
  }

  assertCurrent(): void {
    if (this.storageInvalid)
      throw new Error('Saved storage is malformed or unavailable; it will not be overwritten.');
    if (this.storage().getItem(STORAGE_KEY) !== this.storedRaw)
      throw new Error(
        'Saved storage changed in another tab. Export your open workspace, then reload before saving.',
      );
  }

  async read(entry: SavedWorkspace, signal?: AbortSignal) {
    signal?.throwIfAborted();
    this.assertCurrent();
    const currentEntry = this.saved.find((candidate) => candidate.id === entry.id);
    if (
      !currentEntry ||
      currentEntry.publicName !== entry.publicName ||
      currentEntry.savedAt !== entry.savedAt
    )
      throw new Error('Saved workspace changed; reload before unlocking.');
    const indexAtStart = this.storedRaw;
    const envelope = currentEntry.envelopeRef
      ? await this.envelopes?.read(currentEntry.envelopeRef)
      : currentEntry.envelope;
    if (envelope) {
      try {
        assertEnvelopeHeader(envelope);
      } catch (error) {
        throw operationError(operationErrorCode(error));
      }
    }
    if (!validEnvelope(envelope))
      throw new Error(
        'Encrypted workspace data is missing or malformed. Restore an exported backup.',
      );
    const assertUnchanged = () => {
      signal?.throwIfAborted();
      this.assertCurrent();
      if (this.storedRaw !== indexAtStart || !this.saved.includes(currentEntry))
        throw new Error('Saved workspace changed; reload before unlocking.');
    };
    assertUnchanged();
    return { envelope, assertUnchanged };
  }

  async publishWorkspace(
    workspace: { id: string; name: string },
    envelope: EncryptedEnvelope,
  ): Promise<SavedWorkspace[]> {
    const commit = async (hasWebLock: boolean) => {
      this.assertCurrent();
      const entry = {
        id: workspace.id,
        publicName: workspace.name,
        savedAt: new Date().toISOString(),
        envelope,
      };
      const previous = this.saved;
      let saved = [entry, ...previous.filter((candidate) => candidate.id !== workspace.id)];
      if (saved.length > 100)
        throw new Error(
          'Browser storage supports at most 100 saved workspaces. Export this workspace to a file.',
        );
      saved = await this.publish(saved, hasWebLock);
      this.saved = saved;
      await this.cleanReplaced(previous, saved);
      return saved;
    };
    if (typeof navigator !== 'undefined' && navigator.locks)
      return navigator.locks.request(STORAGE_KEY, () => commit(true));
    return commit(false);
  }

  async remove(id: string, precondition?: () => void): Promise<SavedWorkspace[]> {
    const commit = async (hasWebLock: boolean) => {
      this.assertCurrent();
      precondition?.();
      const previous = this.saved;
      const saved = previous.filter((entry) => entry.id !== id);
      await this.commitIndex(JSON.stringify(saved), hasWebLock, precondition);
      this.saved = saved;
      await this.cleanReplaced(previous, saved);
      return saved;
    };
    if (typeof navigator !== 'undefined' && navigator.locks)
      await navigator.locks.request(STORAGE_KEY, () => commit(true));
    else await commit(false);
    return this.publicSaved();
  }

  private async commitIndex(raw: string, hasWebLock: boolean, precondition?: () => void) {
    let published = false;
    const publish = () => {
      this.assertCurrent();
      precondition?.();
      this.storage().setItem(STORAGE_KEY, raw);
      this.storedRaw = raw;
      published = true;
    };
    if (this.envelopes?.commitIndex) {
      // Use the same coordinator even when Web Locks is present, so a context
      // without Web Locks cannot race a context that has it.
      try {
        await this.envelopes.commitIndex(publish);
      } catch (error) {
        // localStorage publication is the commit point. An IDB mutex abort after
        // that point must not cause removal of ciphertext the index now references.
        if (!published) throw error;
      }
    } else if (hasWebLock) publish();
    else
      throw new Error(
        'This browser cannot coordinate encrypted saves. Enable browser storage or use a browser with Web Locks or IndexedDB support.',
      );
  }

  private async publish(
    saved: BrowserSavedWorkspace[],
    hasWebLock: boolean,
  ): Promise<BrowserSavedWorkspace[]> {
    this.assertCurrent();
    // Ciphertext is base64, so its string length is exact without serializing it.
    // Public metadata is bounded; 1 KiB per entry safely overestimates JSON escaping.
    const estimatedLength = saved.reduce(
      (length, entry) => length + (entry.envelope?.ciphertext.length ?? 0) + 1024,
      2,
    );
    const alreadyExternal = this.saved.some((entry) => entry.envelopeRef);
    if (estimatedLength <= INLINE_INDEX_LIMIT && !alreadyExternal) {
      try {
        await this.commitIndex(JSON.stringify(saved), hasWebLock);
        return saved;
      } catch (error) {
        if (
          !this.envelopes ||
          !(error instanceof DOMException) ||
          error.name !== 'QuotaExceededError'
        )
          throw error;
      }
    }
    if (!this.envelopes)
      throw new Error('Large encrypted workspaces require IndexedDB browser storage.');
    const blobs: { reference: string; envelope: EncryptedEnvelope }[] = [];
    const external = saved.map((entry) => {
      if (!entry.envelope) return entry;
      const reference = `indexeddb:${crypto.randomUUID()}`;
      blobs.push({ reference, envelope: entry.envelope });
      return {
        id: entry.id,
        publicName: entry.publicName,
        savedAt: entry.savedAt,
        envelopeRef: reference,
      };
    });
    try {
      await this.envelopes.write(blobs);
      // The index is the commit point. Immutable new blobs cannot replace another tab's data.
      await this.commitIndex(JSON.stringify(external), hasWebLock);
      return external;
    } catch (error) {
      await this.envelopes.remove(blobs.map((blob) => blob.reference)).catch(() => {});
      throw error;
    }
  }

  private async cleanReplaced(previous: BrowserSavedWorkspace[], next: BrowserSavedWorkspace[]) {
    const retained = new Set(next.map((entry) => entry.envelopeRef));
    const removed = previous.flatMap((entry) =>
      entry.envelopeRef && !retained.has(entry.envelopeRef) ? [entry.envelopeRef] : [],
    );
    if (removed.length) await this.envelopes?.remove(removed).catch(() => {});
  }
}
