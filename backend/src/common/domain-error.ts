/**
 * An expected, user-facing failure. Rendered by AllExceptionsFilter as
 * `{ code, message, ...extra }` with the given HTTP status.
 */
export class DomainError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
