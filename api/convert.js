// /api/convert.js

// Mengimpor modul Node.js yang dibutuhkan
const fs = require('fs');
const path = require('path');
const os = require('os');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');

// Penting: Beri tahu fluent-ffmpeg di mana menemukan binary FFmpeg
// ffmpeg-static sudah disertakan di node_modules Vercel.
ffmpeg.setFfmpegPath(ffmpegStatic);

// Handler utama Vercel Serverless Function
module.exports = async (req, res) => {
    // Hanya menerima permintaan POST dari frontend
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    // Tentukan direktori temporer (os.tmpdir() adalah standar di Vercel)
    const tempDir = os.tmpdir();
    let inputPath, outputPath;

    try {
        // Vercel menerima Buffer dari body request, yang dikirim oleh videoBlob
        const inputBuffer = req.body; 
        
        // 1. Tulis Buffer ke File Temporer sebagai Input (WebM/Video Blob)
        const timestamp = Date.now();
        // Asumsi format input adalah webm, tetapi Anda bisa menyesuaikannya
        inputPath = path.join(tempDir, `input-${timestamp}.webm`);
        outputPath = path.join(tempDir, `output-${timestamp}.mp4`);
        
        fs.writeFileSync(inputPath, inputBuffer);
        console.log(`File input sementara dibuat: ${inputPath}`);

        // 2. Jalankan Konversi menggunakan fluent-ffmpeg
        await new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                // Konfigurasi konversi yang dioptimalkan untuk kecepatan di Serverless
                .videoCodec('libx264')
                .outputOptions([
                    // PENTING: Gunakan preset PALING CEPAT untuk menghindari timeout Vercel
                    '-preset ultrafast', 
                    // Mengurangi kualitas sedikit (nilai lebih tinggi = lebih cepat/kecil)
                    '-crf 28', 
                    '-c:a aac',
                    '-b:a 128k',
                    '-movflags +faststart' // Memastikan video siap dimainkan saat streaming
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

        // Set header untuk mengirim file video MP4
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Length', outputBuffer.length);
        res.status(200).send(outputBuffer);

    } catch (error) {
        console.error('Server Error (500):', error.message);
        // Kirim pesan error kembali ke frontend
        res.status(500).send(`Internal Server Error: ${error.message}`);
    } finally {
        // 4. Bersihkan File Temporer (KRUSIAL di Serverless untuk membebaskan ruang)
        if (inputPath && fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (outputPath && fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        console.log('File temporer telah dibersihkan.');
    }
};