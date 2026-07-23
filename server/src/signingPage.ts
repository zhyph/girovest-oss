function invalidMessage(status: 'expired' | 'used' | 'not_found'): string {
  if (status === 'expired') return 'Este código expirou. Peça um novo código à loja.'
  if (status === 'used') return 'Este código já foi utilizado. Peça um novo código à loja.'
  return 'Código inválido. Peça um novo código à loja.'
}

const STYLES = `
  * { box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; margin: 0; padding: 24px 16px; background: #faf6f0; color: #362a28; }
  h1 { font-size: 1.25rem; margin: 0 0 16px; }
  canvas { touch-action: none; width: 100%; max-width: 500px; height: 200px; border: 1px solid #e9dcd3; border-radius: 8px; background: white; display: block; }
  .actions { display: flex; gap: 8px; margin-top: 12px; max-width: 500px; }
  button { flex: 1; padding: 12px; border-radius: 8px; border: 1px solid #e9dcd3; background: white; font-size: 1rem; }
  button.primary { background: #b85c6e; color: white; border-color: #b85c6e; }
  button:disabled { opacity: 0.5; }
  .message { padding: 16px; border-radius: 8px; background: white; border: 1px solid #e9dcd3; max-width: 500px; }
  #status { margin-top: 8px; font-size: 0.9rem; color: #8c7a72; }
`

function signingBody(): string {
  return `
    <h1>Assinatura do Contrato</h1>
    <canvas id="pad"></canvas>
    <div class="actions">
      <button id="clear" type="button">Limpar</button>
      <button id="submit" class="primary" type="button">Enviar</button>
    </div>
    <p id="status"></p>
    <script>
      var canvas = document.getElementById('pad');
      var ctx = canvas.getContext('2d');
      canvas.width = 600;
      canvas.height = 200;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#362a28';
      var drawing = false;
      var hasDrawn = false;

      function pos(e) {
        var rect = canvas.getBoundingClientRect();
        var scaleX = canvas.width / rect.width;
        var scaleY = canvas.height / rect.height;
        return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
      }

      canvas.addEventListener('pointerdown', function (e) {
        drawing = true;
        hasDrawn = true;
        var p = pos(e);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
      });
      canvas.addEventListener('pointermove', function (e) {
        if (!drawing) return;
        var p = pos(e);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      });
      window.addEventListener('pointerup', function () { drawing = false; });

      document.getElementById('clear').addEventListener('click', function () {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        hasDrawn = false;
      });

      document.getElementById('submit').addEventListener('click', function () {
        var statusEl = document.getElementById('status');
        var submitBtn = document.getElementById('submit');
        if (!hasDrawn) {
          statusEl.textContent = 'Assine antes de enviar.';
          return;
        }
        submitBtn.disabled = true;
        statusEl.textContent = 'Enviando...';
        var signatureImage = canvas.toDataURL('image/png');
        fetch(window.location.pathname + '/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ signatureImage: signatureImage }),
        })
          .then(function (response) {
            if (!response.ok) throw new Error('failed');
            document.body.innerHTML = '<div class="message"><p>Assinatura enviada! Pode devolver o aparelho à loja.</p></div>';
          })
          .catch(function () {
            statusEl.textContent = 'Erro ao enviar. Tente novamente.';
            submitBtn.disabled = false;
          });
      });
    </script>
  `
}

export function getSigningPageHtml(status: 'valid' | 'expired' | 'used' | 'not_found'): string {
  const body = status === 'valid' ? signingBody() : `<div class="message"><p>${invalidMessage(status)}</p></div>`

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Assinatura</title>
<style>${STYLES}</style>
</head>
<body>
${body}
</body>
</html>`
}
