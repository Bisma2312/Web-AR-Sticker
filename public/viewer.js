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
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
                   window.innerWidth <= 768;
  // Video is not mirrored; map screen angle (y-down) to Three.js rotation (y-up)
  const rotationSign = -1;
  // Track current facing mode (front/user or rear/environment)
  let currentFacingMode = useRear ? 'environment' : 'user';

  // Mobile camera setup and permissions
  async function setupMobileCamera(facingMode = currentFacingMode) {
    if (!isMobile) return true;
    
    try {
      // Check if camera is available first
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera API not available');
      }
      
      // Test camera access with the specified facing mode
      const constraints = { 
        video: { 
          facingMode: { ideal: facingMode },
          width: { ideal: 640, max: 1280 },
          height: { ideal: 480, max: 720 }
        } 
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Check if we got the right facing mode
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const settings = videoTrack.getSettings();
        console.log('Camera settings:', settings);
        console.log('Requested facing mode:', facingMode, 'Actual:', settings.facingMode);
      }
      
      // Stop the test stream
      stream.getTracks().forEach(track => track.stop());
      return true;
    } catch (error) {
      console.error('Mobile camera setup failed:', error);
      if (statusEl) statusEl.textContent = `Camera ${facingMode} not available: ${error.message}`;
      return false;
    }
  }

  // Check for secure context (required for camera access)
  if (!window.isSecureContext && location.protocol !== 'https:') {
    if (statusEl) statusEl.textContent = 'HTTPS required for camera access';
    console.error('Secure context required for WebAR');
    return;
  }

  // WebGL detection and error handling
  function checkWebGLSupport() {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) {
        throw new Error('WebGL not supported');
      }
      
      // Check for basic WebGL capabilities
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
        const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        console.log('WebGL Vendor:', vendor);
        console.log('WebGL Renderer:', renderer);
      }
      
      // Check for required extensions
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

  // Check if MindAR library is loaded
  if (!window.MINDAR || !window.MINDAR.FACE || !window.MINDAR.FACE.MindARThree) {
    if (statusEl) statusEl.textContent = 'AR library not loaded';
    console.error('MindAR library not available');
    return;
  }

  // MindAR + Three setup
  let mindarThree, renderer, scene, camera;
  
  try {
    // Mobile-optimized MindAR configuration
    const mindarConfig = {
      container,
      maxFaces: 1, // Limit to single face for better performance
      faceIndex: 0,
      uiScanning: false, // Disable default UI for custom implementation
      uiLoading: false,
      uiError: false,
      // Mobile-specific camera settings with improved constraints
      camera: {
        facingMode: { ideal: currentFacingMode }, // Use ideal for better compatibility
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

  // Tame canvas size to avoid iOS/WebGL context errors on high-DPR devices
  try {
    const maxDpr = 2; // reduce memory pressure on mobile
    if (renderer && renderer.setPixelRatio) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    }
  } catch (_) {}
  
  const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1); 
  scene.add(light);

  // In-place camera switch helpers and wiring
  // Snapshot existing instances (visibility + transforms) for rebuilds
  function snapshotInstances(){
    const snap = [];
    try {
      Object.values(instances || {}).forEach(inst => {
        snap.push({
          key: inst.key,
          visible: inst.visible,
          scale: inst.scale,
          rotation: inst.rotation,
          offset: { ...(inst.offset || {x:0,y:0}) },
        });
      });
    } catch(_) {}
    return snap;
  }

  // Dispose current renderer/canvas and MindAR
  async function disposeCurrent(){
    try { if (renderer && renderer.setAnimationLoop) renderer.setAnimationLoop(null); } catch(_){}
    
    // Stop and clean up video streams
    try {
      if (mindarThree && mindarThree.video) {
        const video = mindarThree.video;
        if (video.srcObject && typeof video.srcObject.getTracks === 'function') {
          video.srcObject.getTracks().forEach(track => {
            track.stop();
            console.log('Stopped video track:', track.kind, track.label);
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

  // Rebuild instances after re-init
  async function rebuildInstancesFromSnapshot(snap){
    for (const s of snap) {
      try {
        const inst = await ensureInstance(s.key);
        if (!inst) continue;
        inst.scale = s.scale;
        inst.rotation = s.rotation;
        inst.offset = { ...s.offset };
        applyTransforms(inst);
        inst.visible = s.visible;
        inst.mesh.visible = s.visible;
      } catch(e) { console.warn('Rebuild instance failed', s && s.key, e); }
    }
    try { updateSelectionOverlay(); } catch(_){}
  }

  // Restart AR with given facingMode (user/environment)
  async function restartAR(nextFacingMode){
    try { if (statusEl) statusEl.textContent = 'Switching camera...'; } catch(_){}
    
    const targetFacingMode = nextFacingMode || currentFacingMode;
    
    // Test camera availability before switching
    if (isMobile) {
      const cameraReady = await setupMobileCamera(targetFacingMode);
      if (!cameraReady) {
        if (statusEl) statusEl.textContent = `Cannot switch to ${targetFacingMode} camera`;
        return false;
      }
    }
    
    const snap = snapshotInstances();
    await disposeCurrent();
    
    // Add delay to ensure proper cleanup
    await new Promise(resolve => setTimeout(resolve, 500));
    
    currentFacingMode = targetFacingMode;
    
    try {
      // Re-init MindAR with improved camera constraints
      const mindarConfig2 = {
        container,
        maxFaces: 1,
        faceIndex: 0,
        uiScanning: false,
        uiLoading: false,
        uiError: false,
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
      
      // Configure video element for mobile
      if (mindarThree.video && isMobile) {
        const video = mindarThree.video;
        video.setAttribute('playsinline', '');
        video.playsInline = true;
        video.muted = true;
        video.autoplay = true;
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

  // Wire camera toggle button
  try {
    const camBtn = document.getElementById('cam-btn');
    if (camBtn) {
      function updateLabel(){ 
        camBtn.textContent = (currentFacingMode === 'environment') ? 'Front Cam' : 'Rear Cam'; 
      }
      
      updateLabel();
      
      camBtn.addEventListener('click', async () => {
    if (camBtn.disabled) return;
    
    // Menonaktifkan tombol dan memperbarui teks untuk umpan balik
    camBtn.disabled = true;
    camBtn.textContent = 'Switching...';
    
    try {
        // Panggil fungsi bawaan MindAR dan tunggu hingga selesai
        await mindarThree.arSystem.switchCamera();
        
        // Perbarui currentFacingMode setelah peralihan berhasil
        const next = (currentFacingMode === 'environment') ? 'user' : 'environment';
        currentFacingMode = next;
        
        // Perbarui label tombol untuk mencerminkan status baru
        camBtn.textContent = (currentFacingMode === 'environment') ? 'Front Cam' : 'Rear Cam';
        console.log('Camera switch successful:', currentFacingMode);
        
    } catch (error) {
        // Menangani kesalahan jika peralihan gagal
        console.error('Camera switch failed:', error);
        // Kembali ke label sebelumnya dan tampilkan pesan kesalahan
        camBtn.textContent = (currentFacingMode === 'environment') ? 'Front Cam' : 'Rear Cam';
        if (statusEl) statusEl.textContent = `Peralihan kamera gagal: ${error.message}`;
    }
    
    // Selalu aktifkan kembali tombol
    camBtn.disabled = false;
});
    }
  } catch(e) {
    console.error('Error setting up camera button:', e);
  }

  // Utility: SVG -> CanvasTexture for crisp scaling
  const loadCanvasTexture = (url) => new Promise((resolve, reject) => {
    const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => {
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const cx = c.getContext('2d'); cx.drawImage(img, 0, 0);
      const tex = new THREE.CanvasTexture(c);
      resolve(tex);
    }; img.onerror = reject; img.src = url;
  });
  
  // Preload uploaded image to ensure it's available
  const preloadImage = (url) => new Promise((resolve, reject) => {
    if (!url) {
      reject(new Error('No URL provided'));
      return;
    }
    
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = () => {
      console.log('Image preloaded successfully:', url);
      try { preloadedImageCache.set(url, img); } catch (_) {}
      resolve(img);
    };
    
    img.onerror = (error) => {
      console.error('Failed to preload image:', url, error);
      reject(new Error('Image load failed'));
    };
    
    img.src = url;
  });
  
  // Simplified image loading without HEAD validation
  const loadImageSafely = async (url) => {
    try {
      await preloadImage(url);
      return true;
    } catch (error) {
      console.warn('Image load warning:', error);
      return false;
    }
  };
  
  const loader = new THREE.TextureLoader();
  if (loader && loader.setCrossOrigin) loader.setCrossOrigin('anonymous');
  if (THREE && THREE.Cache) THREE.Cache.enabled = true;

  // In-memory caches for textures within the current viewer session
  const rasterTextureCache = new Map(); // url -> THREE.Texture
  const svgTextureCache = new Map();    // url -> THREE.Texture
  const preloadedImageCache = new Map(); // url -> HTMLImageElement

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

  // Sticker registry with mobile-optimized positioning
  const stickers = {
    glasses: { 
      name: 'Glasses', 
      anchor: 168, // Nose bridge point
      size: [0.8, 0.28], // Smaller size for mobile
      src: '/stickers/glasses.svg',
      mobileOffset: { x: 0, y: -0.05, z: 0.02 } // Center on face
    },
    hat: { 
      name: 'Hat', 
      anchor: 10, // Top of head
      size: [1.0, 0.6], // Adjusted size for mobile
      src: '/stickers/hat.svg',
      mobileOffset: { x: 0, y: 0.2, z: 0.02 } // Position above head
    },
    uploaded: { 
      name: 'Uploaded', 
      anchor: 168, // Use same anchor as glasses for better positioning
      size: [0.4, 0.4], // Smaller size for mobile
      src: imgUrl,
      mobileOffset: { x: 0, y: 0, z: 0.02 } // Center on face
    }
  };

  // Adjust sticker positioning based on device
  function getAdjustedPosition(def, basePosition = { x: 0, y: 0, z: 0 }) {
    if (!isMobile) return basePosition;
    
    const mobileOffset = def.mobileOffset || { x: 0, y: 0, z: 0 };
    
    // Center stickers on face with proper offsets
    const viewportAdjustment = {
      x: mobileOffset.x,
      y: mobileOffset.y,
      z: mobileOffset.z
    };
    
    return {
      x: basePosition.x + viewportAdjustment.x,
      y: basePosition.y + viewportAdjustment.y,
      z: basePosition.z + viewportAdjustment.z
    };
  }

  // Dynamic sticker positioning based on face tracking
  function updateStickerPositions() {
    Object.values(instances).forEach(inst => {
      if (inst.visible && inst.anchor && inst.anchor.group) {
        // Ensure stickers stay within reasonable bounds
        const currentPos = inst.mesh.position;
        const maxOffset = isMobile ? 0.3 : 0.5;
        
        // Clamp positions to keep stickers visible
        currentPos.x = Math.max(-maxOffset, Math.min(maxOffset, currentPos.x));
        currentPos.y = Math.max(-maxOffset, Math.min(maxOffset, currentPos.y));
        currentPos.z = Math.max(-0.1, Math.min(0.3, currentPos.z));
        
        applyTransforms(inst);
      }
    });
  }

  // Instances (one per key)
  const instances = {};
  let zCounter = 1;
  let active = null;

  async function ensureInstance(key) {
    if (instances[key]) return instances[key];
    const def = stickers[key]; if (!def || !def.src) return null;
    
    // Create anchor with proper face tracking
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
    
    // Center the mesh on the anchor point
    mesh.position.set(0, 0, 0);
    
    // Apply mobile-optimized positioning as offset
    const adjustedPos = getAdjustedPosition(def);
    mesh.userData.mobileOffset = adjustedPos;
    
    mesh.renderOrder = zCounter++;
    mesh.visible = false; // hidden by default; shown when user chooses
    
    // Add mesh to anchor group
    anchor.group.add(mesh);
    
    const inst = { 
      key, 
      def, 
      anchor, 
      mesh, 
      visible: false, 
      scale: 1, 
      rotation: 0, 
      offset: { x: 0, y: 0 },
      mobileOffset: adjustedPos
    };
    
    instances[key] = inst;
    return inst;
  }

  function setActive(key) {
    active = key;
    updateSelectionOverlay();
    // Update tray highlight
    document.querySelectorAll('.tray .thumb').forEach(el => {
      if (!key) { el.classList.remove('active'); return; }
      el.classList.toggle('active', el.getAttribute('data-add') === key);
    });
    // Bounce selected thumbnail without forcing synchronous reflow
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
    
    // Apply user offset plus mobile offset for proper positioning
    const mobileOffset = inst.mobileOffset || { x: 0, y: 0, z: 0 };
    m.position.set(
      inst.offset.x + mobileOffset.x,
      inst.offset.y + mobileOffset.y,
      mobileOffset.z
    );
  }

  // Selection overlay UI
  const overlay = document.createElement('div');
  overlay.id = 'selection';
  overlay.style.display = 'none';
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

  // Handle drags on scale/rotate
  let handleGesture = null;
  function handlePoint(e){ return { x: e.clientX, y: e.clientY }; }
  function screenFromWorld(v3){
    const rect = container.getBoundingClientRect();
    const v = v3.clone().project(camera);
    return { x: (v.x + 1) / 2 * rect.width + rect.left, y: (1 - v.y) / 2 * rect.height + rect.top };
  }
  
  // Mobile-optimized gesture sensitivity
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

  // Raycaster for selecting meshes by tapping
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const pointers = new Map();
  let gesture = null; // drag or transform
  function setPointerFromEvent(e){
    const r = container.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  container.addEventListener('pointerdown', (e) => {
    container.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      // Select target by raycast
      setPointerFromEvent(e);
      const objs = Object.values(instances).filter(i=>i.visible).map(i=>i.mesh);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(objs, false);
      if (hits.length) {
        const mesh = hits[0].object;
        const key = Object.keys(instances).find(k => instances[k].mesh === mesh);
        setActive(key);
        // start drag
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

  // Sticker selector UI (bottom tray) with thumbnails
  document.querySelectorAll('.tray .thumb').forEach(btn => {
    const key = btn.getAttribute('data-add');
    const imgEl = btn.querySelector('img');
    
    if (key === 'glasses') {
      imgEl.src = '/stickers/glasses.svg';
    } else if (key === 'hat') {
      imgEl.src = '/stickers/hat.svg';
    } else if (key === 'uploaded') {
      if (imgUrl) {
        // Start loading state
        btn.classList.add('loading');
        
        // Validate and preload the image
        loadImageSafely(imgUrl)
          .then((success) => {
            if (success) {
              imgEl.src = imgUrl;
              btn.classList.remove('loading');
              btn.classList.remove('disabled');
              console.log('Uploaded image ready for use');
            } else {
              console.warn('Uploaded image failed to load, falling back to default');
              imgEl.src = '/stickers/glasses.svg'; // Fallback to glasses
              btn.classList.remove('loading');
              btn.classList.add('disabled');
              if (statusEl) statusEl.textContent = 'Uploaded image failed to load';
            }
          })
          .catch((error) => {
            // Image failed to load
            console.error('Failed to load uploaded image:', error);
            imgEl.src = '/stickers/glasses.svg'; // Fallback to glasses
            btn.classList.remove('loading');
            btn.classList.add('disabled');
            if (statusEl) statusEl.textContent = 'Uploaded image failed to load';
          });
      } else {
        // No image URL available
        imgEl.src = '/stickers/glasses.svg'; // Fallback image
        btn.classList.add('disabled');
        console.warn('No uploaded image URL available');
      }
    }
    
    btn.addEventListener('click', async () => {
      const inst = await ensureInstance(key);
      if (!inst) return;
      
      // Mobile-optimized initial placement
      if (isMobile) {
        // Reset to optimal mobile position
        inst.offset = { x: 0, y: 0 };
        inst.scale = 0.8; // Start smaller on mobile
        inst.rotation = 0;
        applyTransforms(inst);
      }
      
      inst.visible = true; 
      inst.mesh.visible = true; 
      setActive(key);
      
      // Mobile-specific feedback
      if (isMobile && statusEl) {
        statusEl.textContent = `${inst.def.name} added - Tap to adjust`;
      }
    });
  });

  if (statusEl) statusEl.textContent = 'Starting camera...';
  
  // Setup mobile camera permissions first
  if (isMobile) {
    if (statusEl) statusEl.textContent = 'Setting up mobile camera...';
    const cameraReady = await setupMobileCamera();
    if (!cameraReady) {
      if (statusEl) statusEl.textContent = 'Camera setup failed - check permissions';
      return;
    }
  }
  
  // Improve resilience and error visibility during startup
  try {
    // Add timeout for MindAR start
    const startPromise = mindarThree.start();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Camera start timeout')), 15000)
    );
    
    await Promise.race([startPromise, timeoutPromise]);
    
    if (statusEl) statusEl.textContent = 'Tracking face...';
    
    // Enhanced face tracking events for better mobile performance
    // Check if MindAR supports event handling
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
      // Fallback for MindAR versions without event support
      console.log('MindAR event handling not available, using fallback');
      if (statusEl) statusEl.textContent = 'Face tracking active - Ready for stickers';
    }
    
    // Nudge iOS/Safari to behave with inline camera playback
    try {
      const v = mindarThree.video;
      if (v) { 
        v.setAttribute('playsinline', ''); 
        v.playsInline = true; 
        v.muted = true; 
        v.autoplay = true;
        
        // Mobile-specific video optimizations (no mirroring)
        if (isMobile) {
          v.style.objectFit = 'cover';
        }
      }
    } catch (_) {}
  } catch (err) {
    console.error('MindAR start failed:', err);
    
    // Check if it's actually a camera error or just a startup delay
    if (err.message && err.message.includes('timeout')) {
      if (statusEl) statusEl.textContent = 'Camera starting up... Please wait';
      console.log('Camera startup timeout, but may still be working');
      // Don't return here, let it continue
    } else {
      const insecure = !(window.isSecureContext || location.protocol === 'https:');
      const hint = insecure ? 'Use HTTPS (required for camera).' : 'Check camera permissions and WebGL support.';
      if (statusEl) statusEl.textContent = `Camera issue: ${hint}`;
      console.error('Camera startup issue:', err);
      return;
    }
  }

  // Do not show stickers by default; wait for user choice

  // Handle possible WebGL context loss gracefully
  try {
    if (renderer && renderer.getContext && renderer.getContext().canvas) {
      renderer.getContext().canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        console.warn('WebGL context lost.');
        if (statusEl) statusEl.textContent = 'Graphics context lost. Reloading...';
        // Simple recovery path: reload to re-init pipeline
        setTimeout(()=> location.reload(), 250);
      }, { passive: false });
    }
  } catch (_) {}

  // Safe renderer animation loop with error handling
  if (renderer && renderer.setAnimationLoop) {
    renderer.setAnimationLoop(() => { 
      try {
        if (renderer && scene && camera) {
          renderer.render(scene, camera); 
          updateSelectionOverlay(); 
          updateStickerPositions(); // Update sticker positions each frame
          
          // Check face tracking status and update UI
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
  
  // Mobile resume recovery: attempt to reinitialize camera when returning to the page
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
