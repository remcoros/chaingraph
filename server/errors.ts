export class SafeError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}
export const errorMessage = (error: unknown): string =>
  error instanceof SafeError ? error.message : 'Upstream request failed';
