export class ApiError extends Error {
  readonly status: number
  readonly code: string | undefined

  constructor(status: number, body: unknown) {
    const b = (body ?? {}) as { code?: string; message?: string; details?: unknown }
    super(
      b.code === 'VALIDATION_FAILED' && Array.isArray(b.details) && b.details.length > 0
        ? `Проверьте поля: ${b.details.map((d) => explain(String(d))).join('; ')}`
        : (b.message ?? `HTTP ${status}`),
    )
    this.status = status
    this.code = b.code
  }
}

const FIELDS: Record<string, string> = {
  email: 'Email',
  password: 'Пароль',
  plate: 'Номер',
  carId: 'Машина',
  spotId: 'Место',
  from: 'Начало',
  to: 'Конец',
}

/** "password: password must be longer than or equal to 8 characters" → "Пароль — минимум 8 символов". */
function explain(detail: string): string {
  const [field, ...rest] = detail.split(': ')
  const text = rest.join(': ')
  const rules: [RegExp, (m: RegExpMatchArray) => string][] = [
    [/must be an email/, () => 'некорректный адрес'],
    [/longer than or equal to (\d+)/, (m) => `минимум ${m[1]} символов`],
    [/shorter than or equal to (\d+)/, (m) => `максимум ${m[1]} символов`],
    [/should not be empty|must be a string/, () => 'обязательное поле'],
    [/should not exist/, () => 'лишнее поле'],
    [/must be a UUID/, () => 'не выбрано'],
  ]
  const rule = rules.find(([re]) => re.test(text))
  const label = FIELDS[field] ?? field
  return `${label} — ${rule ? rule[1](text.match(rule[0])!) : text}`
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
