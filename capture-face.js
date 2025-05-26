document.addEventListener('DOMContentLoaded', async () => {
  const faceVideo = document.getElementById('face-video');
  const faceCanvas = document.getElementById('face-canvas');
  const faceOverlay = document.getElementById('face-overlay');
  const faceInstructions = document.getElementById('face-instructions');
  const faceFeedback = document.getElementById('face-feedback');
  const countdownElement = document.getElementById('countdown');
  const confirmationModal = document.getElementById('confirmationModal');
  const confirmationImage = document.getElementById('confirmationImage');
  const retakeButton = confirmationModal.querySelector('.retake');
  const confirmButton = confirmationModal.querySelector('.confirm');
  const closeModalButton = confirmationModal.querySelector('.close');
  const toast = document.getElementById('toast');
  const modelLoading = document.getElementById('modelLoading');

  let stream = null;
  let isCapturing = false;
  let lastCaptureTime = 0;
  let alignedFrames = 0;
  let detectionActive = false;
  let faceDetected = false;
  let tempCanvas = document.createElement('canvas');
  let tempCtx = tempCanvas.getContext('2d');
  let captureButton = null;

  // Garantir que o modal esteja oculto no início
  confirmationModal.classList.add('hidden');
  confirmationImage.src = '';
  sessionStorage.removeItem('facePhoto');

  async function loadModels() {
    const paths = ['./weights', '/weights'];
    for (const path of paths) {
      try {
        console.log(`Tentando carregar modelos de: ${path}`);
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout ao carregar modelos')), 12000));
        await Promise.race([
          Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(path),
            faceapi.nets.faceLandmark68Net.loadFromUri(path)
          ]),
          timeout
        ]);
        console.log(`Modelos carregados com sucesso de: ${path}`);
        showToast('Modelos carregados com sucesso!', 'success');
        return true;
      } catch (error) {
        console.error(`Erro ao carregar modelos de ${path}:`, error);
      }
    }
    throw new Error('Falha ao carregar modelos de todos os caminhos tentados.');
  }

  modelLoading.classList.remove('hidden');
  try {
    await loadModels();
    modelLoading.classList.add('hidden');
    setTimeout(startFaceCapture, 2000);
  } catch (error) {
    modelLoading.classList.add('hidden');
    showToast('Erro ao carregar os modelos de detecção facial. Verifique os arquivos na pasta weights.', 'error');
    console.error('Erro final ao carregar modelos:', error);
    return;
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
      console.log(`Nitidez: ${sharpness}, Normalizada: ${normalizedSharpness}, Região: ${regionSize}x${regionSize}`);
      return normalizedSharpness;
    } catch (error) {
      console.error('Erro ao calcular nitidez:', error);
      showToast('Erro na análise de imagem.', 'error');
      return 0;
    }
  }

  async function startFaceCapture() {
    try {
      stopStream();
      faceVideo.srcObject = null;
      faceVideo.classList.add('hidden');
      isCapturing = false;
      detectionActive = false;

      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');
      let constraints = {
        video: {
          width: { min: 640, ideal: 1280, max: 1920 },
          height: { min: 480, ideal: 720, max: 1080 },
          facingMode: { exact: "user" }
        }
      };

      if (videoDevices.length > 0) {
        const frontCamera = videoDevices.find(device => device.label.toLowerCase().includes('front')) || videoDevices[0];
        constraints.video.deviceId = frontCamera.deviceId ? { exact: frontCamera.deviceId } : undefined;
      }

      console.log('Inicializando câmera com constraints:', constraints);
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      faceVideo.srcObject = stream;
      faceVideo.classList.remove('hidden');
      faceVideo.classList.add('fullscreen-video');
      faceInstructions.classList.remove('hidden');

      // Criar botão de captura
      if (!captureButton) {
        captureButton = document.createElement('button');
        captureButton.classList.add('capture-button', 'disabled');
        captureButton.textContent = 'Capturar';
        document.body.appendChild(captureButton);
      }

      faceOverlay.innerHTML = '';
      const oval = document.createElement('div');
      oval.classList.add('face-oval');
      oval.style.width = '300px';
      oval.style.height = '400px';
      oval.style.top = '50%';
      oval.style.left = '50%';
      oval.style.transform = 'translate(-50%, -50%)';
      faceOverlay.appendChild(oval);

      const waitForVideoReady = () => {
        if (faceVideo.readyState >= 2 && faceVideo.videoWidth > 0 && faceVideo.videoHeight > 0) {
          console.log('Vídeo pronto:', { width: faceVideo.videoWidth, height: faceVideo.videoHeight });
          tempCanvas.width = faceVideo.videoWidth;
          tempCanvas.height = faceVideo.videoHeight;
          detectionActive = true;
          detectFaces();
        } else {
          console.log('Aguardando vídeo...', { readyState: faceVideo.readyState, width: faceVideo.videoWidth, height: faceVideo.videoHeight });
          setTimeout(waitForVideoReady, 100);
        }
      };

      faceVideo.play().then(() => {
        console.log('Vídeo iniciado');
        waitForVideoReady();
      }).catch(error => {
        console.error('Erro ao iniciar reprodução do vídeo:', error);
        showToast('Erro ao iniciar o vídeo. Verifique as permissões da câmera e tente novamente.', 'error');
        faceVideo.classList.add('hidden');
      });

      faceVideo.addEventListener('error', (error) => {
        console.error('Erro no elemento de vídeo:', error);
        showToast('Erro no vídeo. Tente novamente.', 'error');
        stopStream();
        faceVideo.classList.add('hidden');
      });
    } catch (error) {
      showToast('Erro ao acessar a câmera: Permita o acesso à câmera no navegador.', 'error');
      console.error('Erro na câmera:', error);
      faceVideo.classList.add('hidden');
    }
  }

  async function detectFaces() {
    if (!detectionActive || faceVideo.paused || faceVideo.ended || isCapturing) {
      console.log('Detecção interrompida:', { detectionActive, isCapturing, paused: faceVideo.paused, ended: faceVideo.ended });
      return;
    }

    try {
      if (!faceapi.nets.tinyFaceDetector.isLoaded || !faceapi.nets.faceLandmark68Net.isLoaded) {
        throw new Error('Modelos não carregados');
      }

      console.log('Iniciando detecção de face');
      const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.3 });
      tempCtx.save();
      tempCtx.scale(-1, 1);
      tempCtx.drawImage(faceVideo, -faceVideo.videoWidth, 0, faceVideo.videoWidth, faceVideo.videoHeight);
      tempCtx.restore();
      const detections = await faceapi.detectAllFaces(tempCanvas, options).withFaceLandmarks();
      console.log(`Detecções: ${detections.length}`);

      const oval = faceOverlay.querySelector('.face-oval');
      const videoWidth = faceVideo.videoWidth;
      const videoHeight = faceVideo.videoHeight;
      const screenWidth = window.innerWidth;
      const screenHeight = window.innerHeight;
      const scaleX = screenWidth / videoWidth;
      const scaleY = screenHeight / videoHeight;
      const ovalStyle = getComputedStyle(oval);
      const ovalWidth = parseFloat(ovalStyle.width);
      const ovalHeight = parseFloat(ovalStyle.height);
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
        const maxDistance = Math.min(ovalWidth, ovalHeight) * 0.3;

        console.log(`Nariz: x=${noseScreenX}, y=${noseScreenY}, Distância ao oval: ${distanceToOval}, Máx: ${maxDistance}`);

        if (distanceToOval < maxDistance && box.width > videoWidth * 0.03) {
          alignedFrames++;
          faceFeedback.innerHTML = '✅ Rosto alinhado!';
          faceFeedback.classList.remove('hidden');
          captureButton.classList.remove('disabled');
          captureButton.classList.add('enabled');
          faceDetected = true;
          console.log('Rosto alinhado:', { alignedFrames, distanceToOval, boxWidth: box.width });

          if (alignedFrames >= 3) {
            const sharpness = calculateSharpness(tempCanvas, tempCtx, box);

            if (sharpness > 0.03) {
              console.log('Iniciando captura automática:', { sharpness });
              faceFeedback.innerHTML = '📸 Capturando...';
              isCapturing = true;
              detectionActive = false;
              captureButton.classList.add('disabled');
              startCountdown();
              return;
            } else {
              faceFeedback.innerHTML = `🌫️ Imagem não nítida (nitidez: ${sharpness.toFixed(2)})`;
              console.log('Nitidez insuficiente:', { sharpness });
            }
          }
        } else {
          alignedFrames = 0;
          faceFeedback.innerHTML = distanceToOval >= maxDistance ? '↔️ Alinhe o rosto no oval' : '🔍 Aproxime o rosto';
          faceFeedback.classList.remove('hidden');
          captureButton.classList.add('disabled');
          captureButton.classList.remove('enabled');
          faceDetected = false;
          console.log('Rosto desalinhado:', { distanceToOval, boxWidth: box.width });
        }
      } else {
        alignedFrames = 0;
        faceFeedback.innerHTML = detections.length === 0 ? '😶 Nenhum rosto detectado' : '⚠️ Apenas um rosto';
        faceFeedback.classList.remove('hidden');
        captureButton.classList.add('disabled');
        captureButton.classList.remove('enabled');
        faceDetected = false;
        console.log('Detecção inválida:', { detectionCount: detections.length });
      }
    } catch (error) {
      console.error('Erro na detecção:', error);
      showToast(`Erro na detecção: ${error.message}`, 'error');
      faceFeedback.innerHTML = '⚠️ Erro na detecção';
      faceFeedback.classList.remove('hidden');
    }

    if (detectionActive) {
      setTimeout(() => requestAnimationFrame(detectFaces), 80);
    }
  }

  function startCountdown() {
    let countdown = 3;
    countdownElement.textContent = countdown;
    countdownElement.classList.remove('hidden');
    countdownElement.style.opacity = '1';

    const countdownInterval = setInterval(() => {
      countdown--;
      countdownElement.textContent = countdown;
      if (countdown <= 0) {
        clearInterval(countdownInterval);
        countdownElement.style.opacity = '0';
        setTimeout(() => countdownElement.classList.add('hidden'), 300);
        captureFace();
      }
    }, 1000);
  }

  function captureFace() {
    if (faceVideo.readyState < 2 || faceVideo.videoWidth === 0 || faceVideo.videoHeight === 0) {
      showToast('Vídeo não está pronto.', 'error');
      console.error('Vídeo não pronto para captura:', { readyState: faceVideo.readyState, width: faceVideo.videoWidth, height: faceVideo.videoHeight });
      isCapturing = false;
      detectionActive = true;
      detectFaces();
      return;
    }

    faceCanvas.width = faceVideo.videoWidth;
    faceCanvas.height = faceVideo.videoHeight;
    const ctx = faceCanvas.getContext('2d');

    ctx.drawImage(faceVideo, 0, 0);

    try {
      const imageData = faceCanvas.toDataURL('image/jpeg', 0.95);
      if (!imageData || imageData === 'data:,') {
        throw new Error('Imagem inválida');
      }
      confirmationImage.src = imageData;
      confirmationModal.classList.remove('hidden');
      console.log('Foto capturada com sucesso');
    } catch (error) {
      console.error('Erro ao capturar imagem:', error);
      showToast('Falha ao capturar imagem.', 'error');
      isCapturing = false;
      detectionActive = true;
      detectFaces();
      return;
    }

    stopStream();
    faceInstructions.classList.add('hidden');
    faceFeedback.classList.add('hidden');
    faceOverlay.innerHTML = '';
    if (captureButton) captureButton.remove();
    lastCaptureTime = Date.now();
    isCapturing = false;
  }

  if (captureButton) {
    captureButton.addEventListener('click', () => {
      if (faceDetected) {
        isCapturing = true;
        detectionActive = false;
        captureButton.classList.add('disabled');
        startCountdown();
      } else {
        showToast('Posicione o rosto corretamente antes de capturar.', 'error');
      }
    });
  }

  retakeButton.addEventListener('click', () => {
    confirmationModal.classList.add('hidden');
    confirmationImage.src = '';
    faceVideo.classList.remove('hidden');
    console.log('Repetir foto');
    startFaceCapture();
  });

  confirmButton.addEventListener('click', () => {
    sessionStorage.setItem('facePhoto', confirmationImage.src);
    confirmationModal.classList.add('hidden');
    console.log('Foto confirmada, redirecionando');
    const urlParams = new URLSearchParams(window.location.search);
    const returnPage = urlParams.get('return') || 'index.html';
    window.location.href = returnPage;
  });

  closeModalButton.addEventListener('click', () => {
    confirmationModal.classList.add('hidden');
    confirmationImage.src = '';
    faceVideo.classList.remove('hidden');
    console.log('Fechando modal');
    startFaceCapture();
  });

  confirmationImage.addEventListener('click', () => {
    confirmationImage.classList.toggle('zoomed');
    console.log('Zoom da imagem alterado');
  });

  function showToast(message, type) {
    toast.textContent = message;
    toast.className = `toast toast-${type}`;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
    console.log(`Toast exibido: ${message} (${type})`);
  }

  function stopStream() {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
      console.log('Stream da câmera encerrado');
    }
    faceVideo.srcObject = null;
  }
});
