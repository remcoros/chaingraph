/** Maximum number of explicit targets that one connection scan may retain. */
export const MAX_CONNECTION_SCAN_TARGETS = 1000;

/** Whether an identifier names a transaction or outpoint that a scan can visit. */
export function isScanNodeId(id: string): boolean {
  return (
    /^tx:[0-9a-f]{64}$/.test(id) ||
    (/^out:[0-9a-f]{64}:(0|[1-9][0-9]*)$/.test(id) && Number(id.split(':')[2]) <= 0xffffffff)
  );
}
