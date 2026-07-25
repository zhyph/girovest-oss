function invalidMessage(status: 'expired' | 'not_found'): string {
  if (status === 'expired') return 'Este código expirou. Peça um novo código à loja.'
  return 'Código inválido. Peça um novo código à loja.'
}

const STYLES = `
  * { box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; margin: 0; padding: 24px 16px; background: #faf6f0; color: #362a28; }
  h1 { font-size: 1.25rem; margin: 0 0 16px; }
  .file-input { display: block; width: 100%; max-width: 500px; padding: 12px; border: 1px solid #e9dcd3; border-radius: 8px; background: white; }
  .previews { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; max-width: 500px; }
  .previews .preview { position: relative; }
  .previews img { height: 72px; width: 72px; object-fit: cover; border-radius: 8px; border: 1px solid #e9dcd3; display: block; }
  .previews .remove { position: absolute; top: -6px; right: -6px; width: 22px; height: 22px; border-radius: 50%; border: 1px solid #e9dcd3; background: white; font-size: 0.75rem; line-height: 1; padding: 0; flex: none; }
  .actions { display: flex; gap: 8px; margin-top: 12px; max-width: 500px; }
  button { flex: 1; padding: 12px; border-radius: 8px; border: 1px solid #e9dcd3; background: white; font-size: 1rem; }
  button.primary { background: #b85c6e; color: white; border-color: #b85c6e; }
  button:disabled { opacity: 0.5; }
  .message { padding: 16px; border-radius: 8px; background: white; border: 1px solid #e9dcd3; max-width: 500px; }
  #status { margin-top: 8px; font-size: 0.9rem; color: #8c7a72; }
  .search-input { display: block; width: 100%; max-width: 500px; padding: 12px; border: 1px solid #e9dcd3; border-radius: 8px; background: white; margin-bottom: 12px; font-size: 1rem; }
  .product-list { display: flex; flex-direction: column; gap: 8px; max-width: 500px; }
  .product-row { text-align: left; padding: 12px; border-radius: 8px; border: 1px solid #e9dcd3; background: white; cursor: pointer; }
  .product-row .name { font-weight: 600; }
  .product-row .meta { font-size: 0.85rem; color: #8c7a72; margin-top: 2px; }
  .empty { color: #8c7a72; padding: 12px 0; }
  #back-link { display: inline-block; margin-bottom: 12px; color: #b85c6e; text-decoration: none; }
  .capture-primary { display: block; width: 100%; max-width: 500px; padding: 16px; font-size: 1.1rem; }
  .capture-secondary { display: block; margin-top: 12px; color: #8c7a72; font-size: 0.9rem; text-decoration: underline; }
`

const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.7

function photoIntakeBody(token: string): string {
  return `
    <div id="picker-screen">
      <h1>Selecione um produto</h1>
      <input id="search-input" class="search-input" type="text" placeholder="Buscar por nome, categoria ou cor..." />
      <div class="product-list" id="product-list"></div>
    </div>
    <div id="capture-screen" style="display:none">
      <a href="#" id="back-link">← Voltar</a>
      <h1 id="capture-title"></h1>
      <input id="camera-input" type="file" accept="image/*" capture="environment" style="display:none" />
      <button id="take-photo" class="primary capture-primary" type="button">📷 Tirar Foto</button>
      <input id="gallery-input" type="file" accept="image/*" multiple style="display:none" />
      <a href="#" id="gallery-link" class="capture-secondary">Escolher da Galeria</a>
      <div class="previews" id="previews"></div>
      <button id="submit" class="primary" type="button" disabled>Enviar</button>
      <p id="status"></p>
    </div>
    <script>
      var token = ${JSON.stringify(token)};
      var basePath = '/product-photos/' + token;
      var selectedProductId = null;
      var capturedPhotos = [];
      var pollHandle = null;

      var pickerScreen = document.getElementById('picker-screen');
      var captureScreen = document.getElementById('capture-screen');
      var searchInput = document.getElementById('search-input');
      var productList = document.getElementById('product-list');
      var backLink = document.getElementById('back-link');
      var captureTitle = document.getElementById('capture-title');
      var cameraInput = document.getElementById('camera-input');
      var takePhotoBtn = document.getElementById('take-photo');
      var galleryInput = document.getElementById('gallery-input');
      var galleryLink = document.getElementById('gallery-link');
      var previews = document.getElementById('previews');
      var submitBtn = document.getElementById('submit');
      var statusEl = document.getElementById('status');

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

      function renderProducts(products) {
        productList.innerHTML = '';
        if (products.length === 0) {
          var empty = document.createElement('p');
          empty.className = 'empty';
          empty.textContent = 'Nenhum produto encontrado.';
          productList.appendChild(empty);
          return;
        }
        products.forEach(function (product) {
          var row = document.createElement('button');
          row.type = 'button';
          row.className = 'product-row';
          var name = document.createElement('div');
          name.className = 'name';
          name.textContent = product.name;
          var meta = document.createElement('div');
          meta.className = 'meta';
          meta.textContent = [product.category, product.size, product.color].filter(Boolean).join(' · ');
          row.appendChild(name);
          row.appendChild(meta);
          row.addEventListener('click', function () {
            openCaptureScreen(product);
          });
          productList.appendChild(row);
        });
      }

      function fetchProducts(search) {
        var url = basePath + '/products' + (search ? '?search=' + encodeURIComponent(search) : '');
        fetch(url)
          .then(function (response) {
            if (!response.ok) throw new Error('failed');
            return response.json();
          })
          .then(renderProducts)
          .catch(function () {
            // Keep the previous list rendered rather than clearing it on a transient failure.
          });
      }

      function startPolling() {
        stopPolling();
        pollHandle = setInterval(function () {
          fetchProducts(searchInput.value);
        }, 5000);
      }

      function stopPolling() {
        if (pollHandle !== null) {
          clearInterval(pollHandle);
          pollHandle = null;
        }
      }

      function renderPreviews() {
        previews.innerHTML = '';
        capturedPhotos.forEach(function (dataUrl, index) {
          var wrapper = document.createElement('div');
          wrapper.className = 'preview';
          var img = document.createElement('img');
          img.src = dataUrl;
          var removeBtn = document.createElement('button');
          removeBtn.type = 'button';
          removeBtn.className = 'remove';
          removeBtn.textContent = '✕';
          removeBtn.addEventListener('click', function () {
            capturedPhotos.splice(index, 1);
            renderPreviews();
          });
          wrapper.appendChild(img);
          wrapper.appendChild(removeBtn);
          previews.appendChild(wrapper);
        });
        submitBtn.disabled = capturedPhotos.length === 0;
      }

      function addFiles(fileList) {
        var files = Array.prototype.slice.call(fileList);
        if (files.length === 0) return;
        statusEl.textContent = 'Processando fotos...';
        Promise.all(files.map(compress)).then(function (dataUrls) {
          capturedPhotos = capturedPhotos.concat(dataUrls);
          renderPreviews();
          statusEl.textContent = capturedPhotos.length + ' foto(s) pronta(s) para enviar.';
        });
      }

      function openCaptureScreen(product) {
        selectedProductId = product.id;
        captureTitle.textContent = product.name;
        capturedPhotos = [];
        renderPreviews();
        statusEl.textContent = '';
        pickerScreen.style.display = 'none';
        captureScreen.style.display = 'block';
        stopPolling();
      }

      function openPickerScreen() {
        selectedProductId = null;
        capturedPhotos = [];
        renderPreviews();
        captureScreen.style.display = 'none';
        pickerScreen.style.display = 'block';
        fetchProducts(searchInput.value);
        startPolling();
      }

      searchInput.addEventListener('input', function () {
        fetchProducts(searchInput.value);
      });

      takePhotoBtn.addEventListener('click', function () {
        cameraInput.click();
      });

      galleryLink.addEventListener('click', function (event) {
        event.preventDefault();
        galleryInput.click();
      });

      cameraInput.addEventListener('change', function () {
        addFiles(cameraInput.files);
        cameraInput.value = '';
      });

      galleryInput.addEventListener('change', function () {
        addFiles(galleryInput.files);
        galleryInput.value = '';
      });

      backLink.addEventListener('click', function (event) {
        event.preventDefault();
        if (capturedPhotos.length > 0 && !confirm('Descartar as fotos ainda não enviadas?')) {
          return;
        }
        openPickerScreen();
      });

      submitBtn.addEventListener('click', function () {
        if (capturedPhotos.length === 0 || !selectedProductId) return;
        submitBtn.disabled = true;
        statusEl.textContent = 'Enviando...';
        fetch(basePath + '/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId: selectedProductId, photos: capturedPhotos }),
        })
          .then(function (response) {
            if (!response.ok) throw new Error('failed');
            var count = capturedPhotos.length;
            statusEl.textContent = count + ' fotos adicionadas ao produto.';
            capturedPhotos = [];
            renderPreviews();
            setTimeout(openPickerScreen, 2000);
          })
          .catch(function () {
            statusEl.textContent = 'Erro ao enviar. Tente novamente.';
            submitBtn.disabled = false;
          });
      });

      fetchProducts('');
      startPolling();
    </script>
  `
}

export function getProductPhotoPageHtml(status: 'valid' | 'expired' | 'not_found', token: string): string {
  const body = status === 'valid' ? photoIntakeBody(token) : `<div class="message"><p>${invalidMessage(status)}</p></div>`

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
