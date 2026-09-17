import { outputScriptAddress, outputScriptHash, type Network, type TxOutput } from '../../Bitcoin';

export type WalletOutputEvidence = Readonly<{ address?: string; scripthash?: string }>;
export type WalletOutputEvidenceResolver = (output: TxOutput | undefined) => WalletOutputEvidence;

/** Raw script bytes win over address text. Non-address scripts and malformed
 * claims cannot establish an external address or identify a controller. */
export function walletOutputEvidence(
  output: TxOutput | undefined,
  network: Network,
): { address?: string; scripthash?: string } {
  if (!output) return {};
  const scripthash = outputScriptHash(output, network);
  if (!scripthash) return {};
  const address = outputScriptAddress(output, network);
  return address ? { scripthash, address } : { scripthash };
}

/** Session-owned, snapshot-scoped decoding. Drop the resolver with its chain snapshot.
 * Cache raw scripts independently of conflicting address metadata. Address-only
 * claims keep their exact spelling so invalid mixed-case addresses cannot share
 * a successful decode. Neither amounts nor transaction identity enter this cache.
 */
export function createWalletOutputEvidenceResolver(network: Network): WalletOutputEvidenceResolver {
  const scripts = new Map<string, WalletOutputEvidence>();
  const addresses = new Map<string, WalletOutputEvidence>();
  const missing: WalletOutputEvidence = Object.freeze({});
  return (output) => {
    if (!output) return missing;
    const hex = output.scriptPubKey.hex;
    const reported =
      output.scriptPubKey.address ??
      (output.scriptPubKey.addresses?.length === 1 ? output.scriptPubKey.addresses[0] : undefined);
    const key = hex === undefined ? reported : hex.toLowerCase();
    if (key === undefined) return missing;
    const cache = hex === undefined ? addresses : scripts;
    const previous = cache.get(key);
    if (previous) return previous;
    const evidence = Object.freeze(walletOutputEvidence(output, network));
    cache.set(key, evidence);
    return evidence;
  };
}
