import type { ActivationState } from './activation.ts'

/**
 * The screen shown instead of the app when the installation is not released yet.
 *
 * Built as an inline string rather than a file on disk: electron-builder only
 * ships `out/**` plus package.json, so a separate .html would need its own entry
 * in the files list, and the one thing that must never fail to load is the
 * screen that explains why nothing else loaded.
 *
 * Text is pt-BR because the reader is the shop owner, not a developer.
 */

const STYLE = `
  :root { color-scheme: light dark; --bg:#fff; --fg:#111; --muted:#666; --line:#ddd; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#151515; --fg:#eee; --muted:#9a9a9a; --line:#333; }
  }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:32px;
         background:var(--bg); color:var(--fg);
         font:16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width:520px; text-align:center; }
  h1 { font-size:22px; margin:0 0 12px; }
  p { color:var(--muted); margin:0 0 20px; }
  .code { font:700 40px/1.1 ui-monospace, SFMono-Regular, Menlo, monospace;
          letter-spacing:6px; padding:20px; border:2px dashed var(--line);
          border-radius:12px; margin:0 0 20px; user-select:all; }
  button { font:inherit; font-weight:600; padding:12px 24px; border:0; border-radius:8px;
           background:#1a7f37; color:#fff; cursor:pointer; min-height:48px; }
  button:disabled { opacity:.55; cursor:default; }
  .hint { font-size:13px; margin-top:24px; }
`

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  )
}

/** Human-readable reason for a definitive refusal. */
function refusalText(reason: string): string {
  if (reason === 'machine_mismatch') {
    return 'Esta licença já está vinculada a outro computador. Fale com o suporte para liberar este.'
  }
  if (reason === 'revoked') {
    return 'Esta instalação foi bloqueada. Fale com o suporte.'
  }
  return 'Não foi possível liberar esta instalação. Fale com o suporte.'
}

export function activationScreenHtml(state: ActivationState, supportContact: string): string {
  let title: string
  let body: string
  let code = ''
  let retry = true

  if (state.state === 'pending') {
    title = 'Aguardando liberação'
    body = 'Informe o código abaixo ao suporte para liberar este computador.'
    code = state.code
  } else if (state.state === 'refused') {
    title = 'Instalação não liberada'
    body = refusalText(state.reason)
    // A refusal will not change by pressing a button, but reactivation after the
    // shop calls support does happen. Keeping the button avoids a dead end that
    // forces a restart.
    retry = true
  } else {
    title = 'Sem conexão'
    body =
      'Não foi possível verificar a liberação deste computador. Verifique a internet e tente novamente.'
  }

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>Girovest</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(body)}</p>
  ${code ? `<div class="code">${escapeHtml(code)}</div>` : ''}
  ${retry ? '<button id="retry">Tentar novamente</button>' : ''}
  <p class="hint">Suporte: ${escapeHtml(supportContact)}</p>
</main>
<script>
  const button = document.getElementById('retry');
  if (button) button.onclick = () => {
    button.disabled = true;
    button.textContent = 'Verificando...';
    // The preload bridge is the only channel here: this window intentionally has
    // no network access of its own (see the CSP above).
    window.girovest?.retryActivation?.();
  };
</script>
</body>
</html>`
}
