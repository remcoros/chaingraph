import type { TxOutput } from '../../types';

const typeNames: Record<string, string> = {
  pubkeyhash: 'P2PKH',
  scripthash: 'P2SH',
  witness_v0_keyhash: 'P2WPKH',
  witness_v0_scripthash: 'P2WSH',
  witness_v1_taproot: 'Taproot',
  pubkey: 'P2PK',
  multisig: 'bare multisig',
  anchor: 'anchor',
};

/** Recognize only exact standard locking-script templates, not wallet software
 * or hidden redeem/witness scripts. BIP141, BIP341 and Core's script solver.
 * Unknown/unsupported scripts stay unknown; contradictory type labels do too.
 */
export function analysisScriptType(output: TxOutput): string | undefined {
  const hex = output.scriptPubKey.hex?.toLowerCase();
  const reported = output.scriptPubKey.type;
  const decoded =
    hex === undefined
      ? undefined
      : /^76a914[0-9a-f]{40}88ac$/.test(hex)
        ? 'pubkeyhash'
        : /^a914[0-9a-f]{40}87$/.test(hex)
          ? 'scripthash'
          : /^0014[0-9a-f]{40}$/.test(hex)
            ? 'witness_v0_keyhash'
            : /^0020[0-9a-f]{64}$/.test(hex)
              ? 'witness_v0_scripthash'
              : /^5120[0-9a-f]{64}$/.test(hex)
                ? 'witness_v1_taproot'
                : undefined;
  if (decoded && reported && reported !== 'nonstandard' && decoded !== reported) return undefined;
  const type = decoded ?? reported;
  return type ? typeNames[type] : undefined;
}
