document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('jobForm');
  const submitButton = document.getElementById('submitButton');
  const toggleHelp = document.getElementById('toggleHelp');
  const helpSection = document.getElementById('helpSection');
  const captureDocumentPhoto = document.getElementById('captureDocumentPhoto');
  const documentVideo = document.getElementById('document-video');
  const documentCanvas = document.getElementById('document-canvas');
  const documentPhotoPreview = document.getElementById('documentPhotoPreview');
  const documentPhotoInput = document.getElementById('documentPhoto');
  const captureFacePhoto = document.getElementById('captureFacePhoto');
  const uploadFacePhoto = document.getElementById('uploadFacePhoto');
  const facePhotoPreview = document.getElementById('facePhotoPreview');
  const toast = document.getElementById('toast');
  const fullscreenPreview = document.getElementById('fullscreenPreview');
  const previewImage = document.getElementById('previewImage');
  const closePreview = fullscreenPreview.querySelector('.close');

  let documentPhotoFile = null;
  let facePhotoFile = null;

  // Carregar foto de rosto do sessionStorage, se existir
  const savedFacePhoto = sessionStorage.getItem('facePhoto');
  if (savedFacePhoto) {
    facePhotoPreview.src = savedFacePhoto;
    facePhotoPreview.classList.remove('hidden');
    fetch(savedFacePhoto)
      .then(res => res.blob())
      .then(blob => {
        facePhotoFile = new File([blob], 'face-photo.jpg', { type: 'image/jpeg' });
        checkFormValidity();
      });
    sessionStorage.removeItem('facePhoto'); // Limpar após uso
  }

  // Toggle Help Section
  toggleHelp.addEventListener('click', () => {
    const isCollapsed = helpSection.classList.contains('collapsed');
    helpSection.classList.toggle('collapsed', !isCollapsed);
    toggleHelp.setAttribute('aria-expanded', isCollapsed);
    helpSection.style.maxHeight = isCollapsed ? `${helpSection.scrollHeight}px` : '0';
    helpSection.style.padding = isCollapsed ? '1.5rem' : '0';
    helpSection.style.marginTop = isCollapsed ? '1rem' : '0';
  });

  // Redirecionar para página de captura de rosto
  captureFacePhoto.addEventListener('click', () => {
    window.location.href = 'capture-face.html?return=index.html';
  });

  // Upload de foto de rosto
  uploadFacePhoto.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file && ['image/jpeg', 'image/png'].includes(file.type)) {
      if (file.size > 5 * 1024 * 1024) {
        showToast('A imagem deve ter no máximo 5MB.', 'error');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        facePhotoPreview.src = reader.result;
        facePhotoPreview.classList.remove('hidden');
        facePhotoFile = file;
        checkFormValidity();
      };
      reader.readAsDataURL(file);
    } else {
      showToast('Por favor, selecione uma imagem JPEG ou PNG.', 'error');
    }
  });

  // Captura de foto do documento
  captureDocumentPhoto.addEventListener('click', async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      documentVideo.srcObject = stream;
      documentVideo.classList.remove('hidden');
      documentVideo.classList.add('fullscreen-video');
      const captureButton = document.createElement('button');
      captureButton.classList.add('capture-button');
      document.body.appendChild(captureButton);

      captureButton.addEventListener('click', () => {
        documentCanvas.width = documentVideo.videoWidth;
        documentCanvas.height = documentVideo.videoHeight;
        documentCanvas.getContext('2d').drawImage(documentVideo, 0, 0);
        const imageData = documentCanvas.toDataURL('image/jpeg');
        documentPhotoPreview.src = imageData;
        documentPhotoPreview.classList.remove('hidden');
        documentCanvas.toBlob((blob) => {
          documentPhotoFile = new File([blob], 'document-photo.jpg', { type: 'image/jpeg' });
          checkFormValidity();
        }, 'image/jpeg');
        stopStream(stream);
        documentVideo.classList.add('hidden');
        captureButton.remove();
      });
    } catch (error) {
      showToast('Erro ao acessar a câmera. Verifique as permissões.', 'error');
      console.error(error);
    }
  });

  // Upload de foto do documento
  documentPhotoInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file && ['image/jpeg', 'image/png'].includes(file.type)) {
      if (file.size > 5 * 1024 * 1024) {
        showToast('A imagem deve ter no máximo 5MB.', 'error');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        documentPhotoPreview.src = reader.result;
        documentPhotoPreview.classList.remove('hidden');
        documentPhotoFile = file;
        checkFormValidity();
      };
      reader.readAsDataURL(file);
    } else {
      showToast('Por favor, selecione uma imagem JPEG ou PNG.', 'error');
    }
  });

  // Visualizar imagem ampliada
  [documentPhotoPreview, facePhotoPreview].forEach((img) => {
    img.addEventListener('click', () => {
      previewImage.src = img.src;
      fullscreenPreview.classList.remove('hidden');
    });
  });

  closePreview.addEventListener('click', () => {
    fullscreenPreview.classList.add('hidden');
  });

  // Validação do formulário
  form.addEventListener('input', checkFormValidity);
  form.addEventListener('change', checkFormValidity);

  function checkFormValidity() {
    const fullName = document.getElementById('fullName').value.trim();
    const birthDate = document.getElementById('birthDate').value;
    const email = document.getElementById('email').value.trim();
    const resume = document.getElementById('resume').files[0];
    const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const isResumeValid = resume && resume.type === 'application/pdf' && resume.size <= 5 * 1024 * 1024;

    const isFormValid = fullName && birthDate && isEmailValid && isResumeValid && facePhotoFile && documentPhotoFile;

    submitButton.disabled = !isFormValid;
    submitButton.classList.toggle('disabled-button', !isFormValid);
  }

  // Envio do formulário
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submitButton.disabled = true;
    submitButton.classList.add('loading');

    const formData = new FormData();
    formData.append('fullName', document.getElementById('fullName').value);
    formData.append('birthDate', document.getElementById('birthDate').value);
    formData.append('email', document.getElementById('email').value);
    formData.append('resume', document.getElementById('resume').files[0]);
    formData.append('facePhoto', facePhotoFile);
    formData.append('documentPhoto', documentPhotoFile);

    try {
      // Simulação de envio
      await new Promise((resolve) => setTimeout(resolve, 2000));
      showToast('Cadastro enviado com sucesso!', 'success');
      form.reset();
      documentPhotoPreview.classList.add('hidden');
      facePhotoPreview.classList.add('hidden');
      facePhotoFile = null;
      documentPhotoFile = null;
      checkFormValidity();
    } catch (error) {
      showToast('Erro ao enviar o cadastro. Tente novamente.', 'error');
    } finally {
      submitButton.disabled = false;
      submitButton.classList.remove('loading');
    }
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

  function stopStream(stream) {
    stream.getTracks().forEach(track => track.stop());
  }
});
