function App() {
  const [file, setFile] = React.useState(null);
  const [previewUrl, setPreviewUrl] = React.useState(null);
  const [uploadResp, setUploadResp] = React.useState(null);
  const [errorMsg, setErrorMsg] = React.useState('');
  const [bgRemoving, setBgRemoving] = React.useState(false);
  const [refining, setRefining] = React.useState(false); // repurposed as 'picking subject' mode
  const [clickPoint, setClickPoint] = React.useState(null); // {x,y} in preview canvas coords
  const [uploading, setUploading] = React.useState(false);
  const [uploadStage, setUploadStage] = React.useState('');
  const qrRef = React.useRef(null);
  const imgRef = React.useRef(null);
  const overlayRef = React.useRef(null);
  
  // Menambahkan deklarasi variabel status yang hilang
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [progress, setProgress] = React.useState({ text: '' });
  const [activeFile, setActiveFile] = React.useState(null);
  const onClose = () => {
    setActiveFile(null);
    setUploadResp(null);
  };
  
  const token = localStorage.getItem("token");
  if (!token) {
    window.location.href = "home.html";
  }

  const item = JSON.parse(token);
  const now = new Date();
  const date = now.getDate();

  if (now.getDate() != item.expired) {
    console.log("date", date);
    localStorage.removeItem("token");
    window.location.href = "home.html";
  }

  const waitForOrt = React.useCallback(() => {
    if (window.ort && window.ort.InferenceSession) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const started = Date.now();
      (function check(){
        if (window.ort && window.ort.InferenceSession) return resolve();
        if (Date.now() - started > 15000) return reject(new Error('ONNX Runtime not loaded'));
        setTimeout(check, 100);
      })();
    });
  }, []);

  const onChoose = (e) => {
    const f = e.target.files?.[0];
    setFile(f || null);
    setUploadResp(null);
    setErrorMsg('');
    if (f) setPreviewUrl(URL.createObjectURL(f));
    else setPreviewUrl(null);
    setRefining(false);
    setClickPoint(null);
  };

  const onDrop = (event) => {
    event.preventDefault();
    if (event.dataTransfer.files && event.dataTransfer.files[0]) {
      const file = event.dataTransfer.files[0];
      onChoose({ target: { files: [file] } });
    }
  };

  const onDragOver = (event) => {
    event.preventDefault();
  };

  const doUpload = async () => {
    if (!file) return;
    setErrorMsg('');
    setUploading(true);
    setIsProcessing(true); // Mengatur status pemrosesan
    setUploadStage('uploading');
    
    try {
      const fd = new FormData();
      fd.append('image', file);
      const resp = await fetch('/api/upload', { method: 'POST', body: fd });
      
      if (!resp.ok) {
        try {
          const data = await resp.json();
          setErrorMsg(data?.error + (data?.details ? `: ${data.details}` : ''));
        } catch (_) {
          const text = await resp.text();
          setErrorMsg(text || 'Upload failed');
        }
        return;
      }
      
      setUploadStage('processing');
      await new Promise(res => setTimeout(res, 500));
      
      const data = await resp.json();
      setUploadResp(data);
      
      setUploadStage('generating');
      await new Promise(res => setTimeout(res, 500));
      
      setUploadStage('complete');
    } catch (error) {
      console.error('Upload error:', error);
      setErrorMsg('Upload failed: ' + (error.message || 'Network error'));
    } finally {
      setTimeout(() => {
        setUploading(false);
        setUploadStage('');
        setIsProcessing(false); // Mengatur status pemrosesan menjadi false
      }, 1000);
    }
  };

  // Logika untuk membuat QR code
  React.useEffect(() => {
    if (uploadResp && qrRef.current) {
      const genQR = () => {
        if (!qrRef.current) return;
        try {
          qrRef.current.innerHTML = '';
          const viewerUrl = `${location.origin}${uploadResp.viewerUrl}`;
          new QRCode(qrRef.current, {
            text: viewerUrl,
            width: 250,
            height: 250,
          });
        } catch (e) {
          console.error('QR generation failed:', e);
        }
      };

      if (document.readyState === 'complete') {
        requestAnimationFrame(() => requestAnimationFrame(genQR));
      } else {
        window.addEventListener('load', genQR, { once: true });
      }
    }
  }, [uploadResp]);

  const doBgRemove = async () => {
    if (!file) return;
    setErrorMsg('');
    setBgRemoving(true);
    try {
      await waitForOrt();
      const img = await loadImageElement(previewUrl);

      const { canvas, blob } = await removeBackgroundWithU2Net(img, { clickPoint, overlay: overlayRef.current, displayImgEl: imgRef.current });
      const newUrl = URL.createObjectURL(blob);
      setPreviewUrl(newUrl);
      const stem = (file.name || 'image').replace(/\.[^.]+$/, '');
      const newFile = new File([blob], `${stem}-nobg.png`, { type: 'image/png' });
      setFile(newFile);
      setRefining(false);
      setClickPoint(null);
    } catch (e) {
      console.error('Background removal failed:', e);
      const friendly = (e && e.message) || 'ONNX processing error';
      setErrorMsg('Background removal failed: ' + friendly);
    } finally {
      setBgRemoving(false);
    }
  };

  const logout = async()=>{
    const token = localStorage.getItem("token");
    localStorage.removeItem("token");
    window.location.href = "home.html";
  }

  React.useEffect(() => {
    const cvs = overlayRef.current;
    const img = imgRef.current;
    if (!cvs || !img) return;
    const wrap = cvs.parentElement;
    function syncSize(){
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cvs.width = Math.max(1, Math.floor(rect.width * dpr));
      cvs.height = Math.max(1, Math.floor(rect.height * dpr));
      cvs.style.width = rect.width + 'px';
      cvs.style.height = rect.height + 'px';
      const ctx = cvs.getContext('2d');
      ctx.setTransform(1,0,0,1,0,0);
      ctx.scale(dpr, dpr);
      ctx.clearRect(0,0,rect.width,rect.height);
    }
    syncSize();
    window.addEventListener('resize', syncSize);
    return () => window.removeEventListener('resize', syncSize);
  }, [previewUrl, refining]);

  React.useEffect(() => {
    const cvs = overlayRef.current; if (!cvs) return;
    const ctx = cvs.getContext('2d');
    function pt(e){ const rect = cvs.getBoundingClientRect(); return { x: e.clientX - rect.left, y: e.clientY - rect.top }; }
    function drawMarker(p){
      const rect = cvs.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      ctx.save();
      ctx.setTransform(1,0,0,1,0,0);
      ctx.scale(dpr, dpr);
      ctx.clearRect(0,0,rect.width,rect.height);
      if (p) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, Math.PI*2);
        ctx.fillStyle = 'rgba(0,150,255,0.8)';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'white';
        ctx.stroke();
      }
      ctx.restore();
    }
    function down(e){ if (!refining) return; const p = pt(e); setClickPoint(p); drawMarker(p); e.preventDefault(); }
    cvs.addEventListener('pointerdown', down);
    drawMarker(clickPoint);
    return () => { cvs.removeEventListener('pointerdown', down); };
  }, [refining, clickPoint]);

  function loadImageElement(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  async function removeBackgroundWithU2Net(imgEl, opts) {
    const maxSide = 1280;
    const scale = Math.min(1, maxSide / Math.max(imgEl.naturalWidth, imgEl.naturalHeight));
    const w = Math.max(1, Math.round(imgEl.naturalWidth * scale));
    const h = Math.max(1, Math.round(imgEl.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgEl, 0, 0, w, h);

    const inputSize = 320;
    const inCvs = document.createElement('canvas');
    inCvs.width = inputSize; inCvs.height = inputSize;
    const inCtx = inCvs.getContext('2d');
    inCtx.drawImage(canvas, 0, 0, inputSize, inputSize);
    const imgData = inCtx.getImageData(0, 0, inputSize, inputSize);

    const nchw = new Float32Array(1 * 3 * inputSize * inputSize);
    for (let y=0; y<inputSize; y++) {
      for (let x=0; x<inputSize; x++) {
        const idx = (y*inputSize + x) * 4;
        const r = imgData.data[idx] / 255;
        const g = imgData.data[idx+1] / 255;
        const b = imgData.data[idx+2] / 255;
        const base = y*inputSize + x;
        nchw[0*inputSize*inputSize + base] = r;
        nchw[1*inputSize*inputSize + base] = g;
        nchw[2*inputSize*inputSize + base] = b;
      }
    }

    const ort = window.ort;
    const session = await getU2NetSession();
    const feeds = {};
    const inputName = session.inputNames[0];
    feeds[inputName] = new ort.Tensor('float32', nchw, [1,3,inputSize,inputSize]);
    const results = await session.run(feeds);
    const outName = session.outputNames[0];
    const out = results[outName];
    const outDims = out.dims;
    const outW = outDims[outDims.length-1];
    const outH = outDims[outDims.length-2];
    const sal = out.data;

    const salImage = new ImageData(outW, outH);
    for (let i=0;i<outW*outH;i++) {
      const v = Math.max(0, Math.min(1, sal[i]));
      const p = i*4;
      const g = Math.round(v*255);
      salImage.data[p]=g; salImage.data[p+1]=g; salImage.data[p+2]=g; salImage.data[p+3]=255;
    }
    const salCvs = document.createElement('canvas');
    salCvs.width = outW; salCvs.height = outH;
    salCvs.getContext('2d').putImageData(salImage, 0, 0);
    const salUp = document.createElement('canvas');
    salUp.width = w; salUp.height = h;
    const su = salUp.getContext('2d');
    su.imageSmoothingEnabled = true;
    su.drawImage(salCvs, 0, 0, w, h);
    const salUpImg = su.getImageData(0, 0, w, h);

    const thr = 128;
    const bin = new Uint8ClampedArray(w*h);
    for (let i=0;i<w*h;i++) bin[i] = salUpImg.data[i*4] >= thr ? 1 : 0;

    let mask = bin;
    const pick = opts && opts.clickPoint ? opts.clickPoint : null;
    if (pick) {
      const dispRect = opts.displayImgEl.getBoundingClientRect();
      const px = Math.round(pick.x / dispRect.width * w);
      const py = Math.round(pick.y / dispRect.height * h);
      mask = keepConnected(mask, w, h, px, py);
    } else {
      mask = keepLargestComponent(bin, w, h);
    }

    const alpha = featherMask(mask, w, h, 2);

    const outImg = ctx.getImageData(0, 0, w, h);
    for (let i=0;i<w*h;i++) outImg.data[i*4+3] = alpha[i];
    ctx.putImageData(outImg, 0, 0);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    return { canvas, blob };
  }

  const getU2NetSession = (() => {
    let sessionPromise = null;
    return function(){
      if (sessionPromise) return sessionPromise;
      const ort = window.ort;
      const modelUrl = '/models/u2netp.onnx';
      sessionPromise = ort.InferenceSession.create(modelUrl, { executionProviders: ['wasm'] });
      return sessionPromise;
    }
  })();

  function keepConnected(bin, w, h, sx, sy) {
    const inside = (x,y)=> x>=0 && y>=0 && x<w && y<h;
    const idx = (x,y)=> y*w + x;
    if (!inside(sx,sy) || bin[idx(sx,sy)]===0) return keepLargestComponent(bin, w, h);
    const out = new Uint8ClampedArray(w*h);
    const qx = new Int32Array(w*h);
    const qy = new Int32Array(w*h);
    let qs=0, qe=0;
    qx[qe]=sx; qy[qe]=sy; qe++;
    out[idx(sx,sy)] = 1;
    while (qs<qe) {
      const x=qx[qs], y=qy[qs]; qs++;
      for (let dy=-1; dy<=1; dy++) for (let dx=-1; dx<=1; dx++) {
        if (dx===0 && dy===0) continue;
        const nx=x+dx, ny=y+dy;
        if (!inside(nx,ny)) continue;
        const i=idx(nx,ny);
        if (bin[i] && !out[i]) { out[i]=1; qx[qe]=nx; qy[qe]=ny; qe++; }
      }
    }
    return out;
  }

  function keepLargestComponent(bin, w, h) {
    const inside = (x,y)=> x>=0 && y>=0 && x<w && y<h;
    const idx = (x,y)=> y*w + x;
    const seen = new Uint8Array(w*h);
    let best = null, bestCount = 0;
    const qx = new Int32Array(w*h);
    const qy = new Int32Array(w*h);
    for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
      const i=idx(x,y);
      if (!bin[i] || seen[i]) continue;
      let qs=0, qe=0, count=0;
      qx[qe]=x; qy[qe]=y; qe++;
      seen[i]=1;
      while (qs<qe) {
        const cx=qx[qs], cy=qy[qs]; qs++;
        count++;
        for (let dy=-1; dy<=1; dy++) for (let dx=-1; dx<=1; dx++) {
          if (dx===0 && dy===0) continue;
          const nx=cx+dx, ny=cy+dy; if (!inside(nx,ny)) continue;
          const ni=idx(nx,ny); if (!bin[ni] || seen[ni]) continue;
          seen[ni]=1; qx[qe]=nx; qy[qe]=ny; qe++;
        }
      }
      if (count>bestCount) { bestCount=count; best=[x,y]; }
    }
    if (!best) return bin;
    return keepConnected(bin, w, h, best[0], best[1]);
  }

  function featherMask(bin, w, h, radius) {
    const alpha = new Uint8ClampedArray(w*h);
    for (let i=0;i<w*h;i++) alpha[i] = bin[i] ? 255 : 0;
    if (radius<=0) return alpha;
    const tmp = new Uint8ClampedArray(w*h);
    const passes = Math.max(1, radius);
    for (let p=0;p<passes;p++) {
      for (let y=0;y<h;y++) {
        for (let x=0;x<w;x++) {
          let s=0, c=0;
          for (let k=-1;k<=1;k++) { const nx=x+k; if (nx>=0 && nx<w) { s+=alpha[y*w+nx]; c++; } }
          tmp[y*w+x] = s/c|0;
        }
      }
      for (let y=0;y<h;y++) {
        for (let x=0;x<w;x++) {
          let s=0, c=0;
          for (let k=-1;k<=1;k++) { const ny=y+k; if (ny>=0 && ny<h) { s+=tmp[ny*w+x]; c++; } }
          alpha[y*w+x] = s/c|0;
        }
      }
    }
    return alpha;
  }

  const getProgressState = () => {
    switch(uploadStage) {
      case 'uploading': return { text: 'Uploading...', width: '25%' };
      case 'processing': return { text: 'Processing...', width: '50%' };
      case 'generating': return { text: 'Generating QR...', width: '75%' };
      case 'complete': return { text: 'Complete!', width: '100%' };
      default: return { text: '', width: '0%' };
    }
  }
  const progressState = getProgressState();

  return (
    <div className="app">
      <header class="header">
       <div class="logo-group">
         <img src="assets/Main Page/main-image.png" alt="Recharge Room" class="logo-left"/>
         <img src="assets/Main Page/logo-left.png" alt="Copilot" class="logo-copilot"/>
       </div>
        <div class="header-right">
          <button class="back-btn" onClick={() => window.location.reload()}>
            <img src="assets/Main Page/back.png" alt="Back"></img>
          </button>
          <button class="logout-btn" onClick={logout}>Log out</button>
          <img src="assets/Main Page/logo-right.png" alt="Lenovo" class="logo-right"/>
        </div>
      </header>
      
      <div className="landing">
        <div className="upload-card">
          <div className="upload-flex">
            {/* Dropzone Kiri */}
            <div className="dropzone-container" onDrop={onDrop} onDragOver={onDragOver}>
              <div className={`dropzone ${previewUrl ? 'has-image' : ''}`}>
                <label>
                  {!previewUrl && (
                    <>
                      <img src="assets/Main Page/image icon.png" alt="Upload Icon" />
                     <p style={{margin:0, color: '#3b5cd0'}}>Drag and drop file here or click to browse</p>
                    </>
                  )}
                  <input type="file" accept="image/*" onChange={onChoose} style={{display:'none'}} disabled={uploading} />
                </label>
                {previewUrl && (
                  <div className="preview-image" style={{backgroundImage:`url(${previewUrl})`}} ref={imgRef}>
                      {refining && (
                          <canvas className="overlay-canvas" ref={overlayRef} style={{cursor:'crosshair'}}></canvas>
                      )}
                  </div>
                )}
              </div>
              
              {/* Tombol Aksi (di bawah dropzone) */}
              <div className="actions">
                <div className="row-center">
                  {!refining ? (
                    <>
                      <button className="btn" onClick={doBgRemove} disabled={!file || bgRemoving || uploading}>
                        {bgRemoving ? 'Removing...' : 'Remove Background'}
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="pill" style={{display:'flex',gap:8,alignItems:'center'}}>
                        <span>Tap image to choose subject</span>
                      </div>
                      <button className="btn" onClick={()=> setClickPoint(null)} disabled={!clickPoint}>Clear</button>
                      <button className="btn" onClick={doBgRemove} disabled={bgRemoving}>{bgRemoving ? 'Applying...' : 'Apply'}</button>
                      <button className="btn" onClick={()=>{ setRefining(false); setClickPoint(null); }}>Cancel</button>
                    </>
                  )}
                  <button className="btn" onClick={doUpload} disabled={!file || uploading}>
                    {uploading ? 'Uploading...' : 'Upload & Generate QR'}
                  </button>
                </div>
              </div>
            </div>

            {/* QR Code dan Preview Kanan */}
            <div className="qr-container-main">
              {/* <p style={{marginBottom: '10px'}}>Scan the QR Code to try the filter!</p> */}
              
              {/* Ini adalah elemen QR code yang sekarang selalu ada di halaman */}
                <div className="qr" ref={qrRef}></div>

              {/* Loading bar sekarang ditampilkan secara kondisional di atas QR code */}
              {(uploading || isProcessing) && (
                <div className="loading-bar-container">
                  <div className="loading-bar-fill" style={{ width: progressState.width }}></div>
                  <span className="loading-text">{progressState.text}</span>
                </div>
              )}
              
             <p style={{marginTop: '12px', color: '#3b5cd0'}}>Scan the QR Code to try the filter!</p>
             <p style={{marginTop: '12px', color: '#3b5cd0'}}>Use HTTPS on mobile to allow camera.</p>

              {/* Still Needed For Debuging Purpose */}
              {uploadResp && (
                <div className="results-links">
                  <a className="btn primary" href={uploadResp.viewerUrl} target="_blank" rel="noreferrer">
                    Open AR Viewer
                  </a>
                  <div className="url-display">
                    <span className="url-label">Viewer URL:</span>
                    <span className="url-text">{location.origin}{uploadResp.viewerUrl}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
          
          {errorMsg ? (
            <div className="row-center" style={{color:'#b00020', fontWeight:600, marginTop:'20px'}}>{errorMsg}</div>
          ) : null}
        </div>
      </div>
      <div className="footer">Edit stickers only in the AR page.</div>
    </div>
  );
}

function mountApp(){
  const el = document.getElementById('root');
  if (!el) return;
  const root = ReactDOM.createRoot(el);
  root.render(<App />);
}
if (document.readyState === 'complete') {
  requestAnimationFrame(() => requestAnimationFrame(mountApp));
} else {
  window.addEventListener('load', () => requestAnimationFrame(() => requestAnimationFrame(mountApp)), { once: true });
}