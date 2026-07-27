import { getToken, setToken, clearToken } from './auth.ts'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'

export class ApiError extends Error {
  code: string
  status: number

  constructor(code: string, status: number, message: string) {
    super(message)
    this.code = code
    this.status = status
  }
}

// Marker for requests the app issues on a timer with nobody behind them. The
// server skips sliding session renewal when it sees it, so a terminal left on a
// polling screen still reaches its idle expiry. It has to be declared here
// rather than derived from the URL server-side: GET /api/contracts/:id is the
// same URL whether a person opened a contract or SignRemotelyModal is polling
// it every 3 seconds — only the caller knows which.
export const BACKGROUND_REQUEST_HEADER = 'X-Background-Request'
export const BACKGROUND_REQUEST_INIT: RequestInit = {
  headers: { [BACKGROUND_REQUEST_HEADER]: '1' },
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers })

  // Sliding session renewal. The server re-issues the JWT on this header once
  // the presented one is past its half-life, so someone who keeps working is
  // never logged out mid-shift. Deliberately above the 204 early return —
  // otherwise every DELETE would silently drop its renewal.
  // No state update is needed: every token reader calls getToken() fresh, so
  // the swap is invisible and causes no re-render or refetch.
  // `.headers` is optional-chained because several test suites mock fetch with
  // a bare { ok, status, json } object.
  const renewedToken = response.headers?.get('X-Renewed-Token')
  if (renewedToken) {
    setToken(renewedToken)
  }

  if (response.status === 204) {
    return undefined as T
  }

  const body = await response.json()

  if (!response.ok) {
    if (response.status === 401) {
      clearToken()
      window.dispatchEvent(new Event('auth:logout'))
    }
    throw new ApiError(body.code ?? 'UNKNOWN', response.status, body.message ?? 'Request failed')
  }

  return body as T
}
