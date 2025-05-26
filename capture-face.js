document.addEventListener('DOMContentLoaded', () => {
  if (window.location.protocol !== 'https:') {
    console.error('Erro: getUserMedia requer HTTPS. Execute o site em um servidor HTTPS.');
    showToast('Este site requer HTTPS para acessar a câmera. Use um servidor seguro ou ngrok para testes.', 'error', false);
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

  let stream = null;
  let isCapturing = false;
  let alignedFrames = 0;
  let detectionActive = false;
  let tempCanvas = document.createElement('canvas');
  let tempCtx = tempCanvas.getContext('2d');

  confirmationModal.classList.add('hidden');
  confirmationImage.src = '';
  sessionStorage.removeItem('facePhoto');

  function showToast(message, type = 'error', showRetry = false) {
    toast.innerHTML = message + (showRetry ? ' <button class="retry-button">Tentar novamente</button>' : '');
    toast.className = `toast toast-${type}`;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 7000);
    console.log(`Toast exibido: ${message} (${type})`);
    if (showRetry) {
      toast.querySelector('.retry-button').addEventListener('click', initialize);
    }
  }

  function stopStream() {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
      console.log('Stream da câmera fechado');
    }
  }

  async function loadModels(attempt = 1, maxAttempts = 3) {
    let path = './weights/';
    try {
      console.log(`Tentativa ${attempt} de carregar modelos de: ${path}`);
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(path),
        faceapi.nets.faceLandmark68Net.loadFromUri(path)
      ]);
      console.log('Modelos carregados com sucesso');
      showToast('Modelos carregados!', 'success');
      return true;
    } catch (error) {
      console.error(`Erro ao carregar modelos locais (tentativa ${attempt}):`, error);
      if (attempt < maxAttempts) {
        if (attempt === maxAttempts - 1) {
          path = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights/';
          console.log(`Tentando fallback para: ${path}`);
        }
        await new Promise(resolve => setTimeout(resolve, 3000));
        return loadModels(attempt + 1, maxAttempts);
      }
      showToast('Falha ao carregar modelos de detecção facial.', 'warning', true);
      return false;
    }
  }

  async function startFaceCapture(attempt = 1, maxAttempts = 3) {
    try {
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

      console.log(`Tentativa ${attempt} de iniciar câmera com constraints:`, constraints);
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('Stream obtido:', stream);

      faceVideo.srcObject = stream;
      console.log('Stream atribuído ao vídeo');

      faceVideo.classList.remove('hidden');
      faceVideo.classList.add('fullscreen-video');
      faceVideo.style.display = 'block';
      faceVideo.style.visibility = 'visible';
      faceVideo.style.zIndex = '1000';
      console.log('Estilos do vídeo aplicados:', {
        display: faceVideo.style.display,
        visibility: faceVideo.style.visibility,
        zIndex: faceVideo.style.zIndex
      });

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
        ovalHeight: ovalRect.height,
        expectedCenterX: window.innerWidth / 2,
        expectedCenterY: window.innerHeight / 2
      });

      await new Promise((resolve, reject) => {
        faceVideo.onloadedmetadata = () => {
          console.log('Metadados do vídeo carregados:', {
            width: faceVideo.videoWidth,
            height: faceVideo.videoHeight
          });
          tempCanvas.width = faceVideo.videoWidth;
          tempCanvas.height = faceVideo.videoHeight;
          resolve();
        };
        faceVideo.onerror = (err) => {
          console.error('Erro no vídeo:', err);
          reject(new Error('Erro ao carregar o stream de vídeo'));
        };
      });

      faceVideo.addEventListener('playing', () => {
        console.log('Vídeo começou a reproduzir');
      }, { once: true });

      await faceVideo.play().catch(err => {
        console.error('Erro ao iniciar reprodução do vídeo:', err);
        throw new Error('Falha ao iniciar o vídeo: ' + err.message);
      });
      console.log('Vídeo iniciado com sucesso');

      detectionActive = true;
      detectFaces();
    } catch (error) {
      console.error(`Erro ao iniciar câmera (tentativa ${attempt}):`, error);
      if (attempt < maxAttempts) {
        console.log(`Tentando novamente em 3 segundos...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
        return startFaceCapture(attempt + 1, maxAttempts);
      }
      let errorMessage = 'Erro ao iniciar a câmera. Verifique a conexão e tente novamente.';
      if (error.name === 'NotAllowedError') {
        errorMessage = 'Permissão de câmera negada. Habilite a câmera nas configurações do navegador.';
      } else if (error.name === 'NotFoundError') {
        errorMessage = 'Nenhuma câmera encontrada. Conecte uma câmera.';
      } else if (error.name === 'NotReadableError') {
        errorMessage = 'Câmera em uso por outro aplicativo. Feche-o e tente novamente.';
      } else if (error.message.includes('Failed to start video')) {
        errorMessage = 'Falha ao iniciar o vídeo. Verifique a câmera e tente novamente.';
      }
      showToast(errorMessage, 'error', true);
      faceVideo.classList.add('hidden');
      stopStream();
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
        console.warn('Canvas temporário não inicializado, reiniciando...');
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
              console.log('Condições atendidas, iniciando captura automática');
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
      console.error('Erro na detecção facial:', error);
      showToast('Erro na detecção facial. Verifique a iluminação ou tente novamente.', 'error', true);
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
      return 0;
    }
  }

  function captureFace() {
    if (faceVideo.readyState < 2 || faceVideo.videoWidth === 0 || faceVideo.videoHeight === 0) {
      showToast('Vídeo não está pronto. Verifique a câmera e tente novamente.', 'error', true);
      console.error('Vídeo não pronto:', {
        readyState: faceVideo.readyState,
        width: faceVideo.videoWidth,
        height: faceVideo.videoHeight
      });
      isCapturing = false;
      detectionActive = true;
      detectFaces();
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
    } catch (error) {
      console.error('Erro ao capturar imagem:', error);
      showToast('Erro ao capturar a foto.', 'error', true);
      isCapturing = false;
      detectionActive = true;
      detectFaces();
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
    initialize();
  });

  confirmButton.addEventListener('click', () => {
    sessionStorage.setItem('facePhoto', confirmationImage.src);
    confirmationModal.classList.add('hidden');
    console.log('Foto confirmada');
    const urlParams = new URLSearchParams(window.location.search);
    const returnPage = urlParams.get('return') || 'index.html';
    window.location.href = returnPage;
  });

  closeModalButton.addEventListener('click', () => {
    confirmationModal.classList.add('hidden');
    confirmationImage.src = '';
    faceVideo.classList.remove('hidden');
    console.log('Fechando modal');
    initialize();
  });

  confirmationImage.addEventListener('click', () => {
    confirmationImage.classList.toggle('zoomed');
    console.log('Zoom da imagem');
  });

  async function initialize() {
    modelLoading.classList.remove('hidden');
    try {
      await startFaceCapture();
      const modelsLoaded = await loadModels();
      if (!modelsLoaded) {
        console.warn('Modelos não carregados, continuando com câmera apenas');
        showToast('Detecção facial não disponível.', 'warning', true);
      }
    } catch (error) {
      console.error('Erro na inicialização:', error);
      showToast('Erro ao iniciar. Verifique a conexão ou câmera.', 'error', true);
    } finally {
      modelLoading.classList.add('hidden');
    }
  }

  initialize();
});
