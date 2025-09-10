// AR Viewer with in-AR sticker editing via direct tap and overlay handles
(async function(){
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

  // Mobile detection and viewport adjustment (moved to top)
  const isMobile = /Android|webOS|iPhone|iPad|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
                   window.innerWidth <= 768;
  const rotationSign = -1;
  let currentFacingMode = useRear ? 'environment' : 'user';
  
  let currentMode = 'photo';
  let isRecording = false;
  let mediaRecorder;
  let recordedBlobs;
  let recordingCanvas; // Kanvas untuk menggabungkan video dan AR
  let recordingCtx;
  let videoRecordLoop; // Loop untuk menggambar video selama perekaman

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

  if (!window.isSecureContext && location.protocol !== 'https:') {
    if (statusEl) statusEl.textContent = 'HTTPS required for camera access';
    console.error('Secure context required for WebAR');
    return;
  }

  function checkWebGLSupport() {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) {
        throw new Error('WebGL not supported');
      }
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBG_L);
        const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        console.log('WebGL Vendor:', vendor);
        console.log('WebGL Renderer:', renderer);
      }
      const requiredExtensions = ['OES_texture_float', 'OES_standard_derivatives'];
      for (const ext of requiredExtensions) {
        if (!gl.getExtension(ext)) {
          console.warn(`WebGL extension ${ext} not supported`);
        }
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

  // Fungsi untuk memuat dan membuat watermark 3D
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
      
      // Menggunakan renderOrder yang tinggi untuk memastikan selalu di atas
      watermarkMesh.renderOrder = 999;

      scene.add(watermarkMesh);
      
      console.log('Watermark setup complete and positioned center.');

    } catch (error) {
      console.error('Failed to load or setup watermark:', error);
      if (statusEl) statusEl.textContent = 'Failed to load watermark.';
    }
  }
  
  try {
    const mindarConfig = {
      container, maxFaces: 1, faceIndex: 0, uiScanning: false, uiLoading: false, uiError: false,
      camera: {
        facingMode: { ideal: currentFacingMode },
        width: { ideal: isMobile ? 640 : 1280 },
        height: { ideal: isMobile ? 480 : 720 },
        aspectRatio: { ideal: 4/3 }
      }
    };
    mindarThree = new window.MINDAR.FACE.MindARThree(mindarConfig);
    ({ renderer, scene, camera } = mindarThree);
    if (!renderer || !scene || !camera) {
      throw new Error('MindAR failed to initialize properly');
    }
  } catch (error) {
    console.error('MindAR initialization failed:', error);
    if (statusEl) statusEl.textContent = 'AR initialization failed';
    return;
  }

  try {
    const maxDpr = 2;
    if (renderer && renderer.setPixelRatio) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    }
  } catch (_) {}
  
  const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
  scene.add(light);
  camera.add(watermarkMesh);

  function snapshotInstances(){
    const snap = [];
    try {
      Object.values(instances || {}).forEach(inst => {
        snap.push({
          key: inst.key, visible: inst.visible, scale: inst.scale,
          rotation: inst.rotation, offset: { ...(inst.offset || {x:0,y:0}) },
        });
      });
    } catch(_) {}
    return snap;
  }

  async function disposeCurrent(){
    try { if (renderer && renderer.setAnimationLoop) renderer.setAnimationLoop(null); } catch(_){}
    try {
      if (mindarThree && mindarThree.video) {
        const video = mindarThree.video;
        if (video.srcObject && typeof video.srcObject.getTracks === 'function') {
          video.srcObject.getTracks().forEach(track => {
            track.stop();
          });
        }
        video.srcObject = null;
      }
    } catch(e) {
      console.warn('Error stopping video tracks:', e);
    }
    try { if (mindarThree && typeof mindarThree.stop === 'function') await mindarThree.stop(); } catch(_){}
    try { if (renderer && renderer.dispose) renderer.dispose(); } catch(_){}
    try { if (container) { while (container.firstChild) container.removeChild(container.firstChild); } } catch(_){}
  }

  async function rebuildInstancesFromSnapshot(snap){
    for (const s of snap) {
      try {
        const inst = await ensureInstance(s.key);
        if (!inst) continue;
        inst.scale = s.scale; inst.rotation = s.rotation; inst.offset = { ...s.offset };
        applyTransforms(inst); inst.visible = s.visible; inst.mesh.visible = s.visible;
      } catch(e) { console.warn('Rebuild instance failed', s && s.key, e); }
    }
    try { updateSelectionOverlay(); } catch(_){}
  }

  async function restartAR(nextFacingMode){
    try { if (statusEl) statusEl.textContent = 'Switching camera...'; } catch(_){}
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
    try {
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
            if (renderer && scene && camera) {
              renderer.render(scene, camera);
              updateSelectionOverlay();
              updateStickerPositions();
            }
          }
          catch (error) {
            console.error('Render loop error (restart):', error);
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

  try {
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
  } catch(e) { console.error('Error setting up camera button:', e); }

  function takePhoto() {
    if (!mindarThree || !mindarThree.renderer || !mindarThree.renderer.domElement || !mindarThree.video) {
      console.error('Renderer, canvas, or video not available');
      return;
    }
    const glCanvas = mindarThree.renderer.domElement;
    const videoElement = mindarThree.video;

    requestAnimationFrame(() => {
      const offscreenCanvas = document.createElement('canvas');
      offscreenCanvas.width = glCanvas.width;
      offscreenCanvas.height = glCanvas.height;
      const ctx = offscreenCanvas.getContext('2d');

      try {
        const videoRatio = videoElement.videoWidth / videoElement.videoHeight;
        const canvasRatio = offscreenCanvas.width / offscreenCanvas.height;

        let sx, sy, sWidth, sHeight;
        let dx, dy, dWidth, dHeight;

        if (videoRatio > canvasRatio) {
          sHeight = videoElement.videoHeight;
          sWidth = sHeight * canvasRatio;
          sx = (videoElement.videoWidth - sWidth) / 2;
          sy = 0;
        } else {
          sWidth = videoElement.videoWidth;
          sHeight = sWidth / canvasRatio;
          sy = (videoElement.videoHeight - sHeight) / 2;
          sx = 0;
        }
        dx = 0;
        dy = 0;
        dWidth = offscreenCanvas.width;
        dHeight = offscreenCanvas.height;

        ctx.drawImage(videoElement, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight);
        ctx.drawImage(glCanvas, 0, 0);

        const dataURL = offscreenCanvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = dataURL;
        link.download = 'ar-photo.png';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        if (statusEl) statusEl.textContent = 'Photo saved!';
      } catch (error) {
        console.error('Failed to draw canvas or save photo:', error);
        if (statusEl) statusEl.textContent = 'Failed to capture photo. Try again.';
      }
    });
  }
  
  function startVideoRecording() {
    if (!mindarThree || !mindarThree.renderer || !mindarThree.renderer.domElement || !mindarThree.video || isRecording) return;
    
    if (renderer && renderer.setAnimationLoop) renderer.setAnimationLoop(null);

    recordingCanvas = document.createElement('canvas');
    recordingCanvas.width = mindarThree.renderer.domElement.width;
    recordingCanvas.height = mindarThree.renderer.domElement.height;
    recordingCtx = recordingCanvas.getContext('2d');
    
    const stream = recordingCanvas.captureStream(30);
    recordedBlobs = [];
    
    try {
      mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp9' });
    } catch (e) {
      console.error('Exception while creating MediaRecorder:', e);
      if (statusEl) statusEl.textContent = 'Video recording not supported.';
      return;
    }
    
    mediaRecorder.onstop = (event) => {
      console.log('Recorder stopped:', event);
      const superBuffer = new Blob(recordedBlobs, { type: 'video/webm' });
      const videoURL = window.URL.createObjectURL(superBuffer);
      const link = document.createElement('a');
      link.href = videoURL;
      link.download = 'ar-video.webm';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(videoURL);
      if (statusEl) statusEl.textContent = 'Video saved!';

      if (renderer && renderer.setAnimationLoop) {
        renderer.setAnimationLoop(() => {
          renderer.render(scene, camera);
          updateSelectionOverlay();
          updateStickerPositions();
        });
      }
      
      recordingCanvas = null;
      recordingCtx = null;
      if (videoRecordLoop) {
        cancelAnimationFrame(videoRecordLoop);
        videoRecordLoop = null;
      }
    };
    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedBlobs.push(event.data);
      }
    };
    
    const glCanvas = mindarThree.renderer.domElement;
    const videoElement = mindarThree.video;
    
    function drawFrame() {
      renderer.render(scene, camera);
      
      const videoRatio = videoElement.videoWidth / videoElement.videoHeight;
      const canvasRatio = recordingCanvas.width / recordingCanvas.height;

      let sx, sy, sWidth, sHeight;
      let dx, dy, dWidth, dHeight;

      if (videoRatio > canvasRatio) {
        sHeight = videoElement.videoHeight;
        sWidth = sHeight * canvasRatio;
        sx = (videoElement.videoWidth - sWidth) / 2;
        sy = 0;
      } else {
        sWidth = videoElement.videoWidth;
        sHeight = sWidth / canvasRatio;
        sy = (videoElement.videoHeight - sHeight) / 2;
        sx = 0;
      }
      dx = 0;
      dy = 0;
      dWidth = recordingCanvas.width;
      dHeight = recordingCanvas.height;
      
      recordingCtx.drawImage(videoElement, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight);

      recordingCtx.drawImage(glCanvas, 0, 0);

      videoRecordLoop = requestAnimationFrame(drawFrame);
    }
    videoRecordLoop = requestAnimationFrame(drawFrame);

    mediaRecorder.start();
    isRecording = true;
    captureBtn.textContent = '⏹️ Stop';
    if (statusEl) statusEl.textContent = 'Recording...';
    console.log('Video recording started');
  }

  function stopVideoRecording() {
    if (!isRecording || !mediaRecorder) return;
    mediaRecorder.stop();
    isRecording = false;
    captureBtn.textContent = 'Record';
    if (videoRecordLoop) {
      cancelAnimationFrame(videoRecordLoop);
      videoRecordLoop = null;
    }
    console.log('Video recording stopped');
  }

  if (modeToggleBtn) {
    modeToggleBtn.addEventListener('click', () => {
      if (isRecording) { stopVideoRecording(); }
      if (currentMode === 'photo') {
        currentMode = 'video';
        modeToggleBtn.textContent = '📹';
        if (statusEl) statusEl.textContent = 'Mode: Video';
      } else {
        currentMode = 'photo';
        modeToggleBtn.textContent = '📷';
        if (statusEl) statusEl.textContent = 'Mode: Photo';
      }
      console.log('Mode switched to:', currentMode);
      captureBtn.textContent = currentMode === 'photo' ? 'Capture' : 'Record';
    });
  }

  if (captureBtn) {
    captureBtn.addEventListener('click', () => {
      if (currentMode === 'photo') {
        takePhoto();
      } else {
        if (isRecording) { stopVideoRecording(); } else { startVideoRecording(); }
      }
    });
  }

  const loadCanvasTexture = (url) => new Promise((resolve, reject) => {
    const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => {
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const cx = c.getContext('2d'); cx.drawImage(img, 0, 0);
      const tex = new THREE.CanvasTexture(c);
      resolve(tex);
    }; img.onerror = reject; img.src = url;
  });
  
  const preloadImage = (url) => new Promise((resolve, reject) => {
    if (!url) { reject(new Error('No URL provided')); return; }
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => { console.log('Image preloaded successfully:', url); try { preloadedImageCache.set(url, img); } catch (_) {} resolve(img); };
    img.onerror = (error) => { console.error('Failed to preload image:', url, error); reject(new Error('Image load failed')); };
    img.src = url;
  });
  
  const loadImageSafely = async (url) => {
    try { await preloadImage(url); return true; } catch (error) { console.warn('Image load warning:', error); return false; }
  };
  
  const loader = new THREE.TextureLoader();
  if (loader && loader.setCrossOrigin) loader.setCrossOrigin('anonymous');
  if (THREE && THREE.Cache) THREE.Cache.enabled = true;

  const rasterTextureCache = new Map();
  const svgTextureCache = new Map();
  const preloadedImageCache = new Map();

  async function getRasterTextureCached(url) {
    if (rasterTextureCache.has(url)) return rasterTextureCache.get(url);
    let tex;
    let img = preloadedImageCache.get(url);
    if (!img) {
      try { img = await preloadImage(url); } catch (_) { img = null; }
    }
    if (img) {
      tex = new THREE.Texture(img);
      tex.needsUpdate = true;
    } else {
      tex = await new Promise((resolve, reject) => {
        const t = loader.load(url, () => resolve(t), undefined, reject);
      });
    }
    rasterTextureCache.set(url, tex);
    return tex;
  }

  async function getSvgTextureCached(url) {
    if (svgTextureCache.has(url)) return svgTextureCache.get(url);
    const tex = await loadCanvasTexture(url);
    svgTextureCache.set(url, tex);
    return tex;
  }

  const stickers = {
    glasses: { name: 'Glasses', anchor: 168, size: [0.8, 0.28], src: '/stickers/glasses.svg', mobileOffset: { x: 0, y: -0.05, z: 0.02 } },
    hat: { name: 'Hat', anchor: 10, size: [1.0, 0.6], src: '/stickers/hat.svg', mobileOffset: { x: 0, y: 0.2, z: 0.02 } },
    uploaded: { name: 'Uploaded', anchor: 168, size: [0.4, 0.4], src: imgUrl, mobileOffset: { x: 0, y: 0, z: 0.02 } }
  };

  function getAdjustedPosition(def, basePosition = { x: 0, y: 0, z: 0 }) {
    if (!isMobile) return basePosition;
    const mobileOffset = def.mobileOffset || { x: 0, y: 0, z: 0 };
    const viewportAdjustment = { x: mobileOffset.x, y: mobileOffset.y, z: mobileOffset.z };
    return { x: basePosition.x + viewportAdjustment.x, y: basePosition.y + viewportAdjustment.y, z: basePosition.z + viewportAdjustment.z };
  }

  function updateStickerPositions() {
    Object.values(instances).forEach(inst => {
      if (inst.visible && inst.anchor && inst.anchor.group) {
        const currentPos = inst.mesh.position;
        const maxOffset = isMobile ? 0.3 : 0.5;
        currentPos.x = Math.max(-maxOffset, Math.min(maxOffset, currentPos.x));
        currentPos.y = Math.max(-maxOffset, Math.min(maxOffset, currentPos.y));
        currentPos.z = Math.max(-0.1, Math.min(0.3, currentPos.z));
        applyTransforms(inst);
      }
    });
  }

  const instances = {};
  let zCounter = 1;
  let active = null;

  async function ensureInstance(key) {
    if (instances[key]) return instances[key];
    const def = stickers[key]; if (!def || !def.src) return null;
    const anchor = mindarThree.addAnchor(def.anchor);
    let texture;
    if (def.src.endsWith('.svg')) {
      texture = await getSvgTextureCached(def.src);
    } else {
      texture = await getRasterTextureCached(def.src);
    }
    const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
    const geo = new THREE.PlaneGeometry(def.size[0], def.size[1]);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, 0, 0);
    const adjustedPos = getAdjustedPosition(def);
    mesh.userData.mobileOffset = adjustedPos;
    mesh.renderOrder = zCounter++;
    mesh.visible = false;
    anchor.group.add(mesh);
    const inst = { key, def, anchor, mesh, visible: false, scale: 1, rotation: 0, offset: { x: 0, y: 0 }, mobileOffset: adjustedPos };
    instances[key] = inst;
    return inst;
  }

  function setActive(key) {
    active = key;
    updateSelectionOverlay();
    document.querySelectorAll('.tray .thumb').forEach(el => {
      if (!key) { el.classList.remove('active'); return; }
      el.classList.toggle('active', el.getAttribute('data-add') === key);
    });
    if (key) {
      const sel = document.querySelector(`.tray .thumb[data-add="${key}"]`);
      if (sel) {
        sel.classList.remove('bounce');
        requestAnimationFrame(() => {
          if (!sel) return;
          sel.classList.add('bounce');
          setTimeout(()=> sel && sel.classList.remove('bounce'), 300);
        });
      }
    }
  }

  function applyTransforms(inst) {
    const m = inst.mesh;
    m.scale.setScalar(inst.scale);
    m.rotation.set(0, 0, inst.rotation);
    const mobileOffset = inst.mobileOffset || { x: 0, y: 0, z: 0 };
    m.position.set( inst.offset.x + mobileOffset.x, inst.offset.y + mobileOffset.y, mobileOffset.z );
  }

  const overlay = document.createElement('div');
  overlay.id = 'selection'; overlay.style.display = 'none';
  const bar = document.createElement('div'); bar.className = 'bar';
  const btnFront = document.createElement('button'); btnFront.className = 'btn'; btnFront.textContent = 'Front';
  const btnBack = document.createElement('button'); btnBack.className = 'btn'; btnBack.textContent = 'Back';
  const btnReset = document.createElement('button'); btnReset.className = 'btn'; btnReset.textContent = 'Reset';
  const btnDel = document.createElement('button'); btnDel.className = 'btn'; btnDel.textContent = 'Delete';
  bar.append(btnFront, btnBack, btnReset, btnDel);
  const hRotate = document.createElement('div'); hRotate.className = 'handle h-rotate'; hRotate.textContent = '⤾';
  const hScale = document.createElement('div'); hScale.className = 'handle h-scale'; hScale.textContent = '⤢';
  overlay.append(bar, hRotate, hScale);
  document.body.appendChild(overlay);

  btnFront.addEventListener('click', () => { if (active && instances[active]) instances[active].mesh.renderOrder = zCounter++; });
  btnBack.addEventListener('click', () => { if (active && instances[active]) instances[active].mesh.renderOrder = 0; });
  btnReset.addEventListener('click', () => {
    if (!active || !instances[active]) return;
    const inst = instances[active]; inst.scale = 1; inst.rotation = 0; inst.offset = { x: 0, y: 0 }; applyTransforms(inst); updateSelectionOverlay();
  });
  btnDel.addEventListener('click', () => { if (active && instances[active]) { instances[active].mesh.visible = false; instances[active].visible = false; setActive(null); } });

  let handleGesture = null;
  function handlePoint(e){ return { x: e.clientX, y: e.clientY }; }
  function screenFromWorld(v3){
    const rect = container.getBoundingClientRect();
    const v = v3.clone().project(camera);
    return { x: (v.x + 1) / 2 * rect.width + rect.left, y: (1 - v.y) / 2 * rect.height + rect.top };
  }
  const getGestureSensitivity = () => isMobile ? 0.0015 : 0.0025;
  function updateSelectionOverlay(){
    if (!active || !instances[active] || !instances[active].visible) { overlay.style.display = 'none'; return; }
    overlay.style.display = 'block';
    const inst = instances[active]; const m = inst.mesh;
    const hw = inst.def.size[0] / 2; const hh = inst.def.size[1] / 2;
    const corners = [ new THREE.Vector3(-hw, -hh, 0), new THREE.Vector3(hw, -hh, 0), new THREE.Vector3(hw, hh, 0), new THREE.Vector3(-hw, hh, 0) ];
    const pts = corners.map(c => screenFromWorld(m.localToWorld(c.clone())));
    const xs = pts.map(p=>p.x), ys = pts.map(p=>p.y);
    const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
    overlay.style.left = `${left}px`; overlay.style.top = `${top}px`; overlay.style.width = `${right-left}px`; overlay.style.height = `${bottom-top}px`;
  }
  function startHandleDrag(type, e){
    e.stopPropagation(); e.preventDefault(); if (!active || !instances[active]) return;
    const inst = instances[active];
    const rect = overlay.getBoundingClientRect();
    const center = { x: rect.left + rect.width/2, y: rect.top + rect.height/2 };
    const pt = handlePoint(e);
    const dx = pt.x - center.x, dy = pt.y - center.y;
    const dist = Math.hypot(dx, dy); const ang = Math.atan2(dy, dx);
    handleGesture = { type, baseScale: inst.scale, baseRot: inst.rotation, baseDist: dist, baseAng: ang };
    const move = (ev)=>{
      const q = handlePoint(ev); const ddx = q.x - center.x, ddy = q.y - center.y;
      const nd = Math.hypot(ddx, ddy); const na = Math.atan2(ddy, ddx);
      if (handleGesture.type === 'scale') { inst.scale = Math.max(0.2, Math.min(3, handleGesture.baseScale * (nd / Math.max(1, handleGesture.baseDist)))) ; }
      if (handleGesture.type === 'rotate') { inst.rotation = handleGesture.baseRot + rotationSign * (na - handleGesture.baseAng); }
      applyTransforms(inst); updateSelectionOverlay();
    };
    const end = ()=>{ window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); handleGesture = null; };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end);
  }
  hScale.addEventListener('pointerdown', (e)=>startHandleDrag('scale', e));
  hRotate.addEventListener('pointerdown', (e)=>startHandleDrag('rotate', e));

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const pointers = new Map();
  let gesture = null;
  function setPointerFromEvent(e){
    const r = container.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  container.addEventListener('pointerdown', (e) => {
    container.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      setPointerFromEvent(e);
      const objs = Object.values(instances).filter(i=>i.visible).map(i=>i.mesh);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(objs, false);
      if (hits.length) {
        const mesh = hits[0].object;
        const key = Object.keys(instances).find(k => instances[k].mesh === mesh);
        setActive(key);
        const inst = instances[key];
        gesture = { mode: 'drag', start: { x: e.clientX, y: e.clientY }, base: { ...inst.offset } };
      } else {
        setActive(null); gesture = null;
      }
    } else if (pointers.size === 2 && active && instances[active]) {
      const [a,b] = [...pointers.values()];
      const dx = b.x - a.x, dy = b.y - a.y; const dist = Math.hypot(dx, dy); const ang = Math.atan2(dy, dx);
      gesture = { mode: 'transform', baseDist: dist, baseAng: ang, baseScale: instances[active].scale, baseRot: instances[active].rotation };
    }
  });
  container.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!gesture || !active || !instances[active]) return;
    const inst = instances[active];
    if (gesture.mode === 'drag' && pointers.size === 1) {
      const dx = e.clientX - gesture.start.x; const dy = e.clientY - gesture.start.y;
      inst.offset.x = gesture.base.x + dx * getGestureSensitivity();
      inst.offset.y = gesture.base.y - dy * getGestureSensitivity();
      applyTransforms(inst); updateSelectionOverlay();
    } else if (gesture.mode === 'transform' && pointers.size === 2) {
      const [a,b] = [...pointers.values()];
      const dx = b.x - a.x, dy = b.y - a.y; const dist = Math.hypot(dx, dy); const ang = Math.atan2(dy, dx);
      const scaleMul = dist / (gesture.baseDist || 1);
      inst.scale = Math.max(0.2, Math.min(3, gesture.baseScale * scaleMul));
      inst.rotation = gesture.baseRot + rotationSign * (ang - (gesture.baseAng || 0));
      applyTransforms(inst); updateSelectionOverlay();
    }
  });
  function endPointer(e){ pointers.delete(e.pointerId); if (pointers.size === 0) gesture = null; }
  container.addEventListener('pointerup', endPointer);
  container.addEventListener('pointercancel', endPointer);

  document.querySelectorAll('.tray .thumb').forEach(btn => {
    const key = btn.getAttribute('data-add');
    const imgEl = btn.querySelector('img');
    
    if (key === 'glasses') { imgEl.src = '/stickers/glasses.svg'; } 
    else if (key === 'hat') { imgEl.src = '/stickers/hat.svg'; } 
    else if (key === 'uploaded') {
      if (imgUrl) {
        btn.classList.add('loading');
        loadImageSafely(imgUrl).then((success) => {
          if (success) { imgEl.src = imgUrl; btn.classList.remove('loading'); btn.classList.remove('disabled'); console.log('Uploaded image ready for use'); } 
          else { console.warn('Uploaded image failed to load, falling back to default'); imgEl.src = '/stickers/glasses.svg'; btn.classList.remove('loading'); btn.classList.add('disabled'); if (statusEl) statusEl.textContent = 'Uploaded image failed to load'; }
        }).catch((error) => { console.error('Failed to load uploaded image:', error); imgEl.src = '/stickers/glasses.svg'; btn.classList.remove('loading'); btn.classList.add('disabled'); if (statusEl) statusEl.textContent = 'Uploaded image failed to load'; });
      } else {
        imgEl.src = '/stickers/glasses.svg';
        btn.classList.add('disabled');
        console.warn('No uploaded image URL available');
      }
    }
    
    btn.addEventListener('click', async () => {
      const inst = await ensureInstance(key);
      if (!inst) return;
      if (isMobile) {
        inst.offset = { x: 0, y: 0 };
        inst.scale = 0.8;
        inst.rotation = 0;
        applyTransforms(inst);
      }
      inst.visible = true; inst.mesh.visible = true;
      setActive(key);
      if (isMobile && statusEl) { statusEl.textContent = `${inst.def.name} added - Tap to adjust`; }
    });
  });

  if (statusEl) statusEl.textContent = 'Starting camera...';
  if (isMobile) {
    if (statusEl) statusEl.textContent = 'Setting up mobile camera...';
    const cameraReady = await setupMobileCamera();
    if (!cameraReady) {
      if (statusEl) statusEl.textContent = 'Camera setup failed - check permissions';
      return;
    }
  }
  try {
    const startPromise = mindarThree.start();
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Camera start timeout')), 15000));
    await Promise.race([startPromise, timeoutPromise]);
    
    await setupWatermark();

    if (statusEl) statusEl.textContent = 'Tracking face...';
    if (mindarThree && typeof mindarThree.on === 'function') {
      mindarThree.on('faceFound', () => {
        if (statusEl) statusEl.textContent = 'Face detected - Ready for stickers';
        console.log('Face detected, ready for AR stickers');
      });
      mindarThree.on('faceLost', () => {
        if (statusEl) statusEl.textContent = 'Face lost - Move back into view';
        console.log('Face lost, waiting for face to return');
      });
    } else {
      console.log('MindAR event handling not available, using fallback');
      if (statusEl) statusEl.textContent = 'Face tracking active - Ready for stickers';
    }
    try {
      const v = mindarThree.video;
      if (v) { v.setAttribute('playsinline', ''); v.playsInline = true; v.muted = true; v.autoplay = true; if (isMobile) { v.style.objectFit = 'cover'; } }
    } catch (_) {}
  } catch (err) {
    console.error('MindAR start failed:', err);
    if (err.message && err.message.includes('timeout')) {
      if (statusEl) statusEl.textContent = 'Camera starting up... Please wait';
      console.log('Camera startup timeout, but may still be working');
    } else {
      const insecure = !(window.isSecureContext || location.protocol === 'https:');
      const hint = insecure ? 'Use HTTPS (required for camera).' : 'Check camera permissions and WebGL support.';
      if (statusEl) statusEl.textContent = `Camera issue: ${hint}`;
      console.error('Camera startup issue:', err);
      return;
    }
  }

  try {
    if (renderer && renderer.getContext && renderer.getContext().canvas) {
      renderer.getContext().canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        console.warn('WebGL context lost.');
        if (statusEl) statusEl.textContent = 'Graphics context lost. Reloading...';
        setTimeout(()=> location.reload(), 250);
      }, { passive: false });
    }
  } catch (_) {}

  if (renderer && renderer.setAnimationLoop) {
    renderer.setAnimationLoop(() => { 
      try {
        if (renderer && scene && camera) {
          renderer.render(scene, camera); 
          updateSelectionOverlay(); 
          updateStickerPositions();

          if (mindarThree && mindarThree.faceTracker) {
            const isTracking = mindarThree.faceTracker.isTracking;
            if (isTracking && statusEl && statusEl.textContent.includes('Starting') || statusEl.textContent.includes('Camera starting')) {
              statusEl.textContent = 'Face tracking active - Ready for stickers';
            }
          }
        }
      } catch (error) {
        console.error('Render loop error:', error);
        if (statusEl) statusEl.textContent = 'Render error occurred';
      }
    });
  } else {
    console.error('Renderer animation loop not available');
    if (statusEl) statusEl.textContent = 'Graphics system error';
  }
  
  async function maybeRecoverCamera(){
    try {
      const v = mindarThree && mindarThree.video;
      const live = v && v.srcObject && typeof v.srcObject.getVideoTracks === 'function' && v.srcObject.getVideoTracks().some(tr => tr.readyState === 'live');
      const playing = v && !v.paused && !v.ended && v.readyState >= 2;
      if (!live || !playing) {
        await restartAR(currentFacingMode);
      }
    } catch (e) {
      console.warn('Camera recovery failed:', e);
    }
  }
  window.addEventListener('pageshow', () => setTimeout(maybeRecoverCamera, 300));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(maybeRecoverCamera, 300); });
})();