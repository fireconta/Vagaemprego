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

  // Carregar modelos
  async function loadModels() {
    const paths = ['./weights', '/weights'];
    for (const path of paths) {
      try {
        console.log(`Carregando modelos de: ${path}`);
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(path),
          faceapi.nets.faceLandmark68Net.loadFromUri(path),
        ]);
        console.log(`Modelos carregados: ${path}`);
        showToast('Modelos carregados!', 'success');
        return true;
      } catch (error) {
        console.error(`Erro em ${path}:`, error);
      }
    }
    throw new Error('Falha ao carregar modelos.');
  }

  modelLoading.classList.remove('hidden');
  try {
    await loadModels();
    modelLoading.classList.add('hidden');
    startFaceCapture();
  } catch (error) {
    modelLoading.classList.add('hidden');
    showToast('Erro ao carregar modelos. Verifique a pasta weights.', 'error');
    console.error('Erro ao carregar modelos:', error);
    return;
  }

  // Calcular nitidez (região central do rosto)
  function calculateSharpness(canvas, ctx, box) {
    const regionSize = Math.min(box.width, box.height) * 0.5;
    const x = box.x + box.width / 2 - regionSize / 2;
    const y = box.y + box.height / 2 - regionSize / 2;
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
    return count ? laplacianSum / count : 0;
  }

  // Iniciar captura
  async function startFaceCapture() {
    try {
      // Selecionar câmera frontal
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');
      let constraints = { video: { width: 1280, height: 720, facingMode: 'user' } };

      if (videoDevices.length > 0) {
        const frontCamera = videoDevices.find(device => device.label.toLowerCase().includes('front')) || videoDevices[0];
        constraints.video.deviceId = frontCamera.deviceId;
      }

      stream = await navigator.mediaDevices.getUserMedia(constraints);
      faceVideo.srcObject = stream;
      faceVideo.classList.remove('hidden');
      faceInstructions.classList.remove('hidden');

      // Configurar canvas temporário
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');

      // Detecção facial
      faceVideo.addEventListener('play', async () => {
        tempCanvas.width = faceVideo.videoWidth;
        tempCanvas.height = faceVideo.videoHeight;

        const detectionInterval = setInterval(async () => {
          if (!faceVideo.paused && !faceVideo.ended && !isCapturing) {
            const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
            const detections = await faceapi.detectAllFaces(faceVideo, options).withFaceLandmarks();
            faceOverlay.innerHTML = '';

            // Desenhar oval fixo no centro
            const oval = document.createElement('div');
            oval.classList.add('face-oval');
            faceOverlay.appendChild(oval);

            if (detections.length === 1) {
              const { box } = detections[0].detection;
              const landmarks = detections[0].landmarks;
              const nose = landmarks.getNose()[0];

              // Verificar alinhamento com o centro da tela
              const videoWidth = faceVideo.videoWidth;
              const videoHeight = faceVideo.videoHeight;
              const centerX = videoWidth / 2;
              const centerY = videoHeight / 2;
              const distanceToCenter = Math.sqrt((nose.x - centerX) ** 2 + (nose.y - centerY) ** 2);

              if (distanceToCenter < videoWidth * 0.1 && box.width > videoWidth * 0.25) {
                oval.style.borderColor = '#22c55e';
                oval.classList.add('pulse');
                faceFeedback.innerHTML = '✅ Rosto alinhado! Verificando nitidez...';
                faceFeedback.classList.remove('hidden');

                // Verificar nitidez
                tempCtx.drawImage(faceVideo, 0, 0);
                const sharpness = calculateSharpness(tempCanvas, tempCtx, box);

                if (sharpness > 70 && Date.now() - lastCaptureTime > 5000) {
                  faceFeedback.innerHTML = '📸 Imagem nítida! Capturando...';
                  isCapturing = true;
                  clearInterval(detectionInterval);
                  startCountdown();
                } else {
                  faceFeedback.innerHTML = '🌫️ Imagem desfocada. Ajuste a iluminação.';
                }
              } else {
                oval.style.borderColor = '#10b981';
                oval.classList.remove('pulse');
                faceFeedback.innerHTML = '↔️ Centralize o rosto no oval.';
                faceFeedback.classList.remove('hidden');
              }
            } else {
              oval.style.borderColor = '#10b981';
              faceFeedback.innerHTML = detections.length === 0 ? '😶 Nenhum rosto detectado.' : '⚠️ Apenas um rosto permitido.';
              faceFeedback.classList.remove('hidden');
            }
          }
        }, 250);
      });
    } catch (error) {
      showToast('Erro ao acessar a câmera. Verifique permissões ou conecte um dispositivo.', 'error');
      console.error('Erro na câmera:', error);
    }
  }

  // Contagem regressiva
  function startCountdown() {
    let countdown = 2;
    countdownElement.textContent = countdown;
    countdownElement.classList.remove('hidden');
    countdownElement.style.opacity = '1';

    countdownInterval = setInterval(() => {
      countdown--;
      if (countdown > 0) {
        countdownElement.textContent = countdown;
        countdownElement.style.opacity = '0.7';
      } else {
        clearInterval(countdownInterval);
        countdownElement.style.opacity = '0';
        setTimeout(() => countdownElement.classList.add('hidden'), 300);
        captureFace();
      }
    }, 1000);
  }

  // Capturar foto
  function captureFace() {
    faceCanvas.width = faceVideo.videoWidth;
    faceCanvas.height = faceVideo.videoHeight;
    const ctx = faceCanvas.getContext('2d');
    ctx.drawImage(faceVideo, 0, 0);
    const imageData = faceCanvas.toDataURL('image/jpeg', 0.9);
    confirmationImage.src = imageData;
    confirmationModal.classList.remove('hidden');
    ctx.clearRect(0, 0, faceCanvas.width, faceCanvas.height);
    stopStream();
    faceInstructions.classList.add('hidden');
    faceFeedback.classList.add('hidden');
    faceOverlay.innerHTML = '';
    lastCaptureTime = Date.now();
    isCapturing = false;
  }

  // Modal
  retakeButton.addEventListener('click', () => {
    confirmationModal.classList.add('hidden');
    confirmationImage.src = '';
    faceVideo.classList.remove('hidden');
    startFaceCapture();
  });

  confirmButton.addEventListener('click', () => {
    sessionStorage.setItem('facePhoto', confirmationImage.src);
    confirmationModal.classList.add('hidden');
    const urlParams = new URLSearchParams(window.location.search);
    const returnPage = urlParams.get('return') || 'index.html';
    window.location.href = returnPage;
  });

  closeModalButton.addEventListener('click', () => {
    confirmationModal.classList.add('hidden');
    confirmationImage.src = '';
    faceVideo.classList.remove('hidden');
    startFaceCapture();
  });

  confirmationImage.addEventListener('click', () => {
    confirmationImage.classList.toggle('zoomed');
  });

  // Funções auxiliares
  function showToast(message, type) {
    toast.textContent = message;
    toast.className = `toast toast-${type}`;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 2000);
  }

  function stopStream() {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }
  }
});
