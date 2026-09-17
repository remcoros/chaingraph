/** Native outpoint identity, without any workspace or Graph prefix. */
export const outpointKey = (txid: string, vout: number) => `${txid}:${vout}`;
