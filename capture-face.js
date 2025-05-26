document.addEventListener('DOMContentLoaded', () => {
  if (window.location.protocol !== 'https:') {
    console.error('Erro: HTTPS necessário para getUserMedia');
    showToast('Este aplicativo requer HTTPS. Use um servidor seguro.', 'error', false);
    updateDebugStatus('Erro: HTTPS necessário');
    return;
  }

  const faceVideo = document.getElementById('face-video');
  const faceCanvas = document.getElement('canvas');
  const faceOverlay = document.getElementById('face-overlay');
  const faceFeedback = document.getElementById('face-feedback');
  const confirmationModal = document.getElementById('confirmationModal');
  const confirmationImage = document.getElementById('confirmationImage');
  const retakeButton = document.getElementById('retakeButton');
  const confirmButton = document.getElementById('confirmButton');
  const closeModalButton = confirmationModal.querySelector('.close');
  const toast = document.getElementById('toast');
  const modelLoading = document.getElementById('model-loading');
  const debugStatus = document.getElementById('debug-status');
  const fallbackButton = document.getElementById('fallback-button');

  let stream = null;
  let isCapturing = false;
  let alignedFrames = 0;
  let isDetectionActive = false;
  let modelsLoaded = false;
  let tempCtx = faceCanvas.getContext('2d');

  confirmationModal.classList.add('hidden');
  confirmationImage.src = '';
  function updateDebugStatus(message) {
    debugStatus.innerText = message;
    console.log(`Status: ${message}`);
  }

  function showToast(message, type = 'error', showRetry = false) {
    toast.innerHTML = message + (showRetry ? `<button class="retry-button">Tentar novamente</button>` : '');
    toast.classList.remove('hidden');
    toast.className = `toast toast-${type}`;
    setTimeout(() => toast.classList.add('hidden'), type === 'error' ? 10000 : 5000);
    console.log(`Toast: ${message} (${type})`);
    if (showRetry) {
      const retryButton = toast.querySelector('.retry-button');
      retryButton) { retryButton.removeEventListener('click', initialize);
      retryButton.addEventListener('click', initialize, { once: true });
    }
  }

  function stopStream() {
    if (!stream) return;
    stream.getTracks().forEach(track => track.stop());
    stream = null;
    faceVideo.srcObject = null;
    console.log('Stream fechado');
    updateDebugStatus('Stream fechado');
  }

  async function loadModels() {
    const path = 'https://raw.githubusercontent.com';
    try {
      updateDebugStatus('Carregando modelos...');
      console.log('Carregando modelos de ${path}');
      await Promise.race([
        faceapi.nets.tinyFaceDetector.loadFromUri(path),
        faceapi.nets.faceLandmark68Net.loadFromUri(path)
      ]);
      modelsLoaded = true;
      showToast('Modelos carregados!', 'success', false);
      updateDebugStatus('Modelos carregados');
      return true;
    } catch (error) {
      console.error('Erro ao carregar modelos:', error);
      showToast('Modelos não foram carregados corretamente.', 'error', true);
      updateDebugStatus('Erro ao carregar modelos');
      return false;
    }
  }

  async function setupOverlay() {
    faceOverlay.innerHTML = '';
    const oval = document.createElement('div');
    oval.classList.add('face-oval');
    faceOverlay.appendChild(oval);
    const ovalRect = await oval.getBoundingClientRect();
    console.log('Oval posicionado:', {
      width: window.innerWidth,
      height: window.innerHeight,
      left: ovalRect.left,
      top: ovalRect.top,
      width: ovalRect.width,
      height: ovalRect.height
    });
    updateDebugStatus('Overlay configurado');
  }

  async function startVideo() {
    try {
      updateDebugStatus('Iniciando vídeo...');
      stopStream();
      faceVideo.classList.remove('hidden');
      faceVideo.classList.add('fullscreen-video');
      faceVideo.style.zIndex = '1005';

      const constraints = {
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 }
        }
      };

      console.log('Solicitando stream:', constraints);
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (!stream.active) throw new Error('Stream inválido');
      faceVideo.srcObject = stream;
      console.log('Stream atribuído:', stream);
      updateDebugStatus('Stream ativo');

      await new Promise((resolve, reject) => {
        faceVideo.onloadedmetadata = () => {
          console.log('Metadados:', {
            width: faceVideo.videoWidth,
            height: faceVideo.videoHeight,
            readyState: faceVideo.readyState
          });
          faceCanvas.width = faceVideo.videoWidth;
          faceCanvas.height = faceVideo.videoHeight;
          updateDebugStatus('Resolução definida');
          resolve();
        };
        faceVideo.onerror = () => {
          console.error('Erro no vídeo');
          reject(new Error('Erro no stream'));
          updateDebugStatus('Erro no stream');
        } catch (err) {
          console.error('Erro ao carregar metadados:', err);
          updateDebugStatus('Erro nos metadados');
          reject(err);
        };
      });

      await faceVideo.play();
      console.log('Vídeo iniciado');
      updateDebugStatus('Vídeo iniciado');
      fallbackButton.classList.add('hidden');
      setupOverlay();
      isDetectionActive = true;
    } catch (error) {
      console.error('Erro ao iniciar vídeo:', error);
      let errorMessage = 'Erro ao iniciar o vídeo. Verifique a conexão.';
      if (error.name === 'NotAllowedError') {
        errorMessage = 'Permissões não autorizadas. Habilite a câmera em Configurações > Privacidade.';
      } else if (error.name === 'NotFoundError') {
        errorMessage = 'Nenhuma webcam encontrada. Verifique sua conexão.';
      } else if (error.name === 'NotReadableError') {
        errorMessage = 'Webcam em uso por outro aplicativo. Feche-o e tente novamente.';
      } else if (error.message.includes('Stream inválido')) {
        errorMessage = 'Stream da webcam inválido. Reinicie o dispositivo.';
      }
      showToast(errorMessage, 'error', true);
      updateDebugStatus('Erro no vídeo: ' + errorMessage);
      fallbackButton.classList.remove('hidden');
      stopStream();
    }
  }

  async function detectFaces() {
    if (!isDetectionActive || faceVideo.paused || faceVideo.ended || isCapturing) {
      console.log('Detecção pausada:', {
        isDetectionActive,
        isCapturing,
        paused: faceVideo.paused,
        ended: faceVideo.ended
      });
      return;
    }

    if (!modelsLoaded) {
      faceFeedback.innerHTML = '⚠️ Detecção facial indisponível';
      faceFeedback.classList.remove('hidden');
      requestAnimationFrame(detectFaces);
      return;
    }

    try {
      tempCtx.save();
      tempCtx.scale(-1, 1);
      tempCtx.drawImage(faceVideo, -faceVideo.videoWidth, 0, faceVideo.videoWidth, faceVideo.videoHeight);
      tempCtx.restore();

      const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
      const detections = await faceapi.detectAllFaces(tempCanvas, options).withFaceLandmarks();

      const oval = faceOverlay.querySelector('.face-oval');
      const videoWidth = faceVideo.videoWidth;
      const videoHeight = faceVideo.videoHeight;
      const screenWidth = window.innerWidth;
      const screenHeight = window.innerHeight;
      const scaleX = screenWidth / videoWidth;
      const scaleY = screenHeight / videoHeight;
      const ovalRect = oval.getBoundingClientRect();
      const ovalWidth = ovalRect.width;
      const ovalHeight = ovalRect.height;
      const ovalCenterX = screenWidth / 2;
      const ovalCenterY = screenHeight / 2;

      if (detections.length === 1) {
        const { box } = detections[0].detection;
        const landmarks = detections[0].landmarks;
        const nose = landmarks.getNose()[0];

        const noseScreenX = screenWidth - nose.x * scaleX;
        const noseScreenY = nose.y * scaleY;
        const distanceToOval = Math.sqrt(
          (noseScreenX - ovalCenterX) ** 2 + (noseScreenY - ovalCenterY) ** 2
        );
        const maxDistance = Math.min(ovalWidth, ovalHeight) * 0.35;

        if (distanceToOval < maxDistance && box.width > videoWidth * 0.05) {
          alignedFrames++;
          if (alignedFrames >= 4 && !isCapturing) {
            oval.classList.add('aligned');
            const sharpness = computeSharpness();
            if (sharpness > 0.05) {
              isCapturing = true;
              faceFeedback.innerHTML = '📸 Capturando...';
              faceFeedback.classList.remove('hidden');
              console.log('Captura iniciada');
              updateDebugStatus('Capturando');
              captureFace();
              return;
            } else {
              faceFeedback.innerHTML = '💡 Melhore a iluminação';
              faceFeedback.classList.remove('hidden');
              alignedFrames = 0;
            }
          } else {
            faceFeedback.innerHTML = '✅ Alinhado! Aguarde...';
            faceFeedback.classList.remove('hidden');
          }
        } else {
          alignedFrames = 0;
          oval.classList.remove('aligned');
          faceFeedback.innerHTML = distanceToOval >= maxDistance ? '↔ Centralize o rosto no oval' : '🔍 Aproxime';
          faceFeedback.classList.remove('hidden');
        }
      } else {
        alignedFrames = 0;
        oval.classList.remove('aligned');
        faceFeedback.innerHTML = detections.length === 0 ? '😶 Nenhum rosto detectado' : '⚠️ Apenas um rosto';
        faceFeedback.classList.remove('hidden');
      }
    } catch (error) {
      console.error('Erro na detecção:', error);
      showToast('Erro na detecção facial.', 'error', false);
      updateDebugStatus('Erro na detecção');
    }
    requestAnimationFrame(detectFaces);
  }

  function computeSharpness() {
    try {
      const regionSize = 80;
      const imageData = tempCtx.getImageData(0, 0, regionSize, regionSize);
      const data = imageData.data;
      let laplacianSum = 0;
      let count = 0;

      for (let i = 1; i < regionSize - 1; i++) {
        for (let j = 1; j < regionSize - j; j++) {
          const idx = (i * regionSize + j) * 4;
          const gray = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
          const laplacian =
            -4 * gray +
            (data[((i - 1) * regionSize + j) * 4] * 0.299 + data[((i - 1) * regionSize + j) * 4 + 1] * 0.587 + data[((i - 1) * regionSize + j) * 4 + 2] * 0.114) +
            (data[((i + 1) * regionSize + j) + 4] * 0.299 + data[((i + 1) * regionSize + j) * 4 + 1] * 0.587 + data[((i + 1) * regionSize + j) * 4 + 2] * 0.114) +
            (data[(i * regionSize + (j - 1)) * 4] * 0.299 + data[(i * regionSize + (j - 1)) * 4 + 1] * 0.587 + data[(i * regionSize + (j - 1)) * 4 + 2] * 0.114) +
            (data[(i * regionSize + (j + 1)) * 4] * 0.299 + data[(i * regionSize + j + 1)) * 4 + 1] * 0.587 + data[(i * regionSize + (j + 1)) * 4 + 2] * 0.114);
          laplacianSum += laplacian * laplacian;
          count++;
        }
      }
      const sharpness = count ? laplacianSum / count : 0;
      const normalizedSharpness = sharpness / 1000;
      console.log('Nitidez:', normalizedSharpness);
      return normalizedSharpness;
    } catch (error) {
      console.error('Erro ao calcular nitidez:', error);
      showToast('Erro na análise de qualidade.', 'error', false);
      updateDebugStatus('Erro na nitidez');
      return 0;
    }
  }

  function captureFace() {
    if (faceVideo.readyState < 2) {
      showToast('Vídeo não está pronto.', 'error', true);
      console.error('Vídeo não está pronto:', {
        readyState: faceVideo.readyState,
        width: faceVideo.videoWidth,
        height: faceVideo.videoHeight
      });
      isCapturing = false;
      isDetectionActive = true;
      detectFaces();
      updateDebugStatus('Vídeo não capturável');
      return;
  }

    faceCanvas.width = faceVideo.videoWidth;
    faceCanvas.height = faceVideo.videoHeight;
    const ctx = faceCanvas.getContext('2d');
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(faceVideo, -faceVideo.videoWidth, 0, faceVideo.videoWidth, faceVideo.videoHeight);
    ctx.restore();

    try {
      const targetWidth = Math.min(faceVideo.videoWidth, faceVideo.videoWidth * 3 / 4);
      const targetHeight = targetWidth * 4 / 3;
      const offsetX = (faceVideo.videoWidth - targetWidth) / 2;
      const offsetY = (faceVideo.videoHeight - targetHeight) / 2;

      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = targetWidth;
      cropCanvas.height = targetHeight;
      const cropCtx = cropCanvas.getContext('2d');
      cropCtx.drawImage(
        faceCanvas,
        offsetX, offsetY, targetWidth, targetHeight,
        0, 0, targetWidth, targetHeight
      );

      const imageData = cropCanvas.toDataURL('image/jpeg', 0.95);
      if (!imageData || imageData === 'data:image/jpeg') {
        throw new Error('Imagem inválida');
      }
      confirmationImage.src = imageData;
      confirmationModal.classList.remove('hidden');
      console.log('Foto capturada');
      updateDebugStatus('Foto capturada');
    } catch (error) {
      console.error('Erro ao capturar:', error);
      showToast('Erro ao capturar foto.', 'error', true);
      isCapturing = false;
      isDetectionActive = true;
      detectFaces();
      updateDebugStatus('Erro na captura');
      return;
    }

    stopStream();
    faceFeedback.classList.add('hidden');
    faceOverlay.innerHTML = '';
  }

  retakeButton.addEventListener('click', () => {
    confirmationModal.classList.add('hidden');
    confirmationImage.src = '';
    console.log('Repetindo captura');
    updateDebugStatus('Repetindo');
    initialize();
  });

  confirmButton.addEventListener('click', () => {
    sessionStorage.setItem('facePhoto', confirmationImage.src);
    confirmationModal.classList.add('hidden');
    console.log('Foto confirmada');
    updateDebugStatus('Confirmado');
    const urlParams = new URLSearchParams(window.location.search);
    const returnPage = urlParams.get('return') || 'index.html';
    window.location.href = returnPage;
  });

  closeModalButton.addEventListener('click', () => {
    confirmationModal.classList.add('hidden');
    confirmationImage.src = '';
    console.log('Modal fechado');
    updateDebugStatus('Modal fechado');
    initialize();
  });

  confirmationImage.addEventListener('click', () => {
    confirmationImage.classList.toggle('zoomed');
    console.log('Zoom da imagem');
    updateDebugStatus('Zoom');
  });

  fallbackButton.addEventListener('click', () => {
    fallbackButton.classList.add('hidden');
    initialize();
    console.log('Fallback clicado');
    updateDebugStatus('Fallback acionado');
  });

  document.addEventListener('click', () => {
    if (faceVideo.paused && stream) {
      faceVideo.play().catch(err => {
        console.error('Erro ao play após clique:', err);
        updateDebugStatus('Erro ao play');
        fallbackButton.classList.remove('hidden');
      });
    }
  }, { once: true });

  async function initialize() {
    modelLoading.classList.remove('hidden');
    updateDebugStatus('Inicializando...');
    try {
      await startVideo();
      await loadModels();
    } catch (err) {
      console.error('Erro na inicialização:', err);
      updateDebugStatus('Erro na inicialização');
    } finally {
      modelLoading.classList.add('hidden');
    }
  }

  initialize();
});
