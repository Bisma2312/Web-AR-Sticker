(async function () {
  const qs = new URLSearchParams(location.search);
  const id = qs.get('id');
  const t = qs.get('t');
  const cam = qs.get('cam'); // 'front' | 'rear'
  const useRear = cam === 'rear';
  const imgUrl = id && t ? `/api/image/${id}?t=${t}` : null;

  // Debug logging for troubleshooting
  console.log('URL Parameters:', { id, t, imgUrl });
  console.log('Current location:', window.location.href);

  const statusEl = document.getElementById('status');
  const container = document.getElementById('ar');
  if (!id || !t) { if (statusEl) statusEl.textContent = 'Missing token'; return; }
  if (!container) { if (statusEl) statusEl.textContent = 'AR container not found'; return; }

  const isMobile = /Android|webOS|iPhone|iPad|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768;
  let currentFacingMode = useRear ? 'environment' : 'user';

  let currentMode = 'photo';
  let isRecording = false;
  let mediaRecorder;
  let recordedBlobs;
  let videoRecordLoop; // Loop untuk menggambar video selama perekaman

  const previewContainer = document.getElementById('preview-container');
  const previewImage = document.getElementById('preview-image');
  const previewVideo = document.getElementById('preview-video');
  const saveButton = document.getElementById('save-button');
  const shareButton = document.getElementById('share-button');
  const closeButton = document.getElementById('close-preview-button');

  const modeToggleBtn = document.getElementById('mode-toggle-btn');
  const captureBtn = document.getElementById('capture-btn');

  async function setupMobileCamera(facingMode = currentFacingMode) {
    if (!isMobile) return true;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera API not available');
      }
      const constraints = { 
        video: { 
          facingMode: { ideal: facingMode },
          width: { ideal: 640, max: 1280 },
          height: { ideal: 480, max: 720 }
        } 
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const settings = videoTrack.getSettings();
        console.log('Camera settings:', settings);
        console.log('Requested facing mode:', facingMode, 'Actual:', settings.facingMode);
      }
      stream.getTracks().forEach(track => track.stop());
      return true;
    } catch (error) {
      console.error('Mobile camera setup failed:', error);
      if (statusEl) statusEl.textContent = `Camera ${facingMode} not available: ${error.message}`;
      return false;
    }
  }

  function checkWebGLSupport() {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) {
        throw new Error('WebGL not supported');
      }
      return true;
    } catch (e) {
      console.error('WebGL not supported:', e);
      return false;
    }
  }

  if (!checkWebGLSupport()) {
    if (statusEl) statusEl.textContent = 'WebGL not supported';
    return;
  }

  if (!window.MINDAR || !window.MINDAR.FACE || !window.MINDAR.FACE.MindARThree) {
    if (statusEl) statusEl.textContent = 'AR library not loaded';
    console.error('MindAR library not available');
    return;
  }

  let mindarThree, renderer, scene, camera;
  let watermarkMesh;

  async function setupWatermark() {
    try {
      const watermarkTexture = await new THREE.TextureLoader().loadAsync('/assets/logo-watermark.png');
      watermarkTexture.encoding = THREE.sRGBEncoding;

      const watermarkMaterial = new THREE.MeshBasicMaterial({
        map: watermarkTexture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });

      const aspectRatio = watermarkTexture.image.width / watermarkTexture.image.height;
      const displayWidth = 0.3;
      const displayHeight = displayWidth / aspectRatio;

      const watermarkGeometry = new THREE.PlaneGeometry(displayWidth, displayHeight);
      watermarkMesh = new THREE.Mesh(watermarkGeometry, watermarkMaterial);
      watermarkMesh.visible = true;

      const positionX = 0;
      const positionY = -0.35;
      const positionZ = -1;
      watermarkMesh.position.set(positionX, positionY, positionZ);

      watermarkMesh.renderOrder = 999;
      scene.add(watermarkMesh);
      
      console.log('Watermark setup complete and positioned center.');

    } catch (error) {
      console.error('Failed to load or setup watermark:', error);
      if (statusEl) statusEl.textContent = 'Failed to load watermark.';
    }
  }

  async function disposeCurrent(){
    try {
      if (renderer && renderer.setAnimationLoop) renderer.setAnimationLoop(null);
    } catch(_){}
    try {
      if (mindarThree && mindarThree.video) {
        const video = mindarThree.video;
        if (video.srcObject && typeof video.srcObject.getTracks === 'function') {
          video.srcObject.getTracks().forEach(track => track.stop());
        }
        video.srcObject = null;
      }
    } catch(e) {
      console.warn('Error stopping video tracks:', e);
    }
    try { 
      if (mindarThree && typeof mindarThree.stop === 'function') await mindarThree.stop(); 
    } catch(_){}
    try { if (renderer && renderer.dispose) renderer.dispose(); } catch(_){}
    try { if (container) { while (container.firstChild) container.removeChild(container.firstChild); } } catch(_){}
  }

  async function restartAR(nextFacingMode){
    try {
      if (statusEl) statusEl.textContent = 'Switching camera...';
      const targetFacingMode = nextFacingMode || currentFacingMode;
      if (isMobile) {
        const cameraReady = await setupMobileCamera(targetFacingMode);
        if (!cameraReady) {
          if (statusEl) statusEl.textContent = `Cannot switch to ${targetFacingMode} camera`;
          return false;
        }
      }
      const snap = snapshotInstances();
      await disposeCurrent();
      await new Promise(resolve => setTimeout(resolve, 500));
      currentFacingMode = targetFacingMode;
      
      const mindarConfig2 = {
        container, maxFaces: 1, faceIndex: 0, uiScanning: false, uiLoading: false, uiError: false,
        camera: {
          facingMode: { ideal: currentFacingMode },
          width: { ideal: isMobile ? 640 : 1280 },
          height: { ideal: isMobile ? 480 : 720 },
          aspectRatio: { ideal: 4/3 }
        }
      };
      
      mindarThree = new window.MINDAR.FACE.MindARThree(mindarConfig2);
      ({ renderer, scene, camera } = mindarThree);
      if (!renderer || !scene || !camera) {
        throw new Error('MindAR failed to initialize after camera switch');
      }

      const light2 = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
      scene.add(light2);

      await mindarThree.start();
      if (mindarThree.video && isMobile) {
        const video = mindarThree.video;
        video.setAttribute('playsinline', ''); video.playsInline = true; video.muted = true; video.autoplay = true;
        video.style.objectFit = 'cover';
      }
      try {
        const maxDpr = 2;
        if (renderer && renderer.setPixelRatio) {
          renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, maxDpr));
        }
      } catch(_){}

      await rebuildInstancesFromSnapshot(snap);
      if (renderer && renderer.setAnimationLoop) {
        renderer.setAnimationLoop(() => {
          try {
            renderer.render(scene, camera);
            updateSelectionOverlay();
            updateStickerPositions();
          }
          catch (error) {
            console.error('Render loop error:', error);
            if (statusEl) statusEl.textContent = 'Render error occurred';
          }
        });
      }

      if (statusEl) statusEl.textContent = `Camera switched to ${currentFacingMode} - Tracking face...`;
      console.log('Camera switch successful:', currentFacingMode);
      return true;
    } catch (error) {
      console.error('Camera switch failed:', error);
      if (statusEl) statusEl.textContent = `Camera switch failed: ${error.message}`;
      return false;
    }
  }

  const camBtn = document.getElementById('cam-btn');
  if (camBtn) {
    function updateLabel(){ camBtn.textContent = (currentFacingMode === 'environment') ? 'Front Cam' : 'Rear Cam'; }
    updateLabel();
    camBtn.addEventListener('click', async () => {
      if (camBtn.disabled) return;
      try { camBtn.disabled = true; camBtn.textContent = 'Switching...'; } catch(_){}
      const next = (currentFacingMode === 'environment') ? 'user' : 'environment';
      console.log('Attempting camera switch from', currentFacingMode, 'to', next);
      const success = await restartAR(next);
      if (success) { updateLabel(); console.log('Camera switch completed successfully'); } else { updateLabel(); console.warn('Camera switch failed, staying on', currentFacingMode); }
      try { camBtn.disabled = false; } catch(_){}
    });
  }
})();