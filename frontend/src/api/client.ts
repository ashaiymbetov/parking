export class ApiError extends Error {
  readonly status: number
  readonly code: string | undefined

  constructor(status: number, body: unknown) {
    const b = (body ?? {}) as { code?: string; message?: string }
    super(b.message ?? `HTTP ${status}`)
    this.status = status
    this.code = b.code
  }
}

let token: string | null = null
let onUnauthorized: (() => void) | null = null

export function setApiToken(value: string | null, onExpired?: () => void): void {
  token = value
  onUnauthorized = onExpired ?? null
}

/** Calls the backend via the same origin: Vite proxy in dev, nginx in Docker. */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
  const body: unknown = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized?.()
    throw new ApiError(res.status, body)
  }
  return body as T
}
