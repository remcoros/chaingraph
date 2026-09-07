import { describe, expect, it } from 'vitest';
import { base64 } from '@scure/base';
import { decryptWorkspace, encryptWorkspace, MAX_WORKSPACE_BYTES } from './crypto';

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
    for (const value of [0, -1, 1, 599999, 600001, 99999999999, '600000']) {
      await expect(decryptWorkspace({ ...envelope, iterations: value }, password)).rejects.toThrow(
        'Unsupported',
      );
    }
    await expect(decryptWorkspace({ ...envelope, version: 2 }, password)).rejects.toThrow(
      'Unsupported',
    );
    await expect(decryptWorkspace({ ...envelope, cipher: 'AES-CBC' }, password)).rejects.toThrow(
      'Unsupported',
    );
    await expect(decryptWorkspace({ ...envelope, extra: true }, password)).rejects.toThrow(
      'fields',
    );
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
