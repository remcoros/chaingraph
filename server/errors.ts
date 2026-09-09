export class SafeError extends Error {
  constructor(
    message: string,
    public status = 502,
    public code?: 'network_not_configured' | 'core_prevout_unavailable',
  ) {
    super(message);
  }
}
export const errorMessage = (error: unknown): string =>
  error instanceof SafeError ? error.message : 'Upstream request failed';
