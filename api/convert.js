const fs = require('fs');
const path = require('path');
const os = require('os');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const { createClient } = require('@supabase/supabase-js'); 

// ----------------------------------------------------------------------
// 1. INISIALISASI SUPABASE & KONFIGURASI
// ----------------------------------------------------------------------

// Inisialisasi Supabase client (menggunakan SERVICE ROLE KEY)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; 
const BUCKET_NAME = process.env.SUPABASE_BUCKET_NAME || 'videos'; 

if (!supabaseUrl || !supabaseKey) {
    throw new Error("SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY tidak terdefinisi.");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false }, 
});

// Konfigurasi Vercel (Penting untuk CommonJS di Vercel)
module.exports.config = {
  memory: 3008, 
  maxDuration: 180, 
};

ffmpeg.setFfmpegPath(ffmpegStatic);

// Fungsi utilitas untuk membersihkan file di bucket Supabase
const cleanupSupabase = async (filePaths) => {
    if (filePaths && filePaths.length > 0) {
        const { error } = await supabase.storage.from(BUCKET_NAME).remove(filePaths);
        if (error) console.error("Gagal membersihkan Supabase:", error);
        else console.log("File temporer Supabase telah dibersihkan.");
    }
};

// ----------------------------------------------------------------------
// 2. HANDLER UTAMA
// ----------------------------------------------------------------------

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    const tempDir = os.tmpdir();
    let inputPath, outputPath;
    let filesToCleanup = []; 

    try {
        const { inputUrl, inputFileName } = req.body; 
        
        if (!inputUrl || !inputFileName) {
            return res.status(400).json({ message: 'Input URL dan nama file tidak ditemukan.' });
        }
        
        const outputFileName = `output/${path.parse(inputFileName).name}_converted.mp4`;
        filesToCleanup.push(inputFileName); 

        inputPath = path.join(tempDir, `input_${path.basename(inputFileName)}`);
        outputPath = path.join(tempDir, `output_${path.basename(outputFileName)}`);
        
        
        // 1. UNDUH File Video dari Supabase
        const { data: downloadData, error: downloadError } = await supabase.storage
            .from(BUCKET_NAME)
            .download(inputFileName); 

        if (downloadError) {
             throw new Error(`Supabase Download Gagal: ${downloadError.message} (File: ${inputFileName})`);
        }
        
        // Konversi ArrayBuffer ke Buffer
        const arrayBuffer = await downloadData.arrayBuffer();
        const videoBuffer = Buffer.from(arrayBuffer); 
        fs.writeFileSync(inputPath, videoBuffer); 

        console.log(`File input sementara di Vercel dibuat: ${inputPath}`);

        // 2. Jalankan Konversi FFmpeg
        await new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                // KODE KEMENANGAN (Memperbaiki Invalid Data Found)
                .inputOptions([
                    '-probesize 50M', 
                    '-analyzeduration 50M',
                    '-fflags +genpts', 
                    '-strict -2'       
                ])
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
                    // Ini adalah pesan error yang muncul di log Anda jika gagal:
                    reject(new Error(`Konversi gagal: ${err.message}`));
                })
                .save(outputPath);
        });

        // 3. UPLOAD File MP4
        const outputBuffer = fs.readFileSync(outputPath);

        const { error: uploadOutputError } = await supabase.storage
            .from(BUCKET_NAME)
            .upload(outputFileName, outputBuffer, {
                cacheControl: '3600',
                upsert: true,
                contentType: 'video/mp4',
            });
            
        if (uploadOutputError) throw new Error(`Supabase Upload Output Gagal: ${uploadOutputError.message}`);

        // 4. Dapatkan Public URL
        const { data: publicUrlData } = supabase.storage
            .from(BUCKET_NAME)
            .getPublicUrl(outputFileName);

        const outputUrl = publicUrlData.publicUrl;

        // 5. Kirim URL hasil konversi kembali ke frontend
        res.status(200).json({ outputUrl });

    } catch (error) {
        console.error('Server Error (500) Supabase Flow:', error.message);
        res.status(500).json({ message: `Internal Server Error: ${error.message}` });
    } finally {
        // 6. Bersihkan File Temporer Lokal dan Supabase
        if (inputPath && fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (outputPath && fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        console.log('File temporer Vercel telah dibersihkan.');
        
        await cleanupSupabase(filesToCleanup); 
    }
};