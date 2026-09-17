const errorMessages = {
  'unsupported-format':
    'Unsupported encrypted workspace format, compression or encryption settings. Use a compatible Chaingraph version; the original has not been changed.',
  'invalid-envelope': 'Invalid encrypted workspace fields or encoding.',
  'compression-unavailable':
    'This browser does not support workspace gzip compression. Use a browser with CompressionStream and DecompressionStream support; your saved workspace has not been changed.',
  'compression-failed': 'The compressed workspace is invalid or could not be processed.',
  'size-limit': 'Workspace exceeds the 32 MiB limit.',
  'unlock-failed': 'Unable to unlock workspace. The password is incorrect or the file was changed.',
  'invalid-payload': 'The decrypted workspace is not valid JSON.',
} as const;

export type WorkspaceCryptoErrorCode = keyof typeof errorMessages;

/** Only these fixed messages, never native errors or payloads, may cross a worker boundary. */
export class WorkspaceCryptoError extends Error {
  constructor(readonly code: WorkspaceCryptoErrorCode) {
    super(errorMessages[code]);
    this.name = 'WorkspaceCryptoError';
  }
}
