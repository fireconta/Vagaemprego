document.addEventListener('DOMContentLoaded', () => {
  if (window.location.protocol !== 'https:') {
    console.error('Erro: getUserMedia requer HTTPS.');
    showToast('Este site requer HTTPS para acessar a câmera. Use um servidor seguro ou ngrok.', 'error', false);
    updateDebugStatus('Erro: HTTPS necessário');
    return;
  }

  const faceVideo = document.getElementById('face-video');
  const faceCanvas = document.getElementById('face-canvas');
  const faceOverlay = document.getElementById('face-overlay');
  const faceFeedback = document.getElementById('face-feedback');
  const confirmationModal = document.getElementById('confirmationModal');
  const confirmationImage = document.getElementById('confirmationImage');
  const retakeButton = confirmationModal.querySelector('.retake');
  const confirmButton = confirmationModal.querySelector('.confirm');
  const closeModalButton = confirmationModal.querySelector('.close');
  const toast = document.getElementById('toast');
  const modelLoading = document.getElementById('modelLoading');
  const debugStatus = document.getElementById('debugStatus');

  let stream = null;
  let isCapturing = false;
  let alignedFrames = 0;
  let detectionActive = false;
  let tempCanvas = document.createElement('canvas');
  let tempCtx = tempCanvas.getContext('2d');

  confirmationModal.classList.add('hidden');
  confirmationImage.src = '';
  sessionStorage.removeItem('facePhoto');

  function updateDebugStatus(message) {
    debugStatus.textContent = message;
    console.log(`Status: ${message}`);
  }

  function showToast(message, type = 'error', showRetry = true) {
    toast.innerHTML = message + (showRetry ? ' <button class="retry-button">Tentar novamente</button>' : '');
    toast.className = `toast toast-${type}`;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 7000);
    console.log(`Toast: ${message} (${type})`);
    if (showRetry) {
      const retryButton = toast.querySelector('.retry-button');
      retryButton.removeEventListener('click', initialize); // Evitar múltiplos listeners
      retryButton.addEventListener('click', initialize, { once: true });
    }
  }

  function stopStream() {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
      console.log('Stream fechado');
      updateDebugStatus('Stream fechado');
    }
  }

  async function loadModels(attempt = 1, maxAttempts = 3) {
    const path = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/';
    try {
      console.log(`Tentativa ${attempt} de carregar modelos de ${path}`);
      updateDebugStatus(`Carregando modelos (${attempt}/${maxAttempts})`);
      await Promise.race([
        Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(path),
          faceapi.nets.faceLandmark68Net.loadFromUri(path)
        ]),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout nos modelos')), 10000))
      ]);
      console.log('Modelos carregados');
      showToast('Modelos carregados!', 'success');
      updateDebugStatus('Modelos carregados');
      return true;
    } catch (error) {
      console.error(`Erro ao carregar modelos (tentativa ${attempt}):`, error);
      updateDebugStatus(`Erro nos modelos (${attempt}/${maxAttempts})`);
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        return loadModels(attempt + 1, maxAttempts);
      }
      showToast('Falha ao carregar modelos.', 'warning', true);
      updateDebugStatus('Falha nos modelos');
      return false;
    }
  }

  async function startFaceCapture(attempt = 1, maxAttempts = 5) {
    try {
      updateDebugStatus(`Iniciando câmera (${attempt}/${maxAttempts})`);
      stopStream();
      faceVideo.srcObject = null;
      faceVideo.classList.add('hidden');
      isCapturing = false;
      detectionActive = false;

      const constraints = {
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 }
        }
      };

      console.log(`Tentativa ${attempt} de iniciar câmera:`, constraints);
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (!stream || !stream.active) {
        throw new Error('Stream inválido ou inativo');
      }
      console.log('Stream obtido:', stream);
      updateDebugStatus('Stream obtido');

      faceVideo.srcObject = stream;
      console.log('Stream atribuído');
      updateDebugStatus('Stream atribuído');

      faceVideo.classList.remove('hidden');
      faceVideo.classList.add('fullscreen-video');
      faceVideo.style.display = 'block';
      faceVideo.style.visibility = 'visible';
      faceVideo.style.zIndex = '1005';
      console.log('Estilos do vídeo:', {
        display: faceVideo.style.display,
        visibility: faceVideo.style.visibility,
        zIndex: faceVideo.style.zIndex,
        className: faceVideo.className,
        computedDisplay: getComputedStyle(faceVideo).display
      });
      updateDebugStatus('Vídeo visível');

      faceOverlay.innerHTML = '';
      const oval = document.createElement('div');
      oval.classList.add('face-oval');
      faceOverlay.appendChild(oval);
      const ovalRect = oval.getBoundingClientRect();
      console.log('Oval posicionado:', {
        screenWidth: window.innerWidth,
        screenHeight: window.innerHeight,
        ovalLeft: ovalRect.left,
        ovalTop: ovalRect.top,
        ovalWidth: ovalRect.width,
        ovalHeight: ovalRect.height
      });

      await new Promise((resolve, reject) => {
        faceVideo.onloadedmetadata = () => {
          console.log('Metadados:', {
            width: faceVideo.videoWidth,
            height: faceVideo.videoHeight,
            readyState: faceVideo.readyState
          });
          tempCanvas.width = faceVideo.videoWidth;
          tempCanvas.height = faceVideo.videoHeight;
          updateDebugStatus('Metadados carregados');
          resolve();
        };
        faceVideo.onerror = (err) => {
          console.error('Erro no vídeo:', err);
          updateDebugStatus('Erro no vídeo');
          reject(new Error('Erro ao carregar stream'));
        };
      });

      let playAttempts = 0;
      const maxPlayAttempts = 3;
      async function tryPlay() {
        try {
          await faceVideo.play();
          console.log('Vídeo iniciado');
          updateDebugStatus('Vídeo iniciado');
        } catch (err) {
          console.error(`Erro ao iniciar vídeo (tentativa ${playAttempts + 1}):`, err);
          updateDebugStatus(`Erro ao iniciar vídeo (${playAttempts + 1})`);
          if (playAttempts < maxPlayAttempts) {
            playAttempts++;
            await new Promise(resolve => setTimeout(resolve, 1000));
            return tryPlay();
          }
          throw err;
        }
      }
      await tryPlay();

      detectionActive = true;
      detectFaces();
    } catch (error) {
      console.error(`Erro na câmera (tentativa ${attempt}):`, error);
      updateDebugStatus(`Erro na câmera (${attempt}/${maxAttempts})`);
      if (attempt < maxAttempts) {
        console.log('Tentando novamente em 5s...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        return startFaceCapture(attempt + 1, maxAttempts);
      }
      let errorMessage = 'Erro ao iniciar a câmera. Verifique a conexão.';
      if (error.name === 'NotAllowedError') {
        errorMessage = 'Permissão negada. Habilite a câmera em Configurações > Privacidade.';
      } else if (error.name === 'NotFoundError') {
        errorMessage = 'Nenhuma câmera encontrada. Conecte uma câmera.';
      } else if (error.name === 'NotReadableError') {
        errorMessage = 'Câmera em uso por outro aplicativo. Feche-o e tente novamente.';
      } else if (error.message.includes('Stream inválido')) {
        errorMessage = 'Erro no stream da câmera. Reinicie o dispositivo.';
      }
      showToast(errorMessage, 'error', true);
      faceVideo.classList.add('hidden');
      stopStream();
      updateDebugStatus('Falha na câmera');
    }
  }

  async function detectFaces() {
    if (!detectionActive || faceVideo.paused || faceVideo.ended || isCapturing) {
      console.log('Detecção pausada:', {
        detectionActive,
        isCapturing,
        paused: faceVideo.paused,
        ended: faceVideo.ended
      });
      return;
    }

    try {
      if (!tempCanvas.width || !tempCanvas.height) {
        console.warn('Canvas não inicializado');
        tempCanvas.width = faceVideo.videoWidth;
        tempCanvas.height = faceVideo.videoHeight;
      }

      const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
      tempCtx.save();
      tempCtx.scale(-1, 1);
      tempCtx.drawImage(faceVideo, -faceVideo.videoWidth, 0, faceVideo.videoWidth, faceVideo.videoHeight);
      tempCtx.restore();
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
            const sharpness = calculateSharpness(tempCanvas, tempCtx, box);
            if (sharpness > 0.05) {
              isCapturing = true;
              faceFeedback.innerHTML = '📸 Capturando...';
              faceFeedback.classList.remove('hidden');
              console.log('Captura automática');
              updateDebugStatus('Capturando');
              captureFace();
              return;
            } else {
              faceFeedback.innerHTML = '💡 Melhore a iluminação';
              faceFeedback.classList.remove('hidden');
              alignedFrames = 0;
            }
          } else {
            faceFeedback.innerHTML = '✅ Rosto alinhado! Aguarde...';
            faceFeedback.classList.remove('hidden');
          }
        } else {
          alignedFrames = 0;
          oval.classList.remove('aligned');
          faceFeedback.innerHTML = distanceToOval >= maxDistance ? '↔ Centralize o rosto no oval' : '🔍 Aproxime o rosto';
          faceFeedback.classList.remove('hidden');
        }
      } else {
        alignedFrames = 0;
        oval.classList.remove('aligned');
        faceFeedback.innerHTML = detections.length === 0 ? '😶 Nenhum rosto detectado' : '⚠️ Apenas um rosto deve ser detectado';
        faceFeedback.classList.remove('hidden');
      }
    } catch (error) {
      console.error('Erro na detecção:', error);
      showToast('Erro na detecção facial.', 'error', true);
      updateDebugStatus('Erro na detecção');
    }

    if (detectionActive) {
      requestAnimationFrame(detectFaces);
    }
  }

  function calculateSharpness(canvas, ctx, box) {
    try {
      const regionSize = 128;
      const x = Math.max(0, box.x + box.width / 2 - regionSize / 2);
      const y = Math.max(0, box.y + box.height / 2 - regionSize / 2);
      const imageData = ctx.getImageData(x, y, regionSize, regionSize);
      const data = imageData.data;
      let laplacianSum = 0;
      let count = 0;

      for (let i = 1; i < regionSize - 1; i += 2) {
        for (let j = 1; j < regionSize - 1; j += 2) {
          const idx = (i * regionSize + j) * 4;
          const gray = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
          const laplacian =
            -4 * gray +
            (data[((i - 1) * regionSize + j) * 4] * 0.299 + data[((i - 1) * regionSize + j) * 4 + 1] * 0.587 + data[((i - 1) * regionSize + j) * 4 + 2] * 0.114) +
            (data[((i + 1) * regionSize + j) * 4] * 0.299 + data[((i + 1) * regionSize + j) * 4 + 1] * 0.587 + data[((i + 1) * regionSize + j) * 4 + 2] * 0.114) +
            (data[(i * regionSize + (j - 1)) * 4] * 0.299 + data[(i * regionSize + (j - 1)) * 4 + 1] * 0.587 + data[(i * regionSize + (j - 1)) * 4 + 2] * 0.114) +
            (data[(i * regionSize + (j + 1)) * 4] * 0.299 + data[(i * regionSize + (j + 1)) * 4 + 1] * 0.587 + data[(i * regionSize + (j + 1)) * 4 + 2] * 0.114);
          laplacianSum += laplacian * laplacian;
          count++;
        }
      }
      const sharpness = count ? laplacianSum / count : 0;
      const normalizedSharpness = sharpness / 1000;
      console.log(`Nitidez: ${sharpness}, Normalizada: ${normalizedSharpness}`);
      return normalizedSharpness;
    } catch (error) {
      console.error('Erro ao calcular nitidez:', error);
      showToast('Erro na análise de imagem.', 'error', true);
      updateDebugStatus('Erro na nitidez');
      return 0;
    }
  }

  function captureFace() {
    if (faceVideo.readyState < 2 || faceVideo.videoWidth === 0 || faceVideo.videoHeight === 0) {
      showToast('Vídeo não está pronto. Verifique a câmera.', 'error', true);
      console.error('Vídeo não pronto:', {
        readyState: faceVideo.readyState,
        width: faceVideo.videoWidth,
        height: faceVideo.videoHeight
      });
      isCapturing = false;
      detectionActive = true;
      detectFaces();
      updateDebugStatus('Vídeo não pronto');
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
      const targetWidth = Math.min(faceVideo.videoWidth, faceVideo.videoHeight * 3 / 4);
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
      if (!imageData || imageData === 'data:,') {
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
      detectionActive = true;
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
    faceVideo.classList.remove('hidden');
    console.log('Repetindo captura');
    updateDebugStatus('Repetindo captura');
    initialize();
  });

  confirmButton.addEventListener('click', () => {
    sessionStorage.setItem('facePhoto', confirmationImage.src);
    confirmationModal.classList.add('hidden');
    console.log('Foto confirmada');
    updateDebugStatus('Foto confirmada');
    const urlParams = new URLSearchParams(window.location.search);
    const returnPage = urlParams.get('return') || 'index.html';
    window.location.href = returnPage;
  });

  closeModalButton.addEventListener('click', () => {
    confirmationModal.classList.add('hidden');
    confirmationImage.src = '';
    faceVideo.classList.remove('hidden');
    console.log('Fechando modal');
    updateDebugStatus('Fechando modal');
    initialize();
  });

  confirmationImage.addEventListener('click', () => {
    confirmationImage.classList.toggle('zoomed');
    console.log('Zoom da imagem');
    updateDebugStatus('Zoom da imagem');
  });

  // Adicionar listener para interação do usuário (toque/clique)
  document.addEventListener('click', () => {
    if (faceVideo.paused && stream) {
      faceVideo.play().catch(err => {
        console.error('Erro ao tentar play após clique:', err);
        updateDebugStatus('Erro ao play após clique');
      });
    }
  }, { once: true });

  async function initialize() {
    modelLoading.classList.remove('hidden');
    updateDebugStatus('Inicializando câmera e modelos');
    try {
      await startFaceCapture();
      const modelsLoaded = await loadModels();
      if (!modelsLoaded) {
        console.warn('Modelos não carregados');
        showToast('Detecção facial não disponível.', 'warning', true);
        updateDebugStatus('Detecção facial não disponível');
      }
    } catch (error) {
      console.error('Erro na inicialização:', error);
      showToast('Erro ao iniciar. Verifique a câmera.', 'error', true);
      updateDebugStatus('Erro na inicialização');
    } finally {
      modelLoading.classList.add('hidden');
    }
  }

  initialize();
});
