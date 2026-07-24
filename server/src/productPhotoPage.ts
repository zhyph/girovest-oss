function invalidMessage(status: 'expired' | 'used' | 'not_found'): string {
  if (status === 'expired') return 'Este código expirou. Peça um novo código à loja.'
  if (status === 'used') return 'Este código já foi utilizado. Peça um novo código à loja.'
  return 'Código inválido. Peça um novo código à loja.'
}

const STYLES = `
  * { box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; margin: 0; padding: 24px 16px; background: #faf6f0; color: #362a28; }
  h1 { font-size: 1.25rem; margin: 0 0 16px; }
  .file-input { display: block; width: 100%; max-width: 500px; padding: 12px; border: 1px solid #e9dcd3; border-radius: 8px; background: white; }
  .previews { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; max-width: 500px; }
  .previews img { height: 72px; width: 72px; object-fit: cover; border-radius: 8px; border: 1px solid #e9dcd3; }
  .actions { display: flex; gap: 8px; margin-top: 12px; max-width: 500px; }
  button { flex: 1; padding: 12px; border-radius: 8px; border: 1px solid #e9dcd3; background: white; font-size: 1rem; }
  button.primary { background: #b85c6e; color: white; border-color: #b85c6e; }
  button:disabled { opacity: 0.5; }
  .message { padding: 16px; border-radius: 8px; background: white; border: 1px solid #e9dcd3; max-width: 500px; }
  #status { margin-top: 8px; font-size: 0.9rem; color: #8c7a72; }
`

const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.7

function photoIntakeBody(): string {
  return `
    <h1>Fotos do Produto</h1>
    <input id="file-input" class="file-input" type="file" accept="image/*" capture="environment" multiple />
    <div class="previews" id="previews"></div>
    <div class="actions">
      <button id="submit" class="primary" type="button" disabled>Enviar</button>
    </div>
    <p id="status"></p>
    <script>
      var fileInput = document.getElementById('file-input');
      var previews = document.getElementById('previews');
      var submitBtn = document.getElementById('submit');
      var statusEl = document.getElementById('status');
      var compressedPhotos = [];

      function compress(file) {
        return new Promise(function (resolve, reject) {
          var img = new Image();
          img.onload = function () {
            var scale = Math.min(1, ${MAX_DIMENSION} / Math.max(img.width, img.height));
            var canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', ${JPEG_QUALITY}));
          };
          img.onerror = reject;
          img.src = URL.createObjectURL(file);
        });
      }

      fileInput.addEventListener('change', function () {
        var files = Array.prototype.slice.call(fileInput.files);
        statusEl.textContent = 'Processando fotos...';
        Promise.all(files.map(compress)).then(function (dataUrls) {
          compressedPhotos = dataUrls;
          previews.innerHTML = '';
          dataUrls.forEach(function (dataUrl) {
            var img = document.createElement('img');
            img.src = dataUrl;
            previews.appendChild(img);
          });
          submitBtn.disabled = compressedPhotos.length === 0;
          statusEl.textContent = compressedPhotos.length + ' foto(s) pronta(s) para enviar.';
        });
      });

      submitBtn.addEventListener('click', function () {
        if (compressedPhotos.length === 0) return;
        submitBtn.disabled = true;
        statusEl.textContent = 'Enviando...';
        fetch(window.location.pathname + '/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ photos: compressedPhotos }),
        })
          .then(function (response) {
            if (!response.ok) throw new Error('failed');
            document.body.innerHTML = '<div class="message"><p>Fotos enviadas! Pode devolver o aparelho à loja.</p></div>';
          })
          .catch(function () {
            statusEl.textContent = 'Erro ao enviar. Tente novamente.';
            submitBtn.disabled = false;
          });
      });
    </script>
  `
}

export function getProductPhotoPageHtml(status: 'valid' | 'expired' | 'used' | 'not_found'): string {
  const body = status === 'valid' ? photoIntakeBody() : `<div class="message"><p>${invalidMessage(status)}</p></div>`

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Fotos do Produto</title>
<style>${STYLES}</style>
</head>
<body>
${body}
</body>
</html>`
}
