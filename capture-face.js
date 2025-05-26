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
      console.log('Stream da câmera fechado');
    }
  }

  function initParticles() {
    console.log('Inicializando particles.js');
    if (typeof particlesJS === 'undefined') {
      console.error('particles.js não carregado');
      showToast('Erro: Partículas não carregadas. Verifique a conexão.', 'error');
      return;
    }
    particlesJS('particles-js', {
      particles: {
        number: { value: 100, density: { enable: true, value_area: 800 } },
        color: { value: '#10b981' },
        shape: { type: 'circle' },
        opacity: { value: 0.5, random: true },
        size: { value: 3, random: true },
        line_linked: { enable: false },
        move: {
          enable: true,
          speed: 6,
          direction: 'none',
          random: true,
          straight: false,
          out_mode: 'out',
          bounce: false
        }
      },
      interactivity: {
        detect_on: 'canvas',
        events: { onhover: { enable: false }, onclick: { enable: false }, resize: true },
      },
      retina_detect: true
    });
    console.log('particles.js inicializado');
  }

  async function loadModels() {
    const path = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/';
    try {
      console.log(`Carregando modelos de: ${path}`);
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(path),
        faceapi.nets.faceLandmark68Net.loadFromUri(path)
      ]);
      console.log('Modelos carregados');
      showToast('Modelos carregados com sucesso!', 'success');
      return true;
    } catch (error) {
      console.error('Erro ao carregar modelos:', error);
      throw new Error(`Falha ao carregar modelos: ${error.message}`);
    }
  }

  async function startFaceCapture() {
    try {
      stopStream();
      faceVideo.srcObject = null;
      faceVideo.classList.add('hidden');
      isCapturing = false;
      detectionActive = false;

      const constraints = {
        video: {
          width: { min: 640, ideal: 1280, max: 1920 },
          height: { min: 480, ideal: 720, max: 1080 },
          facingMode: 'user' // Removido 'exact' para maior compatibilidade
        }
      };

      console.log('Solicitando acesso à câmera:', constraints);
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      faceVideo.srcObject = stream;
      faceVideo.classList.remove('hidden');
      faceVideo.classList.add('fullscreen-video');
      faceInstructions.classList.remove('hidden');

      // Criar botão de captura
      if (!captureButton) {
        captureButton = document.createElement('button');
        captureButton.classList.add('capture-button', 'disabled');
        captureButton.textContent = '';
        document.body.appendChild(captureButton);
        captureButton.addEventListener('click', () => {
          if (faceDetected && !captureButton.classList.contains('disabled')) {
            isCapturing = true;
            detectionActive = false;
            captureButton.classList.add('disabled');
            startCountdown();
          } else {
            showToast('Alinhe o rosto antes de capturar.', 'error');
          }
        });
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
        faceVideo.onerror = () => {
          reject(new Error('Erro ao carregar vídeo'));
        };
      });

      faceVideo.play().then(() => {
        console.log('Vídeo iniciado');
        detectionActive = true;
        detectFaces();
      }).catch(error => {
        console.error('Erro ao reproduzir vídeo:', error);
        showToast('Erro ao iniciar vídeo. Verifique permissões.', 'error');
        faceVideo.classList.add('hidden');
        stopStream();
      });
    } catch (error) {
      console.error('Erro ao iniciar câmera:', error);
      let errorMessage = 'Erro ao acessar a câmera. Permita o acesso e tente novamente.';
      if (error.name === 'NotAllowedError') {
        errorMessage = 'Permissão de câmera negada. Habilite nas configurações do navegador.';
      } else if (error.name === 'NotFoundError') {
        errorMessage = 'Nenhuma câmera encontrada. Conecte uma câmera.';
      }
      showToast(errorMessage, 'error');
      faceVideo.classList.add('hidden');
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
      const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.3 });
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
      const ovalStyle = getComputedStyle(oval);
      const ovalWidth = parseFloat(ovalStyle.width);
      const ovalHeight = parseFloat(ovalStyle.height);
      const ovalCenterX = screenWidth / 2;
      const ovalCenterY = screenHeight / 2;

      if (window.pJSDom && window.pJSDom.length) {
        window.pJSDom[0].pJS.fn.particlesEmpty();
        console.log('Partículas limpas');
      }

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

        if (distanceToOval < maxDistance && box.width > videoWidth * 0.03) {
          alignedFrames++;
          faceFeedback.innerHTML = '✅ Rosto alinhado!';
          faceFeedback.classList.remove('hidden');
          captureButton.classList.remove('disabled');
          captureButton.classList.add('enabled');
          faceDetected = true;

          if (alignedFrames >= 3) {
            oval.classList.add('aligned');
            if (!window.pJSDom || !window.pJSDom.length) {
              initParticles();
            }
            const sharpness = calculateSharpness(tempCanvas, tempCtx, box);
            if (sharpness > 0.03) {
              faceFeedback.innerHTML = '📸 Capturando...';
              isCapturing = true;
              detectionActive = false;
              captureButton.classList.add('disabled');
              startCountdown();
              return;
            } else {
              faceFeedback.innerHTML = `🌫️ Imagem não nítida (${sharpness.toFixed(2)})`;
            }
          }
        } else {
          alignedFrames = 0;
          oval.classList.remove('aligned');
          faceFeedback.innerHTML = distanceToOval >= maxDistance ? '↔️ Alinhe o rosto no oval' : '🔍 Aproxime o rosto';
          faceFeedback.classList.remove('hidden');
          captureButton.classList.add('disabled');
          captureButton.classList.remove('enabled');
          faceDetected = false;
        }
      } else {
        alignedFrames = 0;
        oval.classList.remove('aligned');
        faceFeedback.innerHTML = detections.length === 0 ? '😶 Nenhum rosto detectado' : '⚠️ Apenas um rosto';
        faceFeedback.classList.remove('hidden');
        captureButton.classList.add('disabled');
        captureButton.classList.remove('enabled');
        faceDetected = false;
      }
    } catch (error) {
      console.error('Erro na detecção:', error);
      showToast('Erro na detecção facial.', 'error');
    }

    if (detectionActive) {
      setTimeout(detectFaces, 100);
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
      showToast('Erro na análise de imagem.', 'error');
      return 0;
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
      const imageData = faceCanvas.toDataURL('image/jpeg', 0.95);
      if (!imageData || imageData === 'data:,') {
        throw new Error('Imagem inválida');
      }
      confirmationImage.src = imageData;
      confirmationModal.classList.remove('hidden');
      console.log('Foto capturada');
      if (window.pJSDom && window.pJSDom.length) {
        window.pJSDom[0].pJS.fn.particlesEmpty();
        console.log('Partículas limpas após captura');
      }
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
    isCapturing = false;
  }

  retakeButton.addEventListener('click', () => {
    confirmationModal.classList.add('hidden');
    confirmationImage.src = '';
    faceVideo.classList.remove('hidden');
    console.log('Fechando modal');
    startFaceCapture();
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
    startFaceCapture();
  });

  confirmationImage.addEventListener('click', () => {
    confirmationImage.classList.toggle('zoomed');
    console.log('Zoom da imagem alterado');
  });

  modelLoading.classList.remove('hidden');
  try {
    await loadModels();
    modelLoading.classList.add('hidden');
    startFaceCapture();
  } catch (error) {
    modelLoading.classList.add('hidden');
    showToast('Erro ao carregar modelos de detecção.', 'error');
    console.error('Erro ao carregar modelos:', error);
  }
});
