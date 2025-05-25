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
  let faceDetected = false;
  let countdownInterval = null;
  let isCapturing = false;

  // Função para carregar modelos com fallback
  async function loadModels() {
    const paths = ['./weights', '/weights'];
    for (const path of paths) {
      try {
        console.log(`Tentando carregar modelos de: ${path}`);
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(path),
          faceapi.nets.faceLandmark68Net.loadFromUri(path),
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

  // Carregar modelos
  modelLoading.classList.remove('hidden');
  try {
    await loadModels();
    modelLoading.classList.add('hidden');
    startFaceCapture();
  } catch (error) {
    modelLoading.classList.add('hidden');
    showToast('Erro ao carregar os modelos de detecção facial. Verifique se os arquivos tiny_face_detector_model-shard1 e face_landmark_68_model-shard1 estão na pasta weights.', 'error');
    console.error('Erro final ao carregar modelos:', error);
    return;
  }

  // Função para calcular nitidez (variância de Laplacian)
  function calculateSharpness(canvas, ctx) {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    let laplacianSum = 0;
    let count = 0;

    // Converter para escala de cinza e calcular Laplacian
    for (let y = 1; y < canvas.height - 1; y++) {
      for (let x = 1; x < canvas.width - 1; x++) {
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
    return laplacianSum / count;
  }

  async function startFaceCapture() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      faceVideo.srcObject = stream;
      faceVideo.classList.remove('hidden');
      faceVideo.classList.add('fullscreen-video');
      faceInstructions.classList.remove('hidden');

      // Configurar canvas temporário para nitidez
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');

      // Detecção facial
      faceVideo.addEventListener('play', async () => {
        const detectionInterval = setInterval(async () => {
          if (!faceVideo.paused && !faceVideo.ended && !isCapturing) {
            const detections = await faceapi.detectAllFaces(faceVideo, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks();
            faceOverlay.innerHTML = '';

            if (detections.length === 1) {
              const detection = detections[0];
              const box = detection.detection.box;
              const landmarks = detection.landmarks;
              const nose = landmarks.getNose()[0];

              const oval = document.createElement('div');
              oval.classList.add('face-oval');
              oval.style.left = `${box.x - box.width * 0.2}px`;
              oval.style.top = `${box.y - box.height * 0.5}px`;
              oval.style.width = `${box.width * 1.4}px`;
              oval.style.height = `${box.height * 2}px`;
              faceOverlay.appendChild(oval);

              // Verificar se o rosto está centralizado
              const videoWidth = faceVideo.videoWidth;
              const videoHeight = faceVideo.videoHeight;
              const centerX = videoWidth / 2;
              const centerY = videoHeight / 2;
              const distanceToCenter = Math.sqrt((nose.x - centerX) ** 2 + (nose.y - centerY) ** 2);

              if (distanceToCenter < videoWidth * 0.15 && box.width > videoWidth * 0.3) {
                faceFeedback.textContent = 'Rosto bem posicionado! Verificando nitidez...';
                faceFeedback.classList.remove('hidden');
                faceDetected = true;

                // Verificar nitidez
                tempCanvas.width = videoWidth;
                tempCanvas.height = videoHeight;
                tempCtx.drawImage(faceVideo, 0, 0);
                const sharpness = calculateSharpness(tempCanvas, tempCtx);

                if (sharpness > 100) { // Limiar de nitidez (ajustável)
                  faceFeedback.textContent = 'Imagem nítida! Preparando captura...';
                  isCapturing = true;
                  clearInterval(detectionInterval);
                  startCountdown();
                } else {
                  faceFeedback.textContent = 'Imagem desfocada. Ajuste a iluminação ou aproxime-se da câmera.';
                }
              } else {
                faceFeedback.textContent = 'Ajuste o rosto ao centro do oval.';
                faceFeedback.classList.remove('hidden');
                faceDetected = false;
              }
            } else {
              faceFeedback.textContent = detections.length === 0 ? 'Nenhum rosto detectado.' : 'Apenas um rosto deve ser detectado.';
              faceFeedback.classList.remove('hidden');
              faceDetected = false;
            }
          }
        }, 100);
      });
    } catch (error) {
      showToast('Erro ao acessar a câmera. Verifique as permissões.', 'error');
      console.error('Erro na captura:', error);
    }
  }

  // Contagem regressiva
  function startCountdown() {
    let countdown = 3;
    countdownElement.textContent = countdown;
    countdownElement.classList.remove('hidden');

    countdownInterval = setInterval(() => {
      countdown--;
      if (countdown > 0) {
        countdownElement.textContent = countdown;
      } else {
        clearInterval(countdownInterval);
        countdownElement.classList.add('hidden');
        captureFace();
      }
    }, 1000);
  }

  // Capturar foto
  function captureFace() {
    faceCanvas.width = faceVideo.videoWidth;
    faceCanvas.height = faceVideo.videoHeight;
    faceCanvas.getContext('2d').drawImage(faceVideo, 0, 0);
    const imageData = faceCanvas.toDataURL('image/jpeg');
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
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 3000);
  }

  function stopStream() {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }
  }
});
