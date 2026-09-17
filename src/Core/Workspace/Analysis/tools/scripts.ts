import { outputScriptType, type OutputScriptType, type TxOutput } from '../../../Bitcoin';

const typeNames: Record<OutputScriptType, string> = {
  pubkeyhash: 'P2PKH',
  scripthash: 'P2SH',
  witness_v0_keyhash: 'P2WPKH',
  witness_v0_scripthash: 'P2WSH',
  witness_v1_taproot: 'Taproot',
  pubkey: 'P2PK',
  multisig: 'bare multisig',
  anchor: 'anchor',
};

/** Analysis presentation only. Core Bitcoin owns raw-template recognition and report reconciliation. */
export function analysisScriptType(output: TxOutput): string | undefined {
  const type = outputScriptType(output);
  return type ? typeNames[type] : undefined;
}
