import { SUBMIT_PHOTOS_MAX_COUNT } from './lib/signingValidation.js'
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
  #status, #create-status { margin-top: 8px; font-size: 0.9rem; color: #8c7a72; }
  .field-label { display: block; max-width: 500px; font-size: 0.85rem; color: #8c7a72; margin-bottom: 4px; }
  .full-button { display: block; width: 100%; max-width: 500px; padding: 14px; }
  #create-entry { margin-bottom: 16px; }
  #create-back-link { display: inline-block; margin-bottom: 12px; color: #b85c6e; text-decoration: none; }
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
      <button id="create-entry" class="full-button" type="button">+ Cadastrar nova peça</button>
      <div class="product-list" id="product-list"></div>
    </div>
    <div id="create-screen" style="display:none">
      <a href="#" id="create-back-link">← Voltar</a>
      <h1>Cadastrar nova peça</h1>
      <label class="field-label" for="create-name">Nome</label>
      <input id="create-name" class="search-input" type="text" />
      <label class="field-label" for="create-category">Categoria</label>
      <input id="create-category" class="search-input" type="text" />
      <label class="field-label" for="create-size">Tamanho</label>
      <input id="create-size" class="search-input" type="text" />
      <label class="field-label" for="create-color">Cor</label>
      <input id="create-color" class="search-input" type="text" />
      <label class="field-label" for="create-rental-price">Preço do aluguel</label>
      <input id="create-rental-price" class="search-input" type="text" inputmode="numeric" />
      <label class="field-label" for="create-deposit">Caução</label>
      <input id="create-deposit" class="search-input" type="text" inputmode="numeric" />
      <button id="create-submit" class="primary full-button" type="button">Cadastrar e tirar fotos</button>
      <p id="create-status"></p>
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
      var createScreen = document.getElementById('create-screen');
      var createEntryBtn = document.getElementById('create-entry');
      var createBackLink = document.getElementById('create-back-link');
      var createSubmitBtn = document.getElementById('create-submit');
      var createStatus = document.getElementById('create-status');
      var createFields = {
        name: document.getElementById('create-name'),
        category: document.getElementById('create-category'),
        size: document.getElementById('create-size'),
        color: document.getElementById('create-color'),
      };
      var createRentalPrice = document.getElementById('create-rental-price');
      var createDeposit = document.getElementById('create-deposit');
      var CREATE_LABEL = 'Cadastrar e tirar fotos';
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

      // True from the first batch leaving until the queue drains or fails.
      // Batching turned the send into something with a MIDDLE, and the
      // controls that edit the queue were written when it had none.
      var isSending = false;

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
          removeBtn.disabled = isSending;
          removeBtn.addEventListener('click', function () {
            // splice() mutates the very array the in-flight send still holds
            // as its 'remaining', so removing a preview mid-send shifted the queue
            // under it and silently dropped an unsent photo.
            if (isSending) return;
            capturedPhotos.splice(index, 1);
            renderPreviews();
          });
          wrapper.appendChild(img);
          wrapper.appendChild(removeBtn);
          previews.appendChild(wrapper);
        });
        submitBtn.disabled = isSending || capturedPhotos.length === 0;
      }

      function addFiles(fileList) {
        var files = Array.prototype.slice.call(fileList);
        if (files.length === 0) return;
        statusEl.textContent = 'Processando fotos...';
        Promise.all(files.map(compress))
          .then(function (dataUrls) {
            capturedPhotos = capturedPhotos.concat(dataUrls);
            renderPreviews();
            statusEl.textContent = capturedPhotos.length + ' foto(s) pronta(s) para enviar.';
          })
          .catch(function () {
            // Without this, a single file the browser cannot decode left
            // "Processando fotos..." on screen forever, with no way to tell
            // that nothing was still happening.
            statusEl.textContent = 'Não foi possível abrir alguma das fotos. Escolha de novo.';
          });
      }

      function openCaptureScreen(product) {
        selectedProductId = product.id;
        captureTitle.textContent = product.name;
        capturedPhotos = [];
        renderPreviews();
        statusEl.textContent = '';
        pickerScreen.style.display = 'none';
        createScreen.style.display = 'none';
        captureScreen.style.display = 'block';
        stopPolling();
      }

      function openPickerScreen() {
        selectedProductId = null;
        capturedPhotos = [];
        renderPreviews();
        captureScreen.style.display = 'none';
        createScreen.style.display = 'none';
        pickerScreen.style.display = 'block';
        fetchProducts(searchInput.value);
        startPolling();
      }

      // Money is typed the same way as on the desktop: the keypad only ever
      // produces digits, which are read as centavos and divided by 100. The
      // API takes reais, so skipping this division would send every price in
      // at 100x.
      var moneyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

      function moneyValue(input) {
        var digits = input.value.replace(/[^0-9]/g, '');
        if (digits === '') return 0;
        return parseInt(digits, 10) / 100;
      }

      function bindMoneyInput(input) {
        input.value = moneyFormatter.format(0);
        input.addEventListener('input', function () {
          input.value = moneyFormatter.format(moneyValue(input));
        });
      }

      function openCreateScreen() {
        createStatus.textContent = '';
        createSubmitBtn.disabled = false;
        createSubmitBtn.textContent = CREATE_LABEL;
        Object.keys(createFields).forEach(function (key) {
          createFields[key].value = '';
        });
        createRentalPrice.value = moneyFormatter.format(0);
        createDeposit.value = moneyFormatter.format(0);
        pickerScreen.style.display = 'none';
        captureScreen.style.display = 'none';
        createScreen.style.display = 'block';
        stopPolling();
      }

      function submitCreate() {
        var payload = {
          name: createFields.name.value.trim(),
          category: createFields.category.value.trim(),
          size: createFields.size.value.trim(),
          color: createFields.color.value.trim(),
          rentalPrice: moneyValue(createRentalPrice),
          depositAmount: moneyValue(createDeposit),
        };
        if (!payload.name || !payload.category || !payload.size || !payload.color) {
          createStatus.textContent = 'Preencha nome, categoria, tamanho e cor.';
          return;
        }
        createSubmitBtn.disabled = true;
        createSubmitBtn.textContent = 'Cadastrando...';
        createStatus.textContent = '';
        fetch(basePath + '/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
          .then(function (response) {
            if (!response.ok) throw new Error('failed');
            return response.json();
          })
          .then(function (product) {
            createSubmitBtn.disabled = false;
            createSubmitBtn.textContent = CREATE_LABEL;
            // Straight into the capture screen for the piece just created —
            // the whole point of creating from the phone is to photograph it
            // right away, and the picker's 5s poll is too slow to rely on.
            openCaptureScreen(product);
          })
          .catch(function () {
            createStatus.textContent = 'Erro ao cadastrar. Tente novamente.';
            createSubmitBtn.disabled = false;
            createSubmitBtn.textContent = CREATE_LABEL;
          });
      }

      searchInput.addEventListener('input', function () {
        fetchProducts(searchInput.value);
      });

      createEntryBtn.addEventListener('click', openCreateScreen);

      createBackLink.addEventListener('click', function (event) {
        event.preventDefault();
        openPickerScreen();
      });

      createSubmitBtn.addEventListener('click', submitCreate);

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
        // Leaving mid-send used to null selectedProductId and empty the queue
        // while a batch was still in flight; its callback then posted the next
        // batch with productId: null (a 400, reported into a hidden status
        // line) and resurrected the emptied queue behind her.
        if (isSending) {
          statusEl.textContent = 'Aguarde o envio terminar.';
          return;
        }
        if (capturedPhotos.length > 0 && !confirm('Descartar as fotos ainda não enviadas?')) {
          return;
        }
        openPickerScreen();
      });

      // The submit route's own limits: submitPhotosSchema caps a batch at 10
      // photos, and express.json caps the whole body at 5 MB. The capture
      // screen never capped what could be picked, so a selection of 14 went in
      // one request, came back 400 (or 413), and showed "Erro ao enviar. Tente
      // novamente." — advice that could never work no matter how many times
      // she followed it. Splitting the queue into batches that fit is what the
      // desktop drawer's picker already does with its own limits.
      var SUBMIT_MAX_PHOTOS = ${SUBMIT_PHOTOS_MAX_COUNT};
      var SUBMIT_MAX_BODY_LENGTH = 3500000;

      function nextBatch(photos) {
        var batch = [];
        var length = 0;
        for (var i = 0; i < photos.length; i++) {
          if (batch.length >= SUBMIT_MAX_PHOTOS) break;
          if (batch.length > 0 && length + photos[i].length > SUBMIT_MAX_BODY_LENGTH) break;
          batch.push(photos[i]);
          length += photos[i].length;
        }
        return batch;
      }

      function sendBatches(remaining, sentCount) {
        isSending = true;
        submitBtn.disabled = true;
        if (remaining.length === 0) {
          isSending = false;
          statusEl.textContent = sentCount + ' foto(s) adicionada(s) ao produto.';
          capturedPhotos = [];
          renderPreviews();
          setTimeout(openPickerScreen, 2000);
          return;
        }
        var batch = nextBatch(remaining);
        var total = sentCount + remaining.length;
        statusEl.textContent =
          total > batch.length
            ? 'Enviando ' + (sentCount + batch.length) + ' de ' + total + '...'
            : 'Enviando...';
        fetch(basePath + '/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId: selectedProductId, photos: batch }),
        })
          .then(function (response) {
            if (!response.ok) {
              var rejection = new Error('rejected');
              // A 4xx is permanent for this payload; retrying it unchanged is
              // the one thing that cannot help.
              rejection.permanent = response.status >= 400 && response.status < 500;
              throw rejection;
            }
            // Only the photos this batch carried leave the queue, so a later
            // failure never discards ones already safely on the server.
            // slice() copies, so the next hop never shares an array with
            // anything the UI can still mutate.
            var stillQueued = remaining.slice(batch.length);
            capturedPhotos = stillQueued;
            renderPreviews();
            sendBatches(stillQueued, sentCount + batch.length);
          })
          .catch(function (error) {
            var message = error && error.permanent
              ? 'O servidor recusou estas fotos. Remova algumas com o ✕ e envie de novo.'
              : 'Falha na conexão. As fotos continuam aqui — toque em Enviar para tentar de novo.';
            statusEl.textContent =
              sentCount > 0 ? sentCount + ' foto(s) já foram salvas. ' + message : message;
            isSending = false;
            renderPreviews();
          });
      }

      submitBtn.addEventListener('click', function () {
        if (capturedPhotos.length === 0 || !selectedProductId) return;
        sendBatches(capturedPhotos, 0);
      });

      bindMoneyInput(createRentalPrice);
      bindMoneyInput(createDeposit);
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
