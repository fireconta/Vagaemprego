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

  // Carregar modelos
  async function loadModels() {
    const paths = [
      '/Vagaemprego/weights',
      './weights',
      '/weights',
      './assets/weights',
      'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights'
    ];
    for (const path of paths) {
      try {
        console.log(`Carregando modelos de: ${path}`);
        await Promise.all([
          faceapi.nets.ssdMobilenetv1.loadFromUri(path),
          faceapi.nets.faceLandmark68Net.loadFromUri(path),
          faceapi.nets.faceRecognitionNet.loadFromUri(path)
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
    setTimeout(startFaceCapture, 1000); // Atraso para garantir inicialização
  } catch (error) {
    modelLoading.classList.add('hidden');
    showToast('Erro ao carregar modelos. Verifique a pasta weights ou conexão.', 'error');
    console.error('Erro ao carregar modelos:', error);
    return;
  }

  // Calcular nitidez
  function calculateSharpness(canvas, ctx, box) {
    const regionSize = Math.min(box.width, box.height) * 0.6;
    const x = Math.max(0, box.x + box.width / 2 - regionSize / 2);
    const y = Math.max(0, box.y + box.height / 2 - regionSize / 2);
    try {
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
      console.log(`Nitidez calculada: ${sharpness}`);
      return sharpness;
    } catch (error) {
      console.error('Erro ao calcular nitidez:', error);
      showToast('Erro na análise de nitidez.', 'error');
      return 0;
    }
  }

  // Iniciar captura
  async function startFaceCapture() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');
      let constraints = { video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } };

      if (videoDevices.length > 0) {
        const frontCamera = videoDevices.find(device => device.label.toLowerCase().includes('front')) || videoDevices[0];
        constraints.video.deviceId = { exact: frontCamera.deviceId };
      }

      stream = await navigator.mediaDevices.getUserMedia(constraints);
      faceVideo.srcObject = stream;
      faceVideo.classList.remove('hidden');
      faceInstructions.classList.remove('hidden');

      // Criar oval imediatamente
      faceOverlay.innerHTML = '';
      const oval = document.createElement('div');
      oval.classList.add('face-oval');
      faceOverlay.appendChild(oval);

      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');

      faceVideo.addEventListener('play', () => {
        if (faceVideo.readyState < 2 || faceVideo.videoWidth === 0 || faceVideo.videoHeight === 0) {
          console.error('Vídeo não está pronto ou dimensões inválidas');
          showToast('Erro na câmera. Tente novamente.', 'error');
          stopStream();
          return;
        }

        tempCanvas.width = faceVideo.videoWidth;
        tempCanvas.height = faceVideo.videoHeight;
        detectionActive = true;
        detectFaces();
      });
    } catch (error) {
      showToast('Erro ao acessar a câmera. Verifique permissões.', 'error');
      console.error('Erro na câmera:', error);
    }
  }

  // Detecção de rosto com requestAnimationFrame
  async function detectFaces() {
    if (!detectionActive || faceVideo.paused || faceVideo.ended || isCapturing) {
      return;
    }

    try {
      if (!faceapi.nets.ssdMobilenetv1.isLoaded || !faceapi.nets.faceLandmark68Net.isLoaded || !faceapi.nets.faceRecognitionNet.isLoaded) {
        throw new Error('Modelos não carregados');
      }

      const options = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 });
      const detections = await faceapi.detectAllFaces(faceVideo, options).withFaceLandmarks().withFaceDescriptors();
      console.log(`Detecções: ${detections.length}`);

      if (detections.length === 1) {
        const { box } = detections[0].detection;
        const landmarks = detections[0].landmarks;
        const descriptor = detections[0].descriptor;
        const nose = landmarks.getNose()[0];

        if (!descriptor || descriptor.length === 0) {
          throw new Error('Descritor de rosto inválido');
        }

        const videoWidth = faceVideo.videoWidth;
        const videoHeight = faceVideo.videoHeight;
        const centerX = videoWidth / 2;
        const centerY = videoHeight / 2;
        const distanceToCenter = Math.sqrt((nose.x - centerX) ** 2 + (nose.y - centerY) ** 2);

        console.log(`Distância ao centro: ${distanceToCenter}, Largura da caixa: ${box.width}`);

        if (distanceToCenter < videoWidth * 0.25 && box.width > videoWidth * 0.08) {
          alignedFrames++;
          faceOverlay.firstChild.classList.add('aligned');
          faceFeedback.innerHTML = '✅ Rosto alinhado!';
          faceFeedback.classList.remove('hidden');

          if (alignedFrames >= 1) {
            tempCtx.drawImage(faceVideo, 0, 0);
            const sharpness = calculateSharpness(tempCanvas, tempCtx, box);

            if (sharpness > 15 && Date.now() - lastCaptureTime > 2000) {
              faceFeedback.innerHTML = '📸 Capturando...';
              isCapturing = true;
              detectionActive = false;
              startCountdown();
              return;
            } else {
              faceFeedback.innerHTML = '🌫️ Iluminação fraca, aproxime-se de uma luz';
            }
          }
        } else {
          alignedFrames = 0;
          faceOverlay.firstChild.classList.remove('aligned');
          faceFeedback.innerHTML = distanceToCenter >= videoWidth * 0.25 ? '↔️ Ajuste a posição' : '🔍 Aproxime o rosto';
          faceFeedback.classList.remove('hidden');
        }
      } else {
        alignedFrames = 0;
        faceOverlay.firstChild.classList.remove('aligned');
        faceFeedback.innerHTML = detections.length === 0 ? '😶 Nenhum rosto detectado' : '⚠️ Apenas um rosto';
        faceFeedback.classList.remove('hidden');
      }
    } catch (error) {
      console.error('Erro na detecção:', error);
      showToast('Erro na detecção de rosto. Tente novamente.', 'error');
      faceFeedback.innerHTML = '⚠️ Erro na detecção';
      faceFeedback.classList.remove('hidden');
    }

    if (detectionActive) {
      setTimeout(() => requestAnimationFrame(detectFaces), 80);
    }
  }

  // Contagem regressiva
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
    }, 300);
  }

  // Capturar foto
  function captureFace() {
    if (faceVideo.readyState < 2) {
      showToast('Vídeo não está pronto. Tente novamente.', 'error');
      isCapturing = false;
      detectionActive = true;
      detectFaces();
      return;
    }

    faceCanvas.width = faceVideo.videoWidth;
    faceCanvas.height = faceVideo.videoHeight;
    const ctx = faceCanvas.getContext('2d');

    ctx.drawImage(faceVideo, 0, 0, faceCanvas.width, faceCanvas.height);

    try {
      const imageData = faceCanvas.toDataURL('image/jpeg', 0.9);
      if (!imageData || imageData === 'data:,') {
        throw new Error('Imagem vazia gerada');
      }
      confirmationImage.src = imageData;
      confirmationModal.classList.remove('hidden');
    } catch (error) {
      console.error('Erro ao gerar imagem:', error);
      showToast('Falha ao capturar a imagem. Tente novamente.', 'error');
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
    setTimeout(() => toast.classList.add('hidden'), 3000);
  }

  function stopStream() {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }
  }
});
