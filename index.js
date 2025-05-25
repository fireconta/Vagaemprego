let facePhotoFile, documentPhotoFile;
let objectURLs = [];
let faceApiLoaded = false;
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;

// Função para obter a base do caminho (resolve problemas em subdiretórios, ex.: GitHub Pages)
function getBasePath() {
  const base = window.location.pathname.split('/').slice(0, -1).join('/');
  return base ? `${base}/weights` : '/weights';
}

async function loadFaceApi(attempt = 1) {
  const loadingIndicator = document.createElement('div');
  loadingIndicator.className = 'model-loading';
  loadingIndicator.textContent = 'Carregando detector de rostos...';
  loadingIndicator.setAttribute('aria-live', 'polite');
  document.body.appendChild(loadingIndicator);

  try {
    // Tenta carregar os pesos localmente
    const localPath = getBasePath();
    console.log(`Tentando carregar pesos de: ${localPath}`);
    await faceapi.nets.tinyFaceDetector.loadFromUri(localPath);
    faceApiLoaded = true;
    console.log('face-api.js carregado com sucesso localmente');
    showToast('Detector de rostos pronto.', 'success');
    return true;
  } catch (localError) {
    console.error(`Tentativa ${attempt} falhou localmente:`, localError);

    // Se todas as tentativas locais falharem, tenta o CDN
    if (attempt >= MAX_RETRIES) {
      console.log('Tentando fallback para CDN...');
      try {
        await faceapi.nets.tinyFaceDetector.loadFromUri('https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights');
        faceApiLoaded = true;
        console.log('face-api.js carregado com sucesso via CDN');
        showToast('Detector de rostos carregado via fallback.', 'success');
        return true;
      } catch (cdnError) {
        console.error('Erro ao carregar via CDN:', cdnError);
        let errorMessage = 'Falha ao carregar o detector de rostos. Use a opção de upload.';
        if (cdnError.message.includes('404')) {
          errorMessage = 'Arquivos de modelo não encontrados. Verifique a pasta /weights ou a conexão.';
        } else if (cdnError.message.includes('CORS')) {
          errorMessage = 'Erro de CORS. Hospede o projeto em HTTPS.';
        } else if (cdnError.message.includes('network')) {
          errorMessage = 'Erro de rede. Verifique sua conexão e tente novamente.';
        }
        showToast(errorMessage, 'error');
        return false;
      }
    }

    // Retenta localmente
    showToast(`Tentativa ${attempt} de carregamento falhou. Retentando...`, 'error');
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    return loadFaceApi(attempt + 1);
  } finally {
    loadingIndicator.remove();
  }
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.getElementById('toastContainer').appendChild(toast);
  document.getElementById('liveRegion').textContent = message;
  setTimeout(() => toast.remove(), 3000);
}

function checkImageBrightness(canvas) {
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  let brightness = 0;
  for (let i = 0; i < data.length; i += 4) {
    brightness += (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }
  brightness /= (data.length / 4);
  return brightness > 80;
}

function resizeImage(videoElement, canvasElement, maxWidth = 1280) {
  const context = canvasElement.getContext('2d');
  const width = videoElement.videoWidth;
  const height = videoElement.videoHeight;
  let newWidth = width;
  let newHeight = height;

  if (width > maxWidth) {
    newWidth = maxWidth;
    newHeight = (height * maxWidth) / width;
  }

  canvasElement.width = newWidth;
  canvasElement.height = newHeight;
  context.drawImage(videoElement, 0, 0, newWidth, newHeight);
}

function validateFileSize(file, maxSizeMB = 5) {
  const maxSizeBytes = maxSizeMB * 1024 * 1024;
  return file.size <= maxSizeBytes;
}

async function validateFaceInImage(canvas) {
  try {
    const detections = await faceapi.detectSingleFace(canvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 128, scoreThreshold: 0.5 }));
    return !!detections;
  } catch (error) {
    console.error('Erro na validação de rosto:', error);
    return false;
  }
}

function cleanupObjectURLs() {
  objectURLs.forEach(url => URL.revokeObjectURL(url));
  objectURLs = [];
}

function checkFormValidity() {
  const fullName = document.getElementById('fullName').value.trim();
  const birthDate = document.getElementById('birthDate').value;
  const email = document.getElementById('email').value.trim();
  const resume = document.getElementById('resume').files[0];
  const documentPhoto = document.getElementById('documentPhoto').files[0] || documentPhotoFile;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const isValid = fullName && birthDate && email && emailRegex.test(email) && resume && facePhotoFile && documentPhoto;

  document.getElementById('submitButton').disabled = !isValid;
  document.getElementById('submitButton').classList.toggle('disabled-button', !isValid);
  
  document.getElementById('fullName').classList.toggle('error-field', !fullName);
  document.getElementById('birthDate').classList.toggle('error-field', !birthDate);
  document.getElementById('email').classList.toggle('error-field', !email || !emailRegex.test(email));
  document.getElementById('resume').classList.toggle('error-field', !resume);
  document.getElementById('facePhotoPreview').classList.toggle('error-field', !facePhotoFile);
  document.getElementById('documentPhotoPreview').classList.toggle('error-field', !documentPhoto);
}

document.getElementById('fullName').addEventListener('input', checkFormValidity);
document.getElementById('birthDate').addEventListener('input', checkFormValidity);
document.getElementById('email').addEventListener('input', checkFormValidity);
document.getElementById('resume').addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (file && !validateFileSize(file, 5)) {
    showToast('O currículo deve ter no máximo 5MB.', 'error');
    event.target.value = '';
  }
  checkFormValidity();
});
document.getElementById('documentPhoto').addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (file) {
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      showToast('A foto do documento deve ser JPEG ou PNG.', 'error');
      event.target.value = '';
    } else if (!validateFileSize(file, 5)) {
      showToast('A foto do documento deve ter no máximo 5MB.', 'error');
      event.target.value = '';
    } else {
      documentPhotoFile = file;
      cleanupObjectURLs();
      const url = URL.createObjectURL(file);
      objectURLs.push(url);
      document.getElementById('documentPhotoPreview').
