const { parentPort, workerData } = require('worker_threads');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const FFMPEG = workerData.ffmpegPath || 'ffmpeg';
const MIN_THUMB_BYTES = 15000;

async function generateVideoThumbnail(videoPath, outJpgPath) {
  const attemptsSec = [30, 60, 120, 240, 12, 6, 2, 0.5];
  
  for (const t of attemptsSec) {
    try {
      const ss = String(Math.max(0, t));
      await new Promise((resolve, reject) => {
        const args = [
          '-y', '-hide_banner', '-loglevel', 'error',
          '-ss', ss, '-i', videoPath,
          '-frames:v', '1', '-an',
          '-vf', 'thumbnail=240,scale=480:-1',
          '-q:v', '3', outJpgPath
        ];

        const proc = spawn(FFMPEG, args);
        let stderr = '';
        proc.stderr.on('data', (d) => { stderr += d.toString(); });
        proc.on('close', (code) => {
          if (code === 0 && fs.existsSync(outJpgPath)) {
            const st = fs.statSync(outJpgPath);
            if (st.size >= MIN_THUMB_BYTES) return resolve();
          }
          if (fs.existsSync(outJpgPath)) fs.unlinkSync(outJpgPath);
          reject(new Error(stderr || `ffmpeg exit code ${code}`));
        });
        proc.on('error', reject);
      });
      return outJpgPath;
    } catch (e) {
      // Try next timestamp
    }
  }
  throw new Error('All thumbnail attempts failed');
}

parentPort.on('message', async (job) => {
  try {
    const { videoPath, outJpgPath, id, kind } = job;
    await generateVideoThumbnail(videoPath, outJpgPath);
    parentPort.postMessage({ status: 'success', id, kind, outJpgPath });
  } catch (error) {
    parentPort.postMessage({ status: 'error', id, kind, error: error.message });
  }
});
