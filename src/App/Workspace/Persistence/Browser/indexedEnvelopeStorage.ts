import type { EncryptedEnvelope } from '../Encryption/encryptedEnvelope';

export const ENVELOPE_DATABASE = 'chaingraph.encrypted-envelopes.v1';
const STORE = 'envelopes';
export interface EnvelopeStorage {
  read(reference: string): Promise<unknown>;
  /** Serializes a synchronous public-index check/write across browser contexts. */
  commitIndex(publish: () => void): Promise<void>;
  write(entries: readonly { reference: string; envelope: EncryptedEnvelope }[]): Promise<void>;
  remove(references: readonly string[]): Promise<void>;
}

/** Encrypted payloads only. A successful request is not a committed transaction. */
export function indexedEnvelopeStorage(factory: IDBFactory): EnvelopeStorage {
  const transaction = async <T>(
    mode: IDBTransactionMode,
    run: (
      store: IDBObjectStore,
      result: (value: T) => void,
      fail: (error: unknown) => void,
    ) => void,
  ): Promise<T> => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      let settled = false;
      const request = factory.open(ENVELOPE_DATABASE, 1);
      const timer = setTimeout(() => {
        settled = true;
        reject(
          new Error(
            'Encrypted browser storage did not open. Close other Chaingraph tabs and retry.',
          ),
        );
      }, 10000);
      const fail = () => {
        settled = true;
        clearTimeout(timer);
        reject(new Error('Encrypted browser storage is unavailable.'));
      };
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE))
          request.result.createObjectStore(STORE);
      };
      request.onerror = fail;
      request.onblocked = fail;
      request.onsuccess = () => {
        clearTimeout(timer);
        if (settled) request.result.close();
        else resolve(request.result);
      };
    });
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode, { durability: 'strict' });
        let value: T;
        tx.oncomplete = () => resolve(value);
        let operationError: unknown;
        tx.onabort = () =>
          reject(
            operationError ??
              new Error('Encrypted browser storage could not commit. Check available disk space.'),
          );
        tx.onerror = () => {}; // The following abort is the transaction's final result.
        try {
          run(
            tx.objectStore(STORE),
            (result) => {
              value = result;
            },
            (error) => {
              operationError = error;
              tx.abort();
            },
          );
        } catch (error) {
          tx.abort();
          reject(error);
        }
      });
    } finally {
      db.close();
    }
  };
  return {
    commitIndex: (publish) =>
      transaction<void>('readwrite', (store, _result, fail) => {
        // A request starts only after this readwrite transaction owns the store.
        // Keep publication synchronous: awaiting here would release the transaction.
        const request = store.get('__public_index_mutex__');
        request.onsuccess = () => {
          try {
            publish();
          } catch (error) {
            // Throwing from an event handler would obscure the actionable conflict.
            fail(error);
          }
        };
      }),
    read: (reference) =>
      transaction('readonly', (store, result) => {
        const request = store.get(reference);
        request.onsuccess = () => result(request.result);
      }),
    write: (entries) =>
      transaction<void>('readwrite', (store) => {
        for (const entry of entries) store.add(entry.envelope, entry.reference);
      }),
    remove: (references) =>
      transaction<void>('readwrite', (store) => {
        for (const reference of references) store.delete(reference);
      }),
  };
}
