import * as THREE from 'three';
import { MindARThree } from 'mindar-face-three';
// AR Viewer with in-AR sticker editing via direct tap and overlay handles
(async function(){
  // Ambil dari window object jika sudah di-set di HTML, atau hardcode jika perlu
// BARIS BARU (SOLUSI FRONTEND)
const SUPABASE_URL = 'https://amlsczcjjtphsctsgury.supabase.co'; 
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFtbHNjemNqanRwaHNjdHNndXJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg4Njc1MTIsImV4cCI6MjA3NDQ0MzUxMn0.x0DBIV2xS00E_AzUvanW7PtB-qpSGK9abyIeRCljgqc';
// Akses Supabase client dari variabel global (setelah dimuat oleh CDN)
const { createClient } = window.supabase; 

// Inisialisasi Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
  
  // Variabel untuk menyimpan ukuran stiker yang diunggah
  let uploadedStickerSize = [1.1, 1.1]; 
  let currentMode = 'photo';
  let isRecording = false;
  let mediaRecorder;
  let recordedBlobs;
  let recordingCanvas; // Kanvas untuk menggabungkan video dan AR
  let recordingCtx;
  let videoRecordLoop; // Loop untuk menggambar video selama perekaman

  
  // ** NEW: Variabel untuk menyimpan data pratinjau saat ini **
  let currentPreviewUrl = null;
  let currentPreviewType = null;

  // Deteksi perangkat iOS
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isChrome = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);

  // Elemen pratinjau
  const previewContainer = document.getElementById('preview-container');
  const previewImage = document.getElementById('preview-image');
  const previewVideo = document.getElementById('preview-video');
  const saveButton = document.getElementById('save-button');
  const shareButton = document.getElementById('share-button');
  const closeButton = document.getElementById('close-button'); // Menggunakan ID yang benar dari HTML yang direvisi
  const bottomSheet = document.getElementById("bottomSheet");
  const overlaySheet = document.getElementById("overlaySheet");
  const closeSheet = document.getElementById("closeSheet");
  const addButton = document.getElementById("add-btn");
  
 
  // Elemen UI baru
  const photoToggleBtn = document.getElementById('photo-toggle-btn');
  const videoToggleBtn = document.getElementById('video-toggle-btn');
  const captureBtn = document.getElementById('capture-btn');

  const countdownTimerEl = document.getElementById('countdown-timer'); // ** Tambahkan ini **
  let countdownInterval; // ** Tambahkan ini **
  let countdownTime = 30; // ** Tambahkan ini **


  // ** Fungsi untuk memulai hitung mundur **
  function startCountdown() {
      countdownTime = 30;
      countdownTimerEl.textContent = '00:30';
      countdownTimerEl.style.display = 'block';

      countdownInterval = setInterval(() => {
          countdownTime--;
          const minutes = Math.floor(countdownTime / 60);
          const seconds = countdownTime % 60;
          const formattedTime = `0${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
          countdownTimerEl.textContent = formattedTime;

          if (countdownTime <= 0) {
              clearInterval(countdownInterval);
              // Panggil fungsi untuk menghentikan perekaman
              stopVideoRecording();
              countdownTimerEl.style.display = 'none';
          }
      }, 1000);
  }

  // ** Fungsi untuk menghentikan hitung mundur **
  function stopCountdown() {
      clearInterval(countdownInterval);
      countdownTimerEl.style.display = 'none';
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
      const positionY = -0.6;
      const positionZ = -1;
      watermarkMesh.position.set(positionX, positionY, positionZ);
      
      // Menggunakan renderOrder yang tinggi untuk memastikan selalu di atas
      watermarkMesh.renderOrder = 999;
      
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
    mindarThree = new MindARThree(mindarConfig);
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

  try {
    const camBtn = document.getElementById('cam-btn');
    if (camBtn) {
      // function updateLabel(){ camBtn.textContent = (currentFacingMode === 'environment') ? 'Front Cam' : 'Rear Cam'; }
      // updateLabel();
      camBtn.addEventListener('click', async () => {
        if (camBtn.disabled) return;
        try {
          camBtn.disabled = true;
          // camBtn.textContent = 'Switching...';
          console.log('Attempting camera switch from', currentFacingMode, 'to', (currentFacingMode === 'environment') ? 'user' : 'environment');

          await mindarThree.switchCamera();
          
          currentFacingMode = (currentFacingMode === 'environment') ? 'user' : 'environment';
          // updateLabel();
          if (statusEl) statusEl.textContent = `Camera switched to ${currentFacingMode}`;
          console.log('Camera switch successful:', currentFacingMode);
        } catch (error) {
          console.error('Camera switch failed:', error);
          if (statusEl) statusEl.textContent = `Camera switch failed: ${error.message}`;
        } finally {
          camBtn.disabled = false;
        }
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
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(videoElement, -offscreenCanvas.width, 0, offscreenCanvas.width, offscreenCanvas.height);
        ctx.restore();

        // Gambar stiker AR dari canvas WebGL di atas video
        ctx.drawImage(glCanvas, 0, 0);

        const dataURL = offscreenCanvas.toDataURL('image/png');
        showPreview(dataURL, 'photo');
      } catch (error) {
        console.error('Failed to draw canvas or save photo:', error);
        if (statusEl) statusEl.textContent = 'Failed to capture photo. Try again.';
      }
    });
  }
  
function showLoader(message = 'Mengonversi video...') {
    // Ambil elemen dari DOM di dalam fungsi
    const loaderOverlay = document.querySelector('.loader-overlay'); // <-- Menargetkan kelas
    if (loaderOverlay) {
        // ... (logika menampilkan)
        loaderOverlay.classList.remove('hidden');
        loaderOverlay.pointerEvents = 'none'; 
        photoToggleBtn.disabled = true; // **NONAKTIFKAN TOMBOL PHOTO MODE**
        const camBtn = document.getElementById('cam-btn');
        if (camBtn) {
            camBtn.disabled = true; 
        }
        addButton.disabled = true; // Nonaktifkan tombol add saat loader aktif
        captureBtn.disabled = true; // Nonaktifkan tombol capture saat loader aktif
    }
}

function hideLoader() {
    // Ambil elemen dari DOM di dalam fungsi
    const loaderOverlay = document.querySelector('.loader-overlay'); // <-- Menargetkan kelas
    if (loaderOverlay) {
        // ... (logika menyembunyikan)
        loaderOverlay.classList.add('hidden');
        // loaderOverlay.pointerEvents = 'none'; // Nonaktifkan interaksi mouse setelah disembunyikan
        photoToggleBtn.disabled = false; // **NONAKTIFKAN TOMBOL PHOTO MODE**
        const camBtn = document.getElementById('cam-btn');
        if (camBtn) {
            camBtn.disabled = false; 
        }
        addButton.disabled = false; // Aktifkan kembali tombol add setelah loader disembunyikan
        captureBtn.disabled = false; // Aktifkan kembali tombol capture setelah loader disembunyikan
    }
}

  function startVideoRecording() {

    if (!mindarThree || !mindarThree.renderer || !mindarThree.renderer.domElement || !mindarThree.video || isRecording) return;
    
    if (renderer && renderer.setAnimationLoop) renderer.setAnimationLoop(null);

    const camBtn = document.getElementById('cam-btn');
    if (camBtn) {
        camBtn.disabled = true; // **NONAKTIFKAN TOMBOL SAAT MEREKAM**
    }

    if (photoToggleBtn) {
        photoToggleBtn.disabled = true; // **NONAKTIFKAN TOMBOL PHOTO MODE**
    }

    overlay.style.display = 'none';

    recordingCanvas = document.createElement('canvas');
    recordingCanvas.width = mindarThree.renderer.domElement.width;
    recordingCanvas.height = mindarThree.renderer.domElement.height;
    recordingCtx = recordingCanvas.getContext('2d');
    
    const stream = recordingCanvas.captureStream(30);
    recordedBlobs = [];
    
    let mimeType = 'video/mp4; codecs="avc1.424028, mp4a.40.2"';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
        console.warn('Perekaman MP4 tidak didukung. Beralih ke WebM.');
        mimeType = 'video/webm; codecs=vp9';
        if (statusEl) statusEl.textContent = 'Perekaman MP4 tidak didukung. Rekaman akan disimpan sebagai WebM.';
    }

    try {
        mediaRecorder = new MediaRecorder(stream, { mimeType });
    } catch (e) {
        console.error('Exception while creating MediaRecorder:', e);
        if (statusEl) statusEl.textContent = 'Video recording not supported.';
        return;
    }
    
    mediaRecorder.onstop = (event) => {
      console.log('Recorder stopped, starting processing.', event);;
      const superBuffer = new Blob(recordedBlobs, { type: mediaRecorder.mimeType });

      // PENTING: Panggil fungsi baru untuk upload dan konversi di sini.
      handleFinalProcessing(superBuffer, mediaRecorder.mimeType);

      // Lanjutkan dengan logika MindAR/Renderer cleanup yang sudah ada
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
      // Pastikan renderer me-render frame terbaru
      renderer.render(scene, camera);
      
      // Bersihkan kanvas perekaman terlebih dahulu
      recordingCtx.clearRect(0, 0, recordingCanvas.width, recordingCanvas.height);

      recordingCtx.save();
      recordingCtx.scale(-1, 1);
      recordingCtx.drawImage(videoElement, -recordingCanvas.width, 0, recordingCanvas.width, recordingCanvas.height);
      recordingCtx.restore();

      // Gambar stiker AR dari canvas WebGL di atas video
      recordingCtx.drawImage(glCanvas, 0, 0);

      videoRecordLoop = requestAnimationFrame(drawFrame);
    }
    videoRecordLoop = requestAnimationFrame(drawFrame);

    mediaRecorder.start();
    isRecording = true;
    if (statusEl) statusEl.textContent = 'Recording...';
    console.log('Video recording started');
    // ** Tambahkan panggilan ke fungsi startCountdown di sini **
    startCountdown();
  }
function showPreview(url, type) {
  // ** NEW: Simpan URL dan tipe pratinjau saat ini **
  currentPreviewUrl = url;
  currentPreviewType = type;
  if (type === 'photo') {
    previewImage.src = url;
    previewImage.style.display = 'block';
    previewVideo.style.display = 'none';
  } else {
    previewVideo.src = url;
    previewVideo.style.display = 'block';
    previewImage.style.display = 'none';
  }
    // Logika baru untuk menyembunyikan tombol Save di iOS
  if (isIOS) {
    shareButton.classList.remove('hidden');
    console.log('Detected iOS. Hiding Save button for all media types.');
  } else {
    saveButton.classList.remove('hidden');
    shareButton.classList.remove('hidden'); // Tampilkan tombol Save
  }

  overlay.style.display = 'none';
  previewContainer.classList.remove('hidden');
  previewContainer.style.pointerEvents = 'auto';
  if (statusEl) statusEl.textContent = 'Previewing ' + type;

  if (renderer && renderer.setAnimationLoop) {
      renderer.setAnimationLoop(null);
      console.log('MindAR animation loop paused for preview.');
  }
}

async function stopVideoRecording() {
    
    if (!isRecording || !mediaRecorder) return;

    // 1. KRITIS: Hentikan loop animasi terlebih dahulu
    if (videoRecordLoop) {
        cancelAnimationFrame(videoRecordLoop); // HENTIKAN PANGGILAN drawFrame BERIKUTNYA
        videoRecordLoop = null; // (Opsional) pastikan loop di-reset
    }
    
    if (photoToggleBtn) {
        photoToggleBtn.disabled = false;
    }

    mediaRecorder.stop(); 
    isRecording = false;
    stopCountdown();

    // 2. Lakukan Reset Variabel
    // RESET HANYA DILAKUKAN SETELAH LOOP DI ATAS DIHENTIKAN
    recordingCanvas = null;
    recordingCtx = null;
    recordedBlobs = [];
    
    // ... (Logika handleFinalProcessing akan berjalan di onstop) ...

    const camBtn = document.getElementById('cam-btn');
    if (camBtn) {
        camBtn.disabled = false; 
    }
}
  
  // Fungsi untuk menyembunyikan pratinjau
function hidePreview() {
    const previewContainer = document.getElementById('preview-container');

    if (previewContainer) {
        // Sembunyikan pratinjau
        previewContainer.classList.add('hidden');

        // Nonaktifkan interaksi mouse PADA kontainer pratinjau
        // Ini akan membiarkan klik menembus ke stiker di belakangnya
        previewContainer.style.pointerEvents = 'none';
        
         if (renderer && renderer.setAnimationLoop) {
            renderer.setAnimationLoop(() => {
                try {
                    if (renderer && scene && camera) {
                        renderer.render(scene, camera); 
                        updateSelectionOverlay(); // Sekarang akan memeriksa `previewContainer.classList.contains('hidden')`
                        updateStickerPositions();
                    }
                } catch (error) {
                    console.error('Render loop error:', error);
                    if (statusEl) statusEl.textContent = 'Render error occurred';
                }
            });
            console.log('MindAR animation loop resumed after preview.');
          }
    }
}

  // Fungsi untuk menyimpan file
  function saveFile(url, filename) {
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      //link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      if (statusEl) statusEl.textContent = 'File berhasil diunduh!';
  }

  async function saveFileAsBlob(url, filename) {
    try {
        const response = await fetch(url);
        
        // Jika response OK, ubah ke Blob
        const blob = await response.blob();
        
        // Buat URL lokal (Blob URL)
        const blobUrl = URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = filename;
        
        document.body.appendChild(link);
        link.click();
        
        // Bersihkan setelah selesai
        document.body.removeChild(link);
        URL.revokeObjectURL(blobUrl); 
        
        if (statusEl) statusEl.textContent = 'File berhasil diunduh!';
        
    } catch (error) {
        console.error('Gagal mengambil file karena CORS atau error lainnya:', error);
    }
}

   // Fungsi untuk berbagi file menggunakan Web Share API
  async function shareFile(url, filename, mimeType) {
      if (navigator.share) {
        
          try {
              const response = await fetch(url);
              const blob = await response.blob();
              const file = new File([blob], filename, { type: mimeType });
              await navigator.share({
                  files: [file],
                  title: 'The Recharge Room by Lenovo',
                  text: 'Currently Out of Office — recharging, BRB! 😴',
              });
              if (statusEl) statusEl.textContent = 'Berbagi berhasil!';
          } catch (error) {
              console.error('Gagal berbagi:', error);
              if (statusEl) statusEl.textContent = 'Berbagi gagal.';
          }
      } else {
          alert('Fitur berbagi tidak didukung di browser ini.');
          if (statusEl) statusEl.textContent = 'Berbagi tidak didukung.';
      }
  }
  
  // Fungsi baru untuk berbagi video
  async function shareVideoFile(url) {
      if (!navigator.share) {
          alert('Fitur berbagi tidak didukung di browser ini.');
          if (statusEl) statusEl.textContent = 'Berbagi tidak didukung.';
          return;
      }
      // if (isAndroid){
      //     const response = await fetch(url);
      //     const blob = await response.blob();
      // }else{
      try {
          const response = await fetch(url);
          const blob = await response.blob();
          
          let targetMime = blob.type;
            if (blob.type.includes('webm')) {
            targetMime = 'video/webm';
            console.warn('Mencoba berbagi video WebM. Beberapa aplikasi mungkin tidak mendukungnya.');
         }
        const file = new File([blob],`ar-video.${targetMime.includes('mp4') ? 'mp4' : 'webm'}`, { type: targetMime });
          await navigator.share({
              files: [file],
              title: 'Recharge Room by Lenovo',
              text: 'Currently Out of Office — recharging, BRB! 😴',
          });
          if (statusEl) statusEl.textContent = 'Berbagi berhasil!';
      } catch (error) {
          console.error('Gagal berbagi:', error);
          if (statusEl) statusEl.textContent = `Berbagi gagal: ${error.message}`;
      }
    // }
  }

  // Event listener untuk tombol keluar baru
  closeButton.addEventListener('click', () => {
      previewContainer.classList.add('hidden');
      if (previewVideo) {
          previewVideo.pause();
          previewVideo.removeAttribute('src'); // Menghapus sumber untuk memuat ulang
          previewVideo.load();
          stopCountdown();
          hidePreview();
      }
  });

  // Left button -> open bottom sheet
  addButton.addEventListener("click", () => {
    overlaySheet.classList.add("active");
    bottomSheet.classList.add("active");
  });

  // Close sheet
  closeSheet.addEventListener("click", (e) => {
    overlaySheet.classList.remove("active");
    bottomSheet.classList.remove("active");
  });

  // Fungsionalitas baru untuk tombol toggle Photo/Video
  function setMode(mode) {
    currentMode = mode;
    if (mode === 'photo') {
      photoToggleBtn.classList.add('active');
      videoToggleBtn.classList.remove('active');
      if (statusEl) statusEl.textContent = 'Mode: Photo';
    } else if (mode === 'video') {
      videoToggleBtn.classList.add('active');
      photoToggleBtn.classList.remove('active');
      if (statusEl) statusEl.textContent = 'Mode: Video';
    }
  }

  // Pengaturan mode awal
  setMode('photo');

  // Menangani klik pada tombol toggle "Photo"
  photoToggleBtn.addEventListener('click', () => {
    if (currentMode !== 'photo') {
      setMode('photo');
      console.log('Mode: Photo');
    }
  });

  // Menangani klik pada tombol toggle "Video"
  videoToggleBtn.addEventListener('click', () => {
    if (currentMode !== 'video') {
      setMode('video');
      console.log('Mode: Video');
    }
  });
  
  // Menangani klik pada tombol "Capture"
  captureBtn.addEventListener('click', async () => {
    if (currentMode === 'photo') {
      takePhoto();
    } else if (currentMode === 'video') {
      if (isRecording) {
        stopVideoRecording();
      } else {
      
        startVideoRecording();
      }
    }
  });

  const loadCanvasTexture = (url) => new Promise((resolve, reject) => {
    const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => {
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const cx = c.getContext('2d'); cx.drawImage(img, 0, 0);
      const tex = new THREE.CanvasTexture(c);
      resolve(tex);
    }; img.onerror = reject; img.src = url;
  });
  
  const preloadImage = (url) => new Promise((resolve, reject) => {
    if (!url) {
        reject(new Error('No URL provided'));
        return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
        console.log('Image preloaded successfully:', url);
        try {
            preloadedImageCache.set(url, img);
        } catch (_) {}

        resolve(img);
    };

    img.onerror = (error) => {
        console.error('Failed to preload image:', url, error);
        reject(new Error('Image load failed'));
    };

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
    afk: { name: 'AFK', anchor: 10, size: [1.0, 0.6], src: '/stickers/AFK.svg', mobileOffset: { x: 0, y: 0.2, z: 0.02 } },
    battery: { name: 'Battery', anchor: 10, size: [1.0, 0.6], src: '/stickers/Battery.svg', mobileOffset: { x: 0, y: 0.2, z: 0.02 } },
    clouds: { name: 'Clouds', anchor: 10, size: [1.0, 0.6], src: '/stickers/Clouds.svg', mobileOffset: { x: 0, y: 0.2, z: 0.02 } },
    detox: { name: 'Detox', anchor: 10, size: [1.0, 0.6], src: '/stickers/Detox.svg', mobileOffset: { x: 0, y: 0.2, z: 0.02 } },
    dnd: { name: 'DND', anchor: 10, size: [1.0, 0.6], src: '/stickers/DND.svg', mobileOffset: { x: 0, y: 0.2, z: 0.02 } },
    lightning: { name: 'Lightning', anchor: 10, size: [1.0, 0.6], src: '/stickers/Lightning.svg', mobileOffset: { x: 0, y: 0.2, z: 0.02 } },
    crown: { name: 'Crown', anchor: 10, size: [1.0, 0.6], src: '/stickers/Pixel Crown.svg', mobileOffset: { x: 0, y: 0.2, z: 0.02 } },
    heart: { name: 'Heart', anchor: 10, size: [1.0, 0.6], src: '/stickers/Pixel Heart.svg', mobileOffset: { x: 0, y: 0.2, z: 0.02 } },
    sparkles: { name: 'Sparkles', anchor: 10, size: [1.0, 0.6], src: '/stickers/Sparkles.svg', mobileOffset: { x: 0, y: 0.2, z: 0.02 } },
    zzz: { name: 'ZZZ', anchor: 10, size: [1.0, 0.6], src: '/stickers/ZZZ.svg', mobileOffset: { x: 0, y: 0.2, z: 0.02 } },
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
    const def = stickers[key]; 
    if (!def || !def.src) return null;
    
    if (key === 'uploaded' && (!def.size || def.size.length !== 2)) {
        console.error('Uploaded sticker size is not defined correctly.');
        return null;
    }
    
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
    document.querySelectorAll(' .thumb').forEach(el => {
      if (!key) { el.classList.remove('active'); return; }
      el.classList.toggle('active', el.getAttribute('data-add') === key);
    });
    if (key) {
      const sel = document.querySelector(` .thumb[data-add="${key}"]`);
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

  async function handleFinalProcessing(videoBlob, mimeType) {
    showLoader();
    console.log('Starting Final Processing (Upload & Convert)');

    // Nama file harus unik
    const fileName = `input/${Date.now()}.webm`; 

    try {
        // 1. UPLOAD LANGSUNG KE SUPABASE STORAGE
        const { error: uploadError } = await supabase.storage
            .from('videos-dev') 
            .upload(fileName, videoBlob, {
                cacheControl: '3600',
                upsert: false,
                contentType: mimeType,
            });

        if (uploadError) throw new Error(`Supabase Upload Gagal: ${uploadError.message}`);

        // 2. Dapatkan Public URL
        const { data: publicUrlData } = supabase.storage
            .from('videos-dev')
            .getPublicUrl(fileName);

        const videoUrl = publicUrlData.publicUrl;
        console.log('Video berhasil diupload ke:', videoUrl);
        
        // 3. PANGGIL VERCEL API
        const response = await fetch('/api/convert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                inputUrl: videoUrl,
                inputFileName: fileName, 
            }),
        });

        if (!response.ok) {
            const errorBody = await response.json(); 
            throw new Error(`Konversi API gagal: ${response.status} - ${errorBody.message || 'Unknown Error'}`);
        }
        

        // 4. Menerima URL MP4 yang sudah dikonversi
        const { outputUrl } = await response.json(); 
        
        showPreview(outputUrl, 'video');
        console.log('[CLIENT LOG: OUTPUT URL RECEIVED] Data yang diterima:', outputUrl);

    } catch (error) {
        console.error('Alur Video Gagal Total:', error.message);
        if (statusEl) statusEl.textContent = `Perekaman Gagal: ${error.message}`;

    } finally {
        // Sembunyikan loader
        hideLoader();

        // Reset variabel perekaman
        // Hapus kode recordedBlobs = []; karena onstop sudah selesai.
        recordingCanvas = null;
        recordingCtx = null;
        if (recordedBlobs) recordedBlobs.length = 0; // Bersihkan array untuk rekaman berikutnya

        const camBtn = document.getElementById('cam-btn');
        if (camBtn) camBtn.disabled = false;
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
  bar.append(btnReset, btnDel);
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
    const previewContainer = document.getElementById('preview-container');
    const isPreviewActive = previewContainer && !previewContainer.classList.contains('hidden');

     if (isPreviewActive || !active || !instances[active] || !instances[active].visible) { 
        overlay.style.display = 'none'; 
        return; // Hentikan fungsi jika pratinjau aktif atau stiker tidak aktif/terlihat
    }
    
    overlay.style.display = 'block';

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
      // Perbaikan: Ubah operator dari '-' menjadi '+'
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

  document.querySelectorAll(' .thumb').forEach(btn => {
    const key = btn.getAttribute('data-add');
    const imgEl = btn.querySelector('img');
    
    if (key === 'afk') { imgEl.src = '/stickers/AFK.svg'; } 
    else if (key === 'battery') { imgEl.src = '/stickers/Battery.svg'; }
    else if (key === 'clouds') { imgEl.src = '/stickers/Clouds.svg'; }
    else if (key === 'detox') { imgEl.src = '/stickers/Detox.svg'; }
    else if (key === 'dnd') { imgEl.src = '/stickers/DND.svg'; }
    else if (key === 'lightning') { imgEl.src = '/stickers/Lightning.svg'; }
    else if (key === 'crown') { imgEl.src = '/stickers/Pixel Crown.svg'; }
    else if (key === 'heart') { imgEl.src = '/stickers/Pixel Heart.svg'; }
    else if (key === 'sparkles') { imgEl.src = '/stickers/Sparkles.svg'; }
    else if (key === 'zzz') { imgEl.src = '/stickers/ZZZ.svg'; }
    else if (key === 'uploaded') {
      if (imgUrl) {
        btn.classList.add('loading');
        preloadImage(imgUrl).then((img) => {
          if (img) {
            imgEl.src = imgUrl; 
            btn.classList.remove('loading'); 
            btn.classList.remove('disabled'); 
            console.log('Uploaded image ready for use');
          } else {
            console.warn('Uploaded image failed to load, falling back to default'); 
            imgEl.src = '/stickers/AFK.svg'; 
            btn.classList.remove('loading'); 
            btn.classList.add('disabled'); 
            if (statusEl) statusEl.textContent = 'Uploaded image failed to load'; 
          }
        }).catch((error) => { 
          console.error('Failed to load uploaded image:', error); 
          imgEl.src = '/stickers/AFK.svg'; 
          btn.classList.remove('loading'); 
          btn.classList.add('disabled'); 
          if (statusEl) statusEl.textContent = 'Uploaded image failed to load'; 
        });
      } else {
        imgEl.src = '/stickers/AFK.svg';
        btn.classList.add('disabled');
        console.warn('No uploaded image URL available');
      }
    }
    
    btn.addEventListener('click', async () => {
      if (key === 'uploaded' && imgUrl) {
        const img = preloadedImageCache.get(imgUrl);
        if (img) {
          const aspectRatio = img.naturalWidth / img.naturalHeight || 1;
          const baseWidth = 1.1;
          const newHeight = baseWidth / aspectRatio;

          stickers.uploaded = {
            name: 'Uploaded',
            anchor: 168,
            size: [baseWidth, newHeight],
            src: imgUrl,
            mobileOffset: { x: 0, y: 0, z: 0.02 }
          };
          console.log(`Updated uploaded sticker size: [${baseWidth}, ${newHeight}]`);
        } else {
          console.error('Uploaded image not in cache. Cannot create sticker.');
          if (statusEl) statusEl.textContent = 'Error: Image not ready.';
          return;
        }
      }

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
  
  try {
    const startPromise = mindarThree.start();
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Camera start timeout')), 15000));
    await Promise.race([startPromise, timeoutPromise]);
    
    await setupWatermark();

    if (watermarkMesh) {
      scene.add(watermarkMesh);
    }
    
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
      if (v) { v.setAttribute('playsinline', ''); v.playsinline = true; v.muted = true; v.autoplay = true; if (isMobile) { v.style.objectFit = 'cover'; } }
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
          if (watermarkMesh) {
              watermarkMesh.position.set(0, -0.6, -1);
          }

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
  
  // ** NEW: Tambahkan event listeners untuk tombol Save dan Share **
  saveButton.addEventListener('click', function(event) {
    if (currentPreviewUrl) {
      const filename = currentPreviewType === 'photo' ? 'The Recharge Room by Lenovo.png' : 'The Recharge Room by Lenovo.mp4';
      // saveFile(currentPreviewUrl, filename); 
      saveFileAsBlob(currentPreviewUrl, filename);
    }
  });

  shareButton.addEventListener('click', () => {
    if (currentPreviewUrl) {
      if (currentPreviewType === 'photo') {
        shareFile(currentPreviewUrl, 'photo.png', 'image/png');
      } else {
        shareVideoFile(currentPreviewUrl);
      }
    }
  });


  
  async function maybeRecoverCamera(){
    try {
      const v = mindarThree && mindarThree.video;
      const live = v && v.srcObject && typeof v.srcObject.getVideoTracks === 'function' && v.srcObject.getVideoTracks().some(tr => tr.readyState === 'live');
      const playing = v && !v.paused && !v.ended && v.readyState >= 2;
      if (!live || !playing) {
        await mindarThree.switchCamera();
      }
    } catch (e) {
      console.warn('Camera recovery failed:', e);
    }
  }
  window.addEventListener('pageshow', () => setTimeout(maybeRecoverCamera, 300));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(maybeRecoverCamera, 300); });
  
})();
/**
 * Fungsi untuk berbagi file dengan aman, setelah memvalidasi tipe dan dukungan sistem.
 * @param {File} fileToShare - Objek file yang akan dibagikan.
 */
async function shareFileSafely(fileToShare) {
    // 1. Validasi Tipe File (MIME Type)
    const allowedMimeTypes = ['video/mp4', 'video/webm', 'image/jpeg', 'image/png', 'image/gif'];
    if (!allowedMimeTypes.includes(fileToShare.type)) {
        alert(`Maaf, format file ${fileToShare.type} tidak didukung untuk dibagikan.`);
        return;
    }

    // 2. Siapkan data untuk dibagikan dan divalidasi
    const shareData = {
        title: `Bagikan File: ${fileToShare.name}`,
        files: [fileToShare],
    };

    // 3. Gunakan navigator.canShare() untuk memastikan dukungan sistem
    if (navigator.share && navigator.canShare(shareData)) {
        try {
            // Jika didukung, panggil navigator.share()
            await navigator.share(shareData);
            console.log('File berhasil dibagikan!');
        } catch (error) {
            // Menangani kasus jika pengguna membatalkan dialog share atau ada error lain
            if (error.name !== 'AbortError') {
                console.error('Terjadi kesalahan saat mencoba berbagi:', error);
                alert(`Error: ${error.message}`);
            } else {
                console.log('Pengguna membatalkan proses berbagi.');
            }
        }
    } else {
        // Jika tidak didukung, berikan feedback ke pengguna
        console.warn('Pembagian file tidak didukung oleh browser/OS ini.');
        alert('Maaf, fitur berbagi tidak tersedia di perangkat atau browser Anda.');
    }
}

// --- Cara Menggunakannya ---

// Misalkan Anda memiliki file dari input atau dibuat secara dinamis
const myBlob = new Blob(['konten video palsu'], { type: 'video/mp4' });
const myFile = new File([myBlob], 'video_keren.mp4', { type: 'video/mp4' });

// Panggil fungsi tersebut, misalnya dari sebuah event listener tombol
// document.getElementById('shareButton').onclick = () => shareFileSafely(myFile);