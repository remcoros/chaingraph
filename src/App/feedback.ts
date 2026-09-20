export type FeedbackKind = 'notice' | 'error';
export type FeedbackLifetime = 'timed' | 'persistent';

export interface Feedback {
  /** The complete safe message, used by assistive technology and native titles. */
  message: string;
  /** The compact value rendered in the status surface. */
  visibleMessage: string;
  kind: FeedbackKind;
  lifetime: FeedbackLifetime;
}

export interface FeedbackOptions {
  kind?: FeedbackKind;
  lifetime?: FeedbackLifetime;
}

export type FeedbackInput = string | Feedback | undefined;

const VISIBLE_BACKEND_ERROR_LIMIT = 120;
const ACCESSIBLE_BACKEND_ERROR_LIMIT = 1_000;
const ELLIPSIS = '…';

function truncate(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit - ELLIPSIS.length)}${ELLIPSIS}` : value;
}

/** Normal status feedback remains caller-authored and keeps its complete visible copy. */
export function createFeedback(message: string, options: FeedbackOptions = {}): Feedback {
  return {
    message,
    visibleMessage: message,
    kind: options.kind ?? 'notice',
    lifetime: options.lifetime ?? 'timed',
  };
}

/**
 * The backend has already supplied a safe public error payload. Normalize it once
 * before two compact status surfaces reuse the same feedback value.
 */
export function createBackendErrorFeedback(message: string): Feedback {
  const normalized = message.trim().replace(/\s+/g, ' ');
  const fullMessage = truncate(normalized, ACCESSIBLE_BACKEND_ERROR_LIMIT);
  return {
    message: fullMessage,
    visibleMessage: truncate(fullMessage, VISIBLE_BACKEND_ERROR_LIMIT),
    kind: 'error',
    lifetime: 'persistent',
  };
}
