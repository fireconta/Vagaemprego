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
      document.getElementById('documentPhotoPreview').src = url;
      document.getElementById('documentPhotoPreview').classList.remove('hidden');
    }
  }
  checkFormValidity();
});
document.getElementById('uploadFacePhoto').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (file) {
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      showToast('A foto do rosto deve ser JPEG ou PNG.', 'error');
      event.target.value = '';
    } else if (!validateFileSize(file, 5)) {
      showToast('A foto do rosto deve ter no máximo 5MB.', 'error');
      event.target.value = '';
    } else {
      const img = new Image();
      img.src = URL.createObjectURL(file);
      await new Promise(resolve => img.onload = resolve);
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext('2d').drawImage(img, 0, 0);
      if (faceApiLoaded && !(await validateFaceInImage(canvas))) {
        showToast('Nenhum rosto detectado na imagem enviada.', 'error');
        event.target.value = '';
        URL.revokeObjectURL(img.src);
      } else {
        facePhotoFile = file;
        cleanupObjectURLs();
        const url = URL.createObjectURL(file);
        objectURLs.push(url);
        document.getElementById('facePhotoPreview').src = url;
        document.getElementById('facePhotoPreview').classList.remove('hidden');
      }
    }
  }
  checkFormValidity();
});

async function checkCameraSupport() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return false;
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some(device => device.kind === 'videoinput');
  } catch (error) {
    console.error('Erro ao verificar câmeras:', error);
    return false;
  }
}

function playAudioInstructions() {
  const instructions = 'Posicione seu rosto dentro do oval maior na tela, em um ambiente bem iluminado, sem óculos ou acessórios que cubram o rosto. Quando o oval ficar verde, clique no botão redondo para iniciar a contagem regressiva e capturar.';
  const utterance = new SpeechSynthesisUtterance(instructions);
  utterance.lang = 'pt-BR';
  window.speechSynthesis.speak(utterance);
}

async function startFaceCapture(videoElement, canvasElement, buttonElement, previewElement, fileSetter) {
  if (!(await checkCameraSupport())) {
    showToast('Seu dispositivo não suporta acesso à câmera. Use a opção de upload.', 'error');
    return;
  }

  if (!faceApiLoaded && !(await loadFaceApi())) {
    buttonElement.disabled = true;
    buttonElement.textContent = 'Captura Indisponível';
    buttonElement.classList.add('disabled-button');
    return;
  }

  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ 
      video: { 
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 720 }
      } 
    });
    videoElement.srcObject = stream;
    videoElement.classList.add('fullscreen-video');
    videoElement.classList.remove('hidden');

    const overlay = document.createElement('div');
    overlay.className = 'face-overlay';
    const oval = document.createElement('div');
    oval.className = 'face-oval';
    const instructions = document.createElement('div');
    instructions.className = 'face-instructions';
    instructions.textContent = 'Posicione seu rosto no oval maior';
    const feedback = document.createElement('div');
    feedback.className = 'face-feedback';
    feedback.setAttribute('aria-live', 'polite');
    const countdown = document.createElement('div');
    countdown.className = 'countdown';
    countdown.setAttribute('aria-live', 'polite');
    const audioButton = document.createElement('button');
    audioButton.className = 'audio-button';
    audioButton.innerHTML = '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707a1 1 0 011.414 0l4.707 4.707H20a1 1 0 011 1v4a1 1 0 01-1 1h-1.586l-4.707 4.707a1 1 0 01-1.414 0L5.586 15z"/></svg>';
    audioButton.setAttribute('aria-label', 'Tocar instruções de áudio');
    audioButton.onclick = playAudioInstructions;
    overlay.appendChild(oval);
    overlay.appendChild(instructions);
    overlay.appendChild(feedback);
    overlay.appendChild(countdown);
    overlay.appendChild(audioButton);
    document.body.appendChild(overlay);

    function updateOvalPosition() {
      const videoRect = videoElement.getBoundingClientRect();
      const isMobile = window.innerWidth <= 640;
      const ovalWidth = Math.min(videoRect.width * (isMobile ? 0.6 : 0.7), isMobile ? 400 : 600);
      const ovalHeight = ovalWidth * 1.3;
      oval.style.width = `${ovalWidth}px`;
      oval.style.height = `${ovalHeight}px`;
      oval.style.left = `${videoRect.left + videoRect.width / 2 - ovalWidth / 2}px`;
      oval.style.top = `${videoRect.top + videoRect.height / 2 - ovalHeight / 2}px`;
    }
    updateOvalPosition();
    window.addEventListener('resize', updateOvalPosition);

    let faceDetected = false;
    let detectionTimeout = null;
    async function detectFace() {
      if (!videoElement.srcObject) return;
      try {
        const detections = await faceapi.detectSingleFace(videoElement, new faceapi.TinyFaceDetectorOptions({ 
          inputSize: 128, 
          scoreThreshold: 0.5 
        }));

        if (detections) {
          const box = detections.detection.box;
          const videoRect = videoElement.getBoundingClientRect();
          const ovalRect = oval.getBoundingClientRect();
          const isCentered = box.x > ovalRect.left - 150 && box.x + box.width < ovalRect.right + 150 &&
                            box.y > ovalRect.top - 150 && box.y + box.height < ovalRect.bottom + 150;
          const isLargeEnough = box.width > ovalRect.width * 0.2 && box.height > ovalRect.height * 0.2;

          if (isCentered && isLargeEnough && checkImageBrightness(canvasElement)) {
            faceDetected = true;
            oval.style.borderColor = '#10b981';
            feedback.textContent = 'Rosto detectado! Clique para capturar.';
          } else {
            faceDetected = false;
            oval.style.borderColor = '#ef4444';
            feedback.textContent = !isCentered ? 'Centralize seu rosto no oval.' : 
                                  !isLargeEnough ? 'Aproxime o rosto do oval.' : 
                                  'Ambiente muito escuro.';
          }
        } else {
          faceDetected = false;
          oval.style.borderColor = '#ef4444';
          feedback.textContent = 'Nenhum rosto detectado. Posicione seu rosto no oval.';
        }
      } catch (error) {
        console.error('Erro na detecção de rosto:', error);
        faceDetected = false;
        oval.style.borderColor = '#ef4444';
        feedback.textContent = 'Erro na detecção. Posicione seu rosto no oval.';
      }

      if (videoElement.srcObject) {
        detectionTimeout = setTimeout(detectFace, 200);
      }
    }
    videoElement.addEventListener('play', () => {
      resizeImage(videoElement, canvasElement);
      detectFace();
    });

    const captureButton = document.createElement('button');
    captureButton.className = 'capture-button';
    captureButton.setAttribute('aria-label', 'Capturar foto');
    document.body.appendChild(captureButton);

    captureButton.onclick = () => {
      if (!faceDetected) {
        showToast('Posicione seu rosto corretamente no oval.', 'error');
        return;
      }

      captureButton.classList.add('enabled');
      let count = 3;
      countdown.textContent = count;
      const countdownInterval = setInterval(() => {
        count--;
        if (count > 0) {
          countdown.textContent = count;
          document.getElementById('liveRegion').textContent = `Capturando em ${count}`;
        } else {
          clearInterval(countdownInterval);
          countdown.textContent = '';
          document.getElementById('liveRegion').textContent = 'Foto capturada';
          captureButton.classList.remove('enabled');

          resizeImage(videoElement, canvasElement, 1280);
          
          canvasElement.toBlob(async (blob) => {
            if (!validateFileSize(blob, 5)) {
              showToast('A foto do rosto é muito grande. Tente novamente.', 'error');
              cleanupResources();
              return;
            }

            if (!(await validateFaceInImage(canvasElement))) {
              showToast('Nenhum rosto detectado na foto capturada. Tente novamente.', 'error');
              cleanupResources();
              return;
            }

            const url = URL.createObjectURL(blob);
            objectURLs.push(url);
            const modal = document.createElement('div');
            modal.className = 'confirmation-modal';
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-labelledby', 'modal-title');
            modal.innerHTML = `
              <h2 id="modal-title" class="sr-only">Confirmar Foto do Rosto</h2>
              <img src="${url}" alt="Foto capturada" tabindex="0">
              <button class="close" aria-label="Fechar modal">×</button>
              <div class="buttons">
                <button class="retry" tabindex="0">Tentar Novamente</button>
                <button class="confirm" tabindex="0">Confirmar</button>
              </div>
            `;
            document.body.appendChild(modal);

            const retryButton = modal.querySelector('.retry');
            const confirmButton = modal.querySelector('.confirm');
            const closeButton = modal.querySelector('.close');
            const img = modal.querySelector('img');
            img.focus();

            img.addEventListener('keydown', (e) => {
              if (e.key === 'Enter' || e.key === ' ') confirmButton.click();
              if (e.key === 'Escape') closeButton.click();
            });
            retryButton.addEventListener('keydown', (e) => {
              if (e.key === 'Enter' || e.key === ' ') retryButton.click();
            });
            confirmButton.addEventListener('keydown', (e) => {
              if (e.key === 'Enter' || e.key === ' ') confirmButton.click();
            });
            closeButton.addEventListener('keydown', (e) => {
              if (e.key === 'Enter' || e.key === ' ') closeButton.click();
            });

            img.addEventListener('click', () => {
              img.classList.toggle('zoomed');
            });

            function cleanupResources() {
              stream.getTracks().forEach(track => track.stop());
              videoElement.srcObject = null;
              videoElement.classList.add('hidden');
              videoElement.classList.remove('fullscreen-video');
              captureButton.remove();
              overlay.remove();
              modal.remove();
              clearTimeout(detectionTimeout);
              window.removeEventListener('resize', updateOvalPosition);
            }

            retryButton.onclick = () => {
              cleanupResources();
              cleanupObjectURLs();
            };
            confirmButton.onclick = () => {
              const file = new File([blob], 'face-photo.jpg', { type: 'image/jpeg' });
              fileSetter.value = file;
              cleanupObjectURLs();
              const newUrl = URL.createObjectURL(file);
              objectURLs.push(newUrl);
              previewElement.src = newUrl;
              previewElement.classList.remove('hidden');
              
              cleanupResources();
              buttonElement.textContent = 'Tirar Novamente';
              buttonElement.setAttribute('aria-label', 'Tirar nova foto');
              buttonElement.disabled = false;
              buttonElement.classList.remove('disabled-button');
              buttonElement.onclick = () => startFaceCapture(videoElement, canvasElement, buttonElement, previewElement, fileSetter);
              
              checkFormValidity();
            };
            closeButton.onclick = () => {
              cleanupResources();
              cleanupObjectURLs();
            };
          }, 'image/jpeg', 0.95);
        }
      }, 1000);
    };
  } catch (error) {
    let message = 'Erro ao acessar a câmera. Verifique as permissões ou use a opção de upload.';
    if (error.name === 'NotAllowedError') {
      message = 'Permissão de câmera negada. Habilite a câmera nas configurações do navegador.';
    } else if (error.name === 'NotFoundError') {
      message = 'Nenhuma câmera encontrada. Use a opção de upload.';
    } else if (error.name === 'OverconstrainedError') {
      message = 'Câmera frontal não disponível. Tente usar a opção de upload.';
    }
    showToast(message, 'error');
    console.error('Erro na câmera:', error);
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      videoElement.srcObject = null;
    }
    buttonElement.disabled = false;
    buttonElement.classList.remove('disabled-button');
  }
}

document.getElementById('captureFacePhoto').addEventListener('click', () => {
  document.getElementById('captureFacePhoto').disabled = true;
  document.getElementById('captureFacePhoto').classList.add('disabled-button');
  startFaceCapture(
    document.getElementById('faceVideo'),
    document.getElementById('faceCanvas'),
    document.getElementById('captureFacePhoto'),
    document.getElementById('facePhotoPreview'),
    { name: 'face-photo', value: null, set value(file) { facePhotoFile = file; } }
  );
});

async function startDocumentCapture(videoElement, canvasElement, buttonElement, previewElement, fileSetter) {
  if (!(await checkCameraSupport())) {
    showToast('Seu dispositivo não suporta acesso à câmera.', 'error');
    return;
  }

  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    videoElement.srcObject = stream;
    videoElement.classList.add('fullscreen-video');
    videoElement.classList.remove('hidden');
    
    const captureButton = document.createElement('button');
    captureButton.className = 'capture-button';
    captureButton.setAttribute('aria-label', 'Capturar foto');
    document.body.appendChild(captureButton);

    captureButton.onclick = () => {
      resizeImage(videoElement, canvasElement, 1280);
      
      canvasElement.toBlob((blob) => {
        if (!validateFileSize(blob, 5)) {
          showToast('A foto do documento é muito grande. Tente novamente.', 'error');
          return;
        }

        const file = new File([blob], 'document-photo.jpg', { type: 'image/jpeg' });
        fileSetter.value = file;
        cleanupObjectURLs();
        const url = URL.createObjectURL(file);
        objectURLs.push(url);
        previewElement.src = url;
        previewElement.classList.remove('hidden');
        
        stream.getTracks().forEach(track => track.stop());
        videoElement.srcObject = null;
        videoElement.classList.add('hidden');
        videoElement.classList.remove('fullscreen-video');
        captureButton.remove();
        buttonElement.textContent = 'Tirar Novamente';
        buttonElement.setAttribute('aria-label', 'Tirar nova foto');
        buttonElement.onclick = () => startDocumentCapture(videoElement, canvasElement, buttonElement, previewElement, fileSetter);
        
        checkFormValidity();
      }, 'image/jpeg', 0.95);
    };
  } catch (error) {
    let message = 'Erro ao acessar a câmera. Verifique as permissões ou use um dispositivo com câmera.';
    if (error.name === 'NotAllowedError') {
      message = 'Permissão de câmera negada. Habilite a câmera nas configurações do navegador.';
    } else if (error.name === 'NotFoundError') {
      message = 'Nenhuma câmera encontrada. Use a opção de upload.';
    } else if (error.name === 'OverconstrainedError') {
      message = 'Câmera traseira não disponível. Tente usar a opção de upload.';
    }
    showToast(message, 'error');
    console.error('Erro na câmera:', error);
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      videoElement.srcObject = null;
    }
  }
}

document.getElementById('captureDocumentPhoto').addEventListener('click', () => {
  startDocumentCapture(
    document.getElementById('documentVideo'),
    document.getElementById('documentCanvas'),
    document.getElementById('captureDocumentPhoto'),
    document.getElementById('documentPhotoPreview'),
    { name: 'document-photo', value: null, set value(file) { documentPhotoFile = file; } }
  );
});

function showFullscreenPreview(src) {
  const preview = document.createElement('div');
  preview.className = 'fullscreen-preview';
  preview.innerHTML = `
    <img src="${src}" alt="Pré-visualização em tela cheia">
    <button aria-label="Fechar visualização">×</button>
  `;
  document.body.appendChild(preview);
  preview.querySelector('button').onclick = () => {
    preview.remove();
    cleanupObjectURLs();
  };
}

document.querySelectorAll('.captured-image').forEach(img => {
  img.addEventListener('click', () => {
    if (img.src) showFullscreenPreview(img.src);
  });
});

document.getElementById('clearForm').addEventListener('click', () => {
  document.getElementById('jobForm').reset();
  facePhotoFile = documentPhotoFile = null;
  document.querySelectorAll('img.captured-image').forEach(img => {
    img.src = '';
    img.classList.add('hidden');
  });
  document.querySelectorAll('button[id^="capture"]').forEach(btn => {
    btn.textContent = 'Iniciar Captura';
    btn.setAttribute('aria-label', 'Iniciar captura de foto');
    btn.disabled = false;
    btn.classList.remove('disabled-button');
  });
  document.querySelectorAll('input, img.captured-image').forEach(el => el.classList.remove('error-field'));
  cleanupObjectURLs();
  checkFormValidity();
  showToast('Formulário limpo.', 'success');
});

document.getElementById('toggleHelp').addEventListener('click', () => {
  const helpSection = document.getElementById('helpSection');
  const isExpanded = helpSection.classList.toggle('collapsed');
  document.getElementById('toggleHelp').setAttribute('aria-expanded', !isExpanded);
  document.getElementById('liveRegion').textContent = isExpanded ? 'Seção de ajuda colapsada' : 'Seção de ajuda expandida';
});

document.getElementById('jobForm').addEventListener('submit', async function(event) {
  event.preventDefault();
  
  if (!confirm('Deseja enviar o formulário? Verifique todos os dados e fotos antes de confirmar.')) {
    return;
  }

  const submitButton = document.getElementById('submitButton');
  const progressBar = document.getElementById('progressBar');
  const progress = document.getElementById('progress');
  submitButton.classList.add('loading');
  submitButton.disabled = true;
  progressBar.style.display = 'block';
  progress.style.width = '0%';

  const fullName = document.getElementById('fullName').value.trim();
  const birthDate = document.getElementById('birthDate').value;
  const email = document.getElementById('email').value.trim();
  const resume = document.getElementById('resume').files[0];
  const documentPhoto = document.getElementById('documentPhoto').files[0] || documentPhotoFile;
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!fullName || !birthDate || !email || !emailRegex.test(email) || !resume || !facePhotoFile || !documentPhoto) {
    showToast('Por favor, preencha todos os campos e capture/upload todas as fotos.', 'error');
    submitButton.classList.remove('loading');
    submitButton.disabled = false;
    progressBar.style.display = 'none';
    return;
  }

  const toBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });

  try {
    progress.style.width = '25%';
    const facePhotoBase64 = await toBase64(facePhotoFile);
    progress.style.width = '50%';
    const documentPhotoBase64 = await toBase64(documentPhoto);
    progress.style.width = '75%';
    const resumeBase64 = await toBase64(resume);

    const response = await fetch('https://script.google.com/macros/s/AKfycbz5r42BpMn1BMJvX6pOu5-Sic95ACv3Bwkzyl9uQ194RWhNUA1mcRUa5LHQVUeE4VNy/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName,
        birthDate,
        email,
        resume: resumeBase64,
        facePhoto: facePhotoBase64,
        documentPhoto: documentPhotoBase64,
        timestamp: new Date().toISOString()
      }),
      timeout: 30000
    });

    progress.style.width = '100%';
    const result = await response.json();
    if (result.status === 'success') {
      showToast('Cadastro enviado com sucesso!', 'success');
      
      document.getElementById('jobForm').reset();
      facePhotoFile = documentPhotoFile = null;
      document.querySelectorAll('img.captured-image').forEach(img => {
        img.src = '';
        img.classList.add('hidden');
      });
      document.querySelectorAll('button[id^="capture"]').forEach(btn => {
        btn.textContent = 'Iniciar Captura';
        btn.setAttribute('aria-label', 'Iniciar captura de foto');
        btn.disabled = false;
        btn.classList.remove('disabled-button');
      });
      document.querySelectorAll('input, img.captured-image').forEach(el => el.classList.remove('error-field'));
      cleanupObjectURLs();
    } else {
      throw new Error(result.message || 'Erro ao enviar os dados.');
    }
  } catch (error) {
    showToast(error.message.includes('timeout') ? 'Tempo de envio esgotado. Verifique sua conexão.' : 'Erro ao enviar os dados.', 'error');
    console.error('Erro na submissão:', error);
  } finally {
    submitButton.classList.remove('loading');
    progressBar.style.display = 'none';
    checkFormValidity();
  }
});
