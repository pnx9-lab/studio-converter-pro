const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    // Parse multipart form data
    const boundary = event.headers['content-type'].split('boundary=')[1];
    const body = Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'binary');
    
    // Simple multipart parse
    const parts = body.toString('binary').split('--' + boundary);
    let videoBuffer = null;
    let format = 'mp3';
    
    for (const part of parts) {
      if (part.includes('name="video"')) {
        const headerEnd = part.indexOf('\r\n\r\n');
        videoBuffer = Buffer.from(part.slice(headerEnd + 4, -2), 'binary');
      }
      if (part.includes('name="format"')) {
        const headerEnd = part.indexOf('\r\n\r\n');
        format = part.slice(headerEnd + 4, -2).trim();
      }
    }
    
    if (!videoBuffer) {
      return { statusCode: 400, body: 'No video file' };
    }

    // Write temp files
    const tmpDir = os.tmpdir();
    const inputPath = path.join(tmpDir, `input_${Date.now()}`);
    const outputPath = path.join(tmpDir, `output_${Date.now()}.${format}`);
    
    fs.writeFileSync(inputPath, videoBuffer);

    const codecs = {
      mp3: ['-acodec', 'libmp3lame', '-q:a', '2'],
      wav: ['-acodec', 'pcm_s16le'],
      flac: ['-acodec', 'flac'],
      ogg: ['-acodec', 'libvorbis', '-q:a', '5'],
      aac: ['-acodec', 'aac', '-b:a', '128k'],
      m4a: ['-acodec', 'aac', '-b:a', '128k'],
      opus: ['-acodec', 'libopus', '-b:a', '128k']
    };

    return new Promise((resolve) => {
      const ffmpeg = require('fluent-ffmpeg');
      ffmpeg.setFfmpegPath(require('ffmpeg-static').path);
      
      ffmpeg(inputPath)
        .noVideo()
        .audioCodec(codecs[format] || codecs.mp3)
        .save(outputPath)
        .on('end', () => {
          const audioBuffer = fs.readFileSync(outputPath);
          fs.unlinkSync(inputPath);
          fs.unlinkSync(outputPath);
          
          resolve({
            statusCode: 200,
            headers: {
              'Content-Type': `audio/${format}`,
              'Content-Disposition': `attachment; filename="extracted.${format}"`
            },
            isBase64Encoded: true,
            body: audioBuffer.toString('base64')
          });
        })
        .on('error', (err) => {
          fs.unlinkSync(inputPath);
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
          resolve({ statusCode: 500, body: 'FFmpeg error: ' + err.message });
        });
    });
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }
};