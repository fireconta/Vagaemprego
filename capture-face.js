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

  // Calcular nitidez (variância de Laplacian)
  function calculateSharpness(canvas, ctx) {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    let laplacianSum = 0;
    let count = 0;

    for (let y = 1; y < canvas.height - 1; y += 2) { // Pular linhas para otimizar
      for (let x = 1; x < canvas.width - 1; x += 2) {
        const idx = (y * canvas.width + x) * 4;
        const gray = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
        const laplacian =
          -4 * gray +
          (data[((y - 1) * canvas.width + x) * 4] * 0.299 + data[((y - 1) * canvas.width + x) * 4 + 1] * 0.587 + data[((y - 1) * canvas.width + x) * 4 + 2] * 0.114) +
          (data[((y + 1) * canvas.width + x) * 4] * 0.299 + data[((y + 1) * canvas.width + x) * 4 + 1] * 0.587 + data[((y + 1) * canvas.width + x) * 4 + 2] * 0.114) +
          (data[(y * canvas.width + (x - 1)) * 4] * 0.299 + data[(y * canvas.width + (x - 1)) * 4 + 1] * 0.587 + data[(y * canvas.width + (x - 1)) * 4 + 2] * 0.114) +
          (data[(y * canvas.width + (x + 1)) * 4] * 0.299 + data[(y * canvas.width + (x + 1)) * 4 + 1] * 0.587 + data[(y * canvas.width + (x + 1)) * 4 + 2] * 0.114);
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

            if (detections.length === 1) {
              const { box } = detections[0].detection;
              const landmarks = detections[0].landmarks;
              const nose = landmarks.getNose()[0];

              // Desenhar oval
              const oval = document.createElement('div');
              oval.classList.add('face-oval');
              oval.style.left = `${box.x - box.width * 0.3}px`;
              oval.style.top = `${box.y - box.height * 0.6}px`;
              oval.style.width = `${box.width * 1.6}px`;
              oval.style.height = `${box.height * 2.2}px`;
              faceOverlay.appendChild(oval);

              // Verificar posicionamento
              const videoWidth = faceVideo.videoWidth;
              const videoHeight = faceVideo.videoHeight;
              const centerX = videoWidth / 2;
              const centerY = videoHeight / 2;
              const distanceToCenter = Math.sqrt((nose.x - centerX) ** 2 + (nose.y - centerY) ** 2);

              if (distanceToCenter < videoWidth * 0.15 && box.width > videoWidth * 0.3) {
                oval.style.borderColor = '#22c55e'; // Verde
                oval.classList.add('pulse');
                faceFeedback.textContent = 'Rosto posicionado! Verificando nitidez...';
                faceFeedback.classList.remove('hidden');

                // Verificar nitidez
                tempCtx.drawImage(faceVideo, 0, 0);
                const sharpness = calculateSharpness(tempCanvas, tempCtx);

                if (sharpness > 80) { // Limiar ajustado para maior sensibilidade
                  faceFeedback.textContent = 'Imagem nítida! Capturando...';
                  isCapturing = true;
                  clearInterval(detectionInterval);
                  startCountdown();
                } else {
                  faceFeedback.textContent = 'Imagem desfocada. Ajuste a iluminação.';
                }
              } else {
                oval.style.borderColor = '#10b981'; // Cor padrão
                oval.classList.remove('pulse');
                faceFeedback.textContent = 'Centralize o rosto no oval.';
                faceFeedback.classList.remove('hidden');
              }
            } else {
              faceFeedback.textContent = detections.length === 0 ? 'Nenhum rosto detectado.' : 'Apenas um rosto permitido.';
              faceFeedback.classList.remove('hidden');
            }
          }
        }, 200); // Intervalo otimizado
      });
    } catch (error) {
      showToast('Erro ao acessar a câmera. Verifique permissões ou dispositivos.', 'error');
      console.error('Erro na câmera:', error);
    }
  }

  // Contagem regressiva
  function startCountdown() {
    let countdown = 2; // Reduzido para 2s
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
    faceCanvas.getContext('2d').drawImage(faceVideo, 0, 0);
    const imageData = faceCanvas.toDataURL('image/jpeg', 0.9); // Qualidade JPEG otimizada
    confirmationImage.src = imageData;
    confirmationModal.classList.remove('hidden');
    stopStream();
    faceVideo.classList.add('hidden');
    faceOverlay.innerHTML = '';
    faceInstructions.classList.add('hidden');
    faceFeedback.classList.add('hidden');
    isCapturing = false;
  }

  // Modal
  retakeButton.addEventListener('click', () => {
    confirmationModal.classList.add('hidden');
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
