// /api/convert.js (Final Version using Multer)

const fs = require('fs');
const path = require('path');
const os = require('os');
const util = require('util');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const multer = require('multer'); // BARU: Middleware untuk menangani FormData

// Fungsi utilitas untuk promisify (mengubah callback menjadi Promise)
const upload = util.promisify(multer().single('video')); // 'video' HARUS SAMA dengan nama yang digunakan di formData.append('video', ...)

// 1. KONFIGURASI KRUSIAL: Mematikan Body Parser dan MENAMBAH BATASAN VERCEL
export const config = {
  // Peningkatan batas memori (dari default 128mb ke 1024mb)
  memory: 1024, 
  // Peningkatan batas durasi eksekusi (dari default 10s ke 60s)
  maxDuration: 60, 
  api: {
    bodyParser: false, // Wajib jika menggunakan Multer
    responseLimit: '100mb', 
  },
};

// Penting: Beri tahu fluent-ffmpeg di mana menemukan binary FFmpeg
ffmpeg.setFfmpegPath(ffmpegStatic);

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    const tempDir = os.tmpdir();
    let inputPath, outputPath;

    try {
        // PERBAIKAN KRUSIAL: Gunakan multer untuk memproses FormData
        await upload(req, res);

        const inputBuffer = req.file ? req.file.buffer : null;
        
        if (!inputBuffer || inputBuffer.length === 0) {
            console.error('Buffer input kosong setelah Multer diproses.');
            // Ini biasanya terjadi jika file tidak dinamai 'video' di frontend
            return res.status(400).send('Permintaan video kosong. Pastikan FormData dinamai "video".'); 
        }
        
        // 1. Tulis Buffer ke File Temporer sebagai Input
        const timestamp = Date.now();
        inputPath = path.join(tempDir, `input-${timestamp}.webm`);
        outputPath = path.join(tempDir, `output-${timestamp}.mp4`);
        
        fs.writeFileSync(inputPath, inputBuffer);
        console.log(`File input sementara dibuat: ${inputPath}`);

        // 2. Jalankan Konversi menggunakan fluent-ffmpeg
        await new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .videoCodec('libx264')
                .outputOptions([
                    '-preset ultrafast', 
                    '-crf 28', 
                    '-c:a aac',
                    '-b:a 128k',
                    '-movflags +faststart'
                ])
                .on('end', () => {
                    console.log('Konversi FFmpeg Selesai!');
                    resolve();
                })
                .on('error', (err) => {
                    console.error('FFmpeg Error:', err.message);
                    reject(new Error(`Konversi gagal: ${err.message}`));
                })
                .save(outputPath);
        });

        // 3. Baca File Output dan Kirim Kembali ke Browser
        const outputBuffer = fs.readFileSync(outputPath);

        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Length', outputBuffer.length);
        res.status(200).send(outputBuffer);

    } catch (error) {
        // Cek error dari Multer atau FFmpeg
        console.error('Server Error (500) Multer/FFmpeg:', error.message);
        res.status(500).send(`Internal Server Error: ${error.message}`);
    } finally {
        // 4. Bersihkan File Temporer
        if (inputPath && fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (outputPath && fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        console.log('File temporer telah dibersihkan.');
    }
};