const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const upload = multer({ dest: '/tmp/uploads' });

app.use(express.static('public'));
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));

// Health check
app.get('/health', (req, res) => res.json({ ok: true }));

// Estrai audio
app.post('/extract-audio', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nessun file' });
  
  const format = req.body.format || 'mp3';
  const inputPath = req.file.path;
  const outputPath = inputPath + '.' + format;
  
  const codecs = {
    mp3: ['-acodec', 'libmp3lame', '-q:a', '2'],
    wav: ['-acodec', 'pcm_s16le'],
    flac: ['-acodec', 'flac'],
    ogg: ['-acodec', 'libvorbis', '-q:a', '5'],
    aac: ['-acodec', 'aac', '-b:a', '128k'],
    m4a: ['-acodec', 'aac', '-b:a', '128k'],
    opus: ['-acodec', 'libopus', '-b:a', '128k']
  };
  
  const args = ['-i', inputPath, '-vn', ...(codecs[format] || codecs.mp3), '-y', outputPath];
  
  const ffmpeg = spawn('ffmpeg', args);
  
  let stderr = '';
  ffmpeg.stderr.on('data', d => stderr += d);
  
  ffmpeg.on('close', code => {
    fs.unlinkSync(inputPath);
    if (code !== 0) return res.status(500).json({ error: stderr });
    
    res.download(outputPath, `extracted.${format}`, err => {
      fs.unlinkSync(outputPath);
    });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on ${PORT}`));