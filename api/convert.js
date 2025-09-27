// Mengimpor modul yang dibutuhkan
const fs = require('fs');
const path = require('path');
const os = require('os');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');

// Penting: Beri tahu fluent-ffmpeg di mana menemukan binary FFmpeg
ffmpeg.setFfmpegPath(ffmpegStatic);

// Handler utama Vercel Serverless Function
module.exports = async (req, res) => {
    // Hanya menerima permintaan POST
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    const tempDir = os.tmpdir();
    let inputPath, outputPath;

    try {
        // Vercel/Node.js tidak menerima Blob, tetapi menerima Buffer dari body request
        const inputBuffer = req.body; 

        // 1. Tulis Buffer ke File Temporer sebagai Input (WebM/Video Blob)
        const timestamp = Date.now();
        inputPath = path.join(tempDir, `input-${timestamp}.webm`);
        outputPath = path.join(tempDir, `output-${timestamp}.mp4`);
        
        fs.writeFileSync(inputPath, inputBuffer);

        // 2. Jalankan Konversi menggunakan fluent-ffmpeg
        await new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                // Konfigurasi konversi (mirip dengan yang di ffmpeg.wasm)
                .videoCodec('libx264')
                .outputOptions([
                    '-crf 23',
                    '-preset fast',
                    '-c:a aac',
                    '-b:a 128k',
                ])
                .on('end', () => {
                    console.log('Konversi Selesai!');
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

        // Set header untuk mengirim file video
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Length', outputBuffer.length);
        res.status(200).send(outputBuffer);

    } catch (error) {
        console.error('Server Error:', error);
        res.status(500).send(`Internal Server Error: ${error.message}`);
    } finally {
        // 4. Bersihkan File Temporer (Krusial untuk Serverless)
        if (inputPath && fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (outputPath && fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    }
};