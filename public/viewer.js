// AR Viewer with in-AR sticker editing via direct tap and overlay handles
document.addEventListener('DOMContentLoaded', async () => {
  const qs = new URLSearchParams(location.search);
  const id = qs.get('id');
  const t = qs.get('t');
  const cam = qs.get('cam'); // 'front' | 'rear'
  const imgUrl = id && t ? `/api/image/${id}?t=${t}` : null;
  
  console.log('URL Parameters:', { id, t, imgUrl });
  
  const statusEl = document.getElementById('status');
  const container = document.getElementById('ar');
  
  if (!id || !t) { 
    if (statusEl) statusEl.textContent = 'Missing token'; 
    return; 
  }
  if (!container) { 
    if (statusEl) statusEl.textContent = 'AR container not found'; 
    return; 
  }

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
                   window.innerWidth <= 768;
  const rotationSign = -1;

  let mindarThree = null;
  let currentFacingMode = cam === 'rear' ? 'environment' : 'user';

  // --- Utility Functions ---
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

  const stickers = {
    glasses: { name: 'Glasses', anchor: 168, size: [0.8, 0.28], src: '/stickers/glasses.svg', mobileOffset: { x: 0, y: -0.05, z: 0.02 } },
    hat: { name: 'Hat', anchor: 10, size: [1.0, 0.6], src: '/stickers/hat.svg', mobileOffset: { x: 0, y: 0.2, z: 0.02 } },
    uploaded: { name: 'Uploaded', anchor: 168, size: [0.4, 0.4], src: imgUrl, mobileOffset: { x: 0, y: 0, z: 0.02 } }
  };
  
  const loader = new THREE.TextureLoader();
  if (loader && loader.setCrossOrigin) loader.setCrossOrigin('anonymous');
  if (THREE && THREE.Cache) THREE.Cache.enabled = true;
  
  const rasterTextureCache = new Map();
  const svgTextureCache = new Map();
  const preloadedImageCache = new Map();
  
  const preloadImage = (url) => new Promise((resolve, reject) => {
    if (!url) { reject(new Error('No URL provided')); return; }
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => { preloadedImageCache.set(url, img); resolve(img); };
    img.onerror = (error) => { reject(new Error('Image load failed')); };
    img.src = url;
  });

  const loadImageSafely = async (url) => {
    try { await preloadImage(url); return true; } catch (error) { return false; }
  };

  async function getRasterTextureCached(url) {
    if (!loader) throw new Error('THREE.TextureLoader not initialized');
    if (rasterTextureCache.has(url)) return rasterTextureCache.get(url);
    let img = preloadedImageCache.get(url);
    if (!img) { try { img = await preloadImage(url); } catch (_) { img = null; } }
    let tex;
    if (img) { tex = new THREE.Texture(img); tex.needsUpdate = true; } else {
      tex = await new Promise((resolve, reject) => {
        const t = loader.load(url, () => resolve(t), undefined, reject);
      });
    }
    rasterTextureCache.set(url, tex);
    return tex;
  }

  async function getSvgTextureCached(url) {
    if (svgTextureCache.has(url)) return svgTextureCache.get(url);
    const tex = await new Promise((resolve, reject) => {
      const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => {
        const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
        const cx = c.getContext('2d'); cx.drawImage(img, 0, 0);
        const tex = new THREE.CanvasTexture(c);
        resolve(tex);
      }; img.onerror = reject; img.src = url;
    });
    svgTextureCache.set(url, tex);
    return tex;
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
    const adjustedPos = def.mobileOffset || { x: 0, y: 0, z: 0 };
    mesh.userData.mobileOffset = adjustedPos;
    mesh.renderOrder = zCounter++;
    mesh.visible = false;
    anchor.group.add(mesh);
    const inst = { key, def, anchor, mesh, visible: false, scale: 1, rotation: 0, offset: { x: 0, y: 0 }, mobileOffset: adjustedPos };
    instances[key] = inst;
    return inst;
  }

  function applyTransforms(inst) {
    const m = inst.mesh;
    m.scale.setScalar(inst.scale);
    m.rotation.set(0, 0, inst.rotation);
    const mobileOffset = inst.mobileOffset || { x: 0, y: 0, z: 0 };
    m.position.set(inst.offset.x + mobileOffset.x, inst.offset.y + mobileOffset.y, mobileOffset.z);
  }

  // --- UI and Gestures ---
  document.querySelectorAll('.tray .thumb').forEach(btn => {
    const key = btn.getAttribute('data-add');
    const imgEl = btn.querySelector('img');
    
    if (key === 'uploaded') {
      if (imgUrl) {
        btn.classList.add('loading');
        loadImageSafely(imgUrl).then((success) => {
          btn.classList.remove('loading');
          if (success) {
            imgEl.src = imgUrl;
            btn.classList.remove('disabled');
          } else {
            imgEl.src = '/stickers/glasses.svg';
            btn.classList.add('disabled');
            if (statusEl) statusEl.textContent = 'Uploaded image failed to load';
          }
        });
      } else {
        imgEl.src = '/stickers/glasses.svg';
        btn.classList.add('disabled');
      }
    } else {
      imgEl.src = stickers[key].src;
    }
    
    btn.addEventListener('click', async () => {
      const inst = await ensureInstance(key);
      if (!inst) return;
      inst.visible = true; 
      inst.mesh.visible = true; 
      active = key;
      if (statusEl) {
        statusEl.textContent = `${inst.def.name} added`;
      }
    });
  });

  // --- Final Setup ---

  async function startAR(config) {
    if (!checkWebGLSupport()) {
      if (statusEl) statusEl.textContent = 'WebGL not supported';
      return;
    }

    if (!window.MINDAR || !window.MINDAR.FACE || !window.MINDAR.FACE.MindARThree) {
      if (statusEl) statusEl.textContent = 'AR library not loaded';
      console.error('MindAR library not available');
      return;
    }
    
    if (statusEl) statusEl.textContent = 'Memuat AR Engine...';

    try {
      mindarThree = new window.MINDAR.FACE.MindARThree(config);
      ({ renderer, scene, camera } = mindarThree);

      if (!renderer || !scene || !camera) {
        throw new Error('MindAR failed to initialize properly');
      }
      
      const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1); 
      scene.add(light);

      await mindarThree.start();

      if (statusEl) statusEl.textContent = 'Tracking face...';
      if (mindarThree && typeof mindarThree.on === 'function') {
        mindarThree.on('faceFound', () => {
          if (statusEl) statusEl.textContent = 'Face detected - Ready for stickers';
        });
        mindarThree.on('faceLost', () => {
          if (statusEl) statusEl.textContent = 'Face lost - Move back into view';
        });
      }

      if (renderer && renderer.setAnimationLoop) {
        renderer.setAnimationLoop(() => { 
          if (renderer && scene && camera) {
            renderer.render(scene, camera); 
            if (active && instances[active] && instances[active].mesh) {
              applyTransforms(instances[active]);
            }
          }
        });
      }
      
    } catch (error) {
      console.error('Gagal memulai MindAR:', error);
      if (statusEl) statusEl.textContent = `Gagal memulai AR: ${error.message}`;
      return;
    }
  }

  // Camera toggle button handler
  try {
    const camBtn = document.getElementById('cam-btn');
    if (camBtn) {
      function updateLabel() {
        camBtn.textContent = (currentFacingMode === 'environment') ? 'Front Cam' : 'Rear Cam';
      }
      
      updateLabel();
      
      camBtn.addEventListener('click', async () => {
        if (!mindarThree || !mindarThree.arSystem || camBtn.disabled) {
            if (statusEl) statusEl.textContent = 'Memuat... Tunggu sebentar.';
            return;
        }
        
        camBtn.disabled = true;
        camBtn.textContent = 'Switching...';
        
        try {
          // Periksa apakah arSystem sudah ada sebelum memanggil switchCamera
          if (mindarThree.arSystem && typeof mindarThree.arSystem.switchCamera === 'function') {
            await mindarThree.arSystem.switchCamera();
            const next = (currentFacingMode === 'environment') ? 'user' : 'environment';
            currentFacingMode = next;
            updateLabel();
          } else {
            throw new Error("AR system is not ready or switchCamera function is missing.");
          }
        } catch (error) {
          if (statusEl) statusEl.textContent = `Peralihan kamera gagal: ${error.message}`;
        }
        
        camBtn.disabled = false;
      });
    }
  } catch(e) {
    console.error('Error setting up camera button:', e);
  }
  
  const initialConfig = {
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

  startAR(initialConfig);
});