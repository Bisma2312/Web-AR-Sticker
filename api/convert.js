// /api/convert.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');

// 1. KONFIGURASI WAJIB: Matikan Body Parser Vercel
// Ini adalah langkah KRUSIAL untuk membaca data binary (video) secara manual.
export const config = {
  api: {
    bodyParser: false, // Mematikan parser Vercel default
    responseLimit: '100mb', // Opsional: Batas respon yang lebih besar
  },
};

// Fungsi utilitas untuk membaca raw stream (permintaan) ke dalam Buffer
function buffer(readable) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        readable.on('error', reject);
        readable.on('data', (chunk) => {
            // Memastikan data yang masuk adalah Buffer
            if (typeof chunk === 'string') {
                chunks.push(Buffer.from(chunk));
            } else {
                chunks.push(chunk);
            }
        });
        readable.on('end', () => resolve(Buffer.concat(chunks)));
    });
}

// Penting: Beri tahu fluent-ffmpeg di mana menemukan binary FFmpeg
ffmpeg.setFfmpegPath(ffmpegStatic);

// Handler utama Vercel Serverless Function
module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    const tempDir = os.tmpdir();
    let inputPath, outputPath;

    try {
        // PERBAIKAN KRUSIAL: Baca raw stream secara manual dari request
        const inputBuffer = await buffer(req); 
        
        if (!inputBuffer || inputBuffer.length === 0) {
            console.error('Buffer input kosong. Data tidak diterima dari browser.');
            // Mengembalikan error 400 jika data kosong
            return res.status(400).send('Permintaan video kosong. (Data tidak terkirim)'); 
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
                    // Cek error dari FFmpeg
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
        // Log error di Vercel dan kirimkan 500
        console.error('Server Error (500):', error.message);
        res.status(500).send(`Internal Server Error: ${error.message}`);
    } finally {
        // 4. Bersihkan File Temporer
        if (inputPath && fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (outputPath && fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        console.log('File temporer telah dibersihkan.');
    }
};