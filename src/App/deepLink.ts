/** Reads a lookup reference from a #?s= fragment, ignoring in-app hash anchors. */
export function parseLookupFragment(hash: string): string | undefined {
  if (!hash.startsWith('#?')) return undefined;
  const params = new URLSearchParams(hash.slice(2));
  const value = params.get('s');
  if (value === null) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
