import { HDKey, HARDENED_OFFSET } from '@scure/bip32';
import {
  parseExtendedPublicKey,
  derivePublicChild,
  outputScript,
  scriptHash,
  scriptToAddress,
  type Network,
  type ScriptType,
} from '../../Bitcoin/index';
import type { DerivedAddress } from './wallets';

function parseAccountKey(key: string, network: Network) {
  const parsed = parseExtendedPublicKey(key, network);
  if (parsed.node.depth !== 3 || parsed.node.index < HARDENED_OFFSET)
    throw new Error("Import an account-level public key at depth 3 (for example m/84'/0'/0').");
  return parsed;
}
export function inspectExtendedPublicKey(
  key: string,
  network: Network,
): { prefix: string; account: number; suggestedScriptType: ScriptType | undefined } {
  const { node, encoding } = parseAccountKey(key, network);
  return {
    prefix: encoding.prefix,
    account: node.index - HARDENED_OFFSET,
    suggestedScriptType: encoding.script,
  };
}

export function deriveAddresses(
  key: string,
  network: Network,
  scriptType: ScriptType,
  branch: 0 | 1,
  start: number,
  count: number,
): DerivedAddress[] {
  const { node, encoding } = parseAccountKey(key, network);
  if (!['p2pkh', 'p2sh-p2wpkh', 'p2wpkh', 'p2tr'].includes(scriptType))
    throw new Error('Choose an explicit wallet script type.');
  if (encoding.script && encoding.script !== scriptType)
    throw new Error(`${encoding.prefix} requires ${encoding.script}.`);
  if (
    (branch !== 0 && branch !== 1) ||
    !Number.isSafeInteger(start) ||
    start < 0 ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > 1000 ||
    start + count > HARDENED_OFFSET
  ) {
    throw new Error(
      'Derive 1–1000 non-hardened addresses from receive branch 0 or change branch 1.',
    );
  }
  return deriveRange(derivePublicChild(node, branch), network, scriptType, branch, start, count);
}

function deriveRange(
  parent: HDKey,
  network: Network,
  scriptType: ScriptType,
  branch: 0 | 1,
  start: number,
  count: number,
): DerivedAddress[] {
  const result: DerivedAddress[] = [];
  for (let index = start; index < start + count; index++) {
    const child = derivePublicChild(parent, index);
    const script = outputScript(child.publicKey!, scriptType);
    const address = scriptToAddress(script, network);
    if (!address) throw new Error('Derived public-key script has no address encoding.');
    result.push({
      address,
      scripthash: scriptHash(script),
      path: `account/${branch}/${index}`,
      index,
      branch,
    });
  }
  return result;
}

/** Verify imported ownership claims with work proportional to the supplied addresses,
 * never to the largest child index. Account and branch keys are parsed once. */
export function verifyDerivedAddresses(
  key: string,
  network: Network,
  scriptType: ScriptType,
  addresses: readonly DerivedAddress[],
): void {
  if (!Array.isArray(addresses) || addresses.length > 10000)
    throw new Error('Wallet address verification exceeds the import limit.');
  const { node, encoding } = parseAccountKey(key, network);
  if (!['p2pkh', 'p2sh-p2wpkh', 'p2wpkh', 'p2tr'].includes(scriptType))
    throw new Error('Choose an explicit wallet script type.');
  if (encoding.script && encoding.script !== scriptType)
    throw new Error(`${encoding.prefix} requires ${encoding.script}.`);
  const ordered = [...addresses].sort((a, b) => a.branch - b.branch || a.index - b.index);
  for (let i = 0; i < ordered.length; i++) {
    const item = ordered[i];
    if (
      (item.branch !== 0 && item.branch !== 1) ||
      !Number.isSafeInteger(item.index) ||
      item.index < 0 ||
      item.index >= HARDENED_OFFSET ||
      (i > 0 && item.branch === ordered[i - 1].branch && item.index === ordered[i - 1].index)
    )
      throw new Error('Invalid or duplicate wallet address derivation path.');
  }
  const parents = new Map<0 | 1, HDKey>();
  for (let start = 0; start < ordered.length;) {
    const first = ordered[start];
    let end = start + 1;
    while (
      end < ordered.length &&
      end - start < 1000 &&
      ordered[end].branch === first.branch &&
      ordered[end].index === first.index + end - start
    )
      end++;
    let parent = parents.get(first.branch);
    if (!parent) {
      parent = derivePublicChild(node, first.branch);
      parents.set(first.branch, parent);
    }
    const expected = deriveRange(
      parent,
      network,
      scriptType,
      first.branch,
      first.index,
      end - start,
    );
    for (let offset = 0; offset < expected.length; offset++) {
      const actual = ordered[start + offset],
        derived = expected[offset];
      if (
        actual.address !== derived.address ||
        actual.scripthash !== derived.scripthash ||
        actual.path !== derived.path
      )
        throw new Error(
          'Wallet address does not match its recorded public key and derivation path.',
        );
    }
    start = end;
  }
}
