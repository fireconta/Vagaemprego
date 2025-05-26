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
  let tempCanvas = document.createElement('canvas');
  let tempCtx = tempCanvas.getContext('2d');

  async function loadModels() {
    const path = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights';
    try {
      console.log(`Carregando modelos de: ${path}`);
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout no carregamento')), 8000));
      await Promise.race([
        Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(path),
          faceapi.nets.faceLandmark68Net.loadFromUri(path)
        ]),
        timeout
      ]);
      console.log('Modelos carregados com sucesso');
      showToast('Modelos carregados!', 'success');
      return true;
    } catch (error) {
      console.error('Erro ao carregar modelos:', error);
      throw new Error(error.message);
    }
  }

  modelLoading.classList.remove('hidden');
  try {
    await loadModels();
    modelLoading.classList.add('hidden');
    setTimeout(startFaceCapture, 2000);
  } catch (error) {
    modelLoading.classList.add('hidden');
    showToast(`Erro ao carregar modelos: ${error.message}. Verifique sua conexão.`, 'error');
    console.error('Falha na inicialização:', error);
    return;
  }

  function calculateSharpnessAndBrightness(canvas, ctx, box) {
    try {
      const regionSize = 128;
      const x = Math.max(0, box.x + box.width / 2 - regionSize / 2);
      const y = Math.max(0, box.y + box.height / 2 - regionSize / 2);
      const imageData = ctx.getImageData(x, y, regionSize, regionSize);
      const data = imageData.data;
      let laplacianSum = 0;
      let brightnessSum = 0;
      let count = 0;

      for (let i = 1; i < regionSize - 1; i += 2) {
        for (let j = 1; j < regionSize - 1; j += 2) {
          const idx = (i * regionSize + j) * 4;
          const gray = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
          brightnessSum += gray;
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
      const averageBrightness = brightnessSum / (count * 255);
      console.log(`Nitidez: ${sharpness}, Normalizada: ${normalizedSharpness}, Brilho: ${averageBrightness.toFixed(2)}, Região: ${regionSize}x${regionSize}`);
      return { sharpness: normalizedSharpness, brightness: averageBrightness };
    } catch (error) {
      console.error('Erro ao calcular nitidez/brilho:', error);
      showToast('Erro na análise de imagem.', 'error');
      return { sharpness: 0, brightness: 0 };
    }
  }

  async function startFaceCapture() {
    try {
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
      faceInstructions.classList.remove('hidden');

      faceOverlay.innerHTML = '';
      const oval = document.createElement('div');
      oval.classList.add('face-oval');
      faceOverlay.appendChild(oval);

      tempCanvas.width = faceVideo.videoWidth;
      tempCanvas.height = faceVideo.videoHeight;

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

      faceVideo.addEventListener('play', waitForVideoReady);
    } catch (error) {
      showToast('Erro ao acessar a câmera: Permita o acesso à câmera.', 'error');
      console.error('Erro na câmera:', error);
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

      const oval = faceOverlay.firstChild;
      const videoWidth = faceVideo.videoWidth;
      const videoHeight = faceVideo.videoHeight;
      const screenWidth = document.body.clientWidth;
      const screenHeight = document.body.clientHeight;
      const scaleX = screenWidth / videoWidth;
      const scaleY = screenHeight / videoHeight;
      const ovalWidth = 240; // Fixo, em pixels
      const ovalHeight = 320; // Fixo, em pixels
      const ovalCenterX = screenWidth / 2; // Centro da tela
      const ovalCenterY = screenHeight / 2;

      if (detections.length === 1) {
        const { box } = detections[0].detection;
        const landmarks = detections[0].landmarks;
        const nose = landmarks.getNose()[0];

        // Verificar alinhamento com oval fixo
        const noseScreenX = screenWidth - nose.x * scaleX; // Ajuste para espelhamento
        const noseScreenY = nose.y * scaleY;
        const distanceToOval = Math.sqrt(
          (noseScreenX - ovalCenterX) ** 2 + (noseScreenY - ovalCenterY) ** 2
        );
        const maxDistance = Math.min(ovalWidth, ovalHeight) * 0.3; // Tolerância

        console.log(`Nariz: x=${noseScreenX}, y=${noseScreenY}, Distância ao oval: ${distanceToOval}, Máx: ${maxDistance}`);

        if (distanceToOval < maxDistance && box.width > videoWidth * 0.03) {
          alignedFrames++;
          oval.classList.add('aligned');
          faceFeedback.innerHTML = '✅ Rosto alinhado!';
          faceFeedback.classList.remove('hidden');
          console.log('Rosto alinhado:', { alignedFrames, distanceToOval, boxWidth: box.width });

          if (alignedFrames >= 3) {
            const { sharpness, brightness } = calculateSharpnessAndBrightness(tempCanvas, tempCtx, box);

            if (sharpness > 0.25 && brightness > 0.2) {
              console.log('Captura disparada:', { sharpness, brightness, timeSinceLastCapture: Date.now() - lastCaptureTime });
              faceFeedback.innerHTML = '📸 Capturando...';
              isCapturing = true;
              detectionActive = false;
              startCountdown();
              return;
            } else {
              faceFeedback.innerHTML = brightness <= 0.2 ? `🌑 Ambiente muito escuro (brilho: ${brightness.toFixed(2)})` : `🌫️ Imagem não nítida (nitidez: ${sharpness.toFixed(2)})`;
              console.log('Condições insuficientes:', { sharpness, brightness, timeSinceLastCapture: Date.now() - lastCaptureTime });
            }
          }
        } else {
          alignedFrames = 0;
          oval.classList.remove('aligned');
          faceFeedback.innerHTML = distanceToOval >= maxDistance ? '↔️ Alinhe o rosto no oval' : '🔍 Aproxime o rosto';
          faceFeedback.classList.remove('hidden');
          console.log('Rosto desalinhado:', { distanceToOval, boxWidth: box.width });
        }
      } else {
        alignedFrames = 0;
        oval.classList.remove('aligned');
        faceFeedback.innerHTML = detections.length === 0 ? '😶 Nenhum rosto detectado' : '⚠️ Apenas um rosto';
        faceFeedback.classList.remove('hidden');
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
    let countdown = 1;
    countdownElement.textContent = countdown;
    countdownElement.classList.remove('hidden');
    countdownElement.style.opacity = '1';

    const countdownInterval = setInterval(() => {
      countdown--;
      if (countdown <= 0) {
        clearInterval(countdownInterval);
        countdownElement.style.opacity = '0';
        setTimeout(() => countdownElement.classList.add('hidden'), 300);
        captureFace();
      }
    }, 200);
  }

  function captureFace() {
    if (faceVideo.readyState < 2) {
      showToast('Vídeo não está pronto.', 'error');
      console.error('Vídeo não pronto para captura:', { readyState: faceVideo.readyState });
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
    lastCaptureTime = Date.now();
    isCapturing = false;
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
    console.log('Foto confirmada, redirecionando para capture-face.html');
    window.location.href = 'capture-face.html';
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
  }
});
