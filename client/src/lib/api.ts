import { getToken, setToken, clearToken, hashTokenForLog } from './auth.ts'

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

export interface ApiFetchOptions {
  // Suppresses the global 'auth:logout' side effect a 401 would otherwise
  // fire (see below). The login flow calls apiFetch itself while already on
  // /login and already handles its own failure locally (LoginPage's catch) —
  // letting a 401 there also dispatch 'auth:logout' fights that local
  // handling with an unrelated navigate()+cache-clear, which can visibly
  // reset the form (and swallow the error message the local catch was about
  // to show) before the user ever sees why.
  suppressAuthLogoutEvent?: boolean
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  options: ApiFetchOptions = {},
): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  // A rejected fetch means the app could not REACH its own server. On this
  // machine that is a local process which genuinely goes down, and it was
  // surfacing as the very same "Algo deu errado. Tente novamente." a typo
  // gets — the wrong advice for the most likely cause, identical to the
  // advice for the least likely. Given its own code, callers can say so.
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers })
  } catch (cause) {
    // Logged, not swallowed. Not every rejection here is the network: a token
    // containing a newline (getToken is an unvalidated localStorage read), an
    // invalid header, or an aborted request all land here too, and the
    // corrupted-token case is otherwise unrecoverable from inside the app —
    // clearToken() only runs on a 401 RESPONSE, which can never arrive. The
    // renderer console is captured into main.log, so this reaches the
    // diagnostics upload.
    console.error(`[client-api] request to ${path} could not be sent`, cause)
    throw new ApiError('NETWORK_ERROR', 0, 'Could not reach the server')
  }

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
      console.warn(
        `[client-auth] 401 on ${init.method ?? 'GET'} ${path} code=${body.code ?? 'n/a'}` +
          (token ? ` tokenHashSent=${await hashTokenForLog(token)}` : ' tokenHashSent=n/a'),
      )
      // Clear only if what is on disk still belongs to THIS request.
      //
      // Re-authentication can land between a request going out and its 401
      // coming back, and clearing unconditionally would wipe the FRESH token
      // on behalf of a dead one. That used to be unreachable — the tree
      // unmounted within a frame of the first 401, so nothing kept generating
      // them — but the re-auth dialog now keeps the app alive, and
      // useProductPhotoEvents retries its ticket POST every 5s for as long as
      // the dialog is open. The window is one round-trip wide, it recurs on
      // every attempt, and the symptom is the correct password being rejected.
      //
      // `renewedToken ?? token`, NOT `token`: this very response may have
      // renewed the token a few lines above, and that renewal is still this
      // request's own. Comparing against the pre-renewal value would leave it
      // in place — which is exactly the resurrection bug the renewal-on-401
      // test guards, and a session-bearing header replayed off a cached 304
      // is how that reached a real client once.
      if (getToken() === (renewedToken ?? token)) {
        clearToken()
      }
      if (!options.suppressAuthLogoutEvent) {
        window.dispatchEvent(new Event('auth:logout'))
      }
    }
    throw new ApiError(body.code ?? 'UNKNOWN', response.status, body.message ?? 'Request failed')
  }

  return body as T
}
