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

  // Carregar modelos do face-api.js
  modelLoading.classList.remove('hidden');
  try {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri('https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights'),
      faceapi.nets.faceLandmark68Net.loadFromUri('https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights'),
    ]);
    modelLoading.classList.add('hidden');
    startFaceCapture();
  } catch (error) {
    showToast('Erro ao carregar os modelos de detecção facial.', 'error');
    modelLoading.classList.add('hidden');
    console.error(error);
  }

  async function startFaceCapture() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      faceVideo.srcObject = stream;
      faceVideo.classList.remove('hidden');
      faceVideo.classList.add('fullscreen-video');
      faceInstructions.classList.remove('hidden');

      const captureButton = document.createElement('button');
      captureButton.classList.add('capture-button');
      document.body.appendChild(captureButton);

      // Detecção facial
      faceVideo.addEventListener('play', async () => {
        const detectionInterval = setInterval(async () => {
          if (!faceVideo.paused && !faceVideo.ended) {
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
                faceFeedback.textContent = 'Rosto bem posicionado!';
                faceFeedback.classList.remove('hidden');
                captureButton.classList.add('enabled');
                faceDetected = true;
              } else {
                faceFeedback.textContent = 'Ajuste o rosto ao centro do oval.';
                faceFeedback.classList.remove('hidden');
                captureButton.classList.remove('enabled');
                faceDetected = false;
              }
            } else {
              faceFeedback.textContent = detections.length === 0 ? 'Nenhum rosto detectado.' : 'Apenas um rosto deve ser detectado.';
              faceFeedback.classList.remove('hidden');
              captureButton.classList.remove('enabled');
              faceDetected = false;
            }
          }
        }, 100);

        captureButton.addEventListener('click', () => {
          if (faceDetected) {
            clearInterval(detectionInterval);
            startCountdown();
          } else {
            showToast('Posicione o rosto corretamente antes de capturar.', 'Ovalide a posição do rosto antes de continuar.');
          }
        });
      });

      // Contagem regressiva
      function startCountdown() {
        let countdown = 2;
        countdownElement.textContent = countdown;
        countdownElement.classList.remove('countdown');
        captureButton.classList.add('disabled');

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
        faceOverlay.classList.add('hidden');
        faceInstructions.classList.add('hidden');
        faceFeedback.classList.add('hidden');
        captureButton.remove();
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

      closeModal.addEventListener('click', () => {
        confirmationModal.classList.add('hidden');
        startFaceCapture();
      });

      confirmationImage.addEventListener('click', () => {
        confirmationImage.classList.toggle('zoomed');
      });
    } catch (error) {
      showToast('Erro ao acessar a câmera. Verifique as permissões.', 'error');
      console.error(error);
    }
  }

  // Funções auxiliares
  function showToast(message, type) {
    toast.textContent = message;
    toast.classList.add(`toast-${type}`);
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
