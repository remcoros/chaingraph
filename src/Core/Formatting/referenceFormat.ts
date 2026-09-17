/** Shared reference display; canonical IDs and clipboard values stay complete.
 * Outpoint indices are separate from the transaction hash and never truncated. */
export const short = (value: string) => {
  const reference = value.replace(/^(?:tx|out|addr):/, '');
  const outpoint = /^([0-9a-f]{64}):(\d+)$/i.exec(reference);
  const identifier = outpoint?.[1] ?? reference;
  const abbreviated =
    identifier.length > 19 ? `${identifier.slice(0, 8)}...${identifier.slice(-8)}` : identifier;
  return `${abbreviated}${outpoint ? `:${outpoint[2]}` : ''}`;
};
