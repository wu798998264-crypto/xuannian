const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { BrowserWindow, nativeImage } = require('electron');

async function videoFrameThumbnail(sourcePath, edge) {
  const window = new BrowserWindow({
    show: false,
    width: edge,
    height: edge,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: false,
    },
  });
  try {
    await window.loadURL('data:text/html;charset=utf-8,<html><body style="margin:0;background:black"></body></html>');
    const dataUrl = await window.webContents.executeJavaScript(`(async () => {
      const video = document.createElement('video');
      video.muted = true;
      video.preload = 'auto';
      video.playsInline = true;
      document.body.appendChild(video);
      const ready = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('video-frame-timeout')), 20000);
        video.addEventListener('loadeddata', () => { clearTimeout(timer); resolve(); }, { once: true });
        video.addEventListener('error', () => { clearTimeout(timer); reject(new Error('video-frame-load-failed')); }, { once: true });
      });
      video.src = ${JSON.stringify(pathToFileURL(sourcePath).href)};
      video.load();
      await ready;
      if (Number.isFinite(video.duration) && video.duration > 0.25) {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 3000);
          video.addEventListener('seeked', () => { clearTimeout(timer); resolve(); }, { once: true });
          video.currentTime = Math.min(1, video.duration * 0.1);
        });
      }
      const width = Math.max(1, Number(video.videoWidth || 0));
      const height = Math.max(1, Number(video.videoHeight || 0));
      if (width <= 1 || height <= 1) throw new Error('video-frame-empty');
      const scale = Math.min(1, ${edge} / Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png');
    })()`, true);
    return nativeImage.createFromDataURL(dataUrl);
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

async function writeVideoCover(sourcePath, destinationPath, size = 1280) {
  const source = String(sourcePath || '').trim();
  const destination = String(destinationPath || '').trim();
  if (!source || !destination || !path.isAbsolute(source) || !path.isAbsolute(destination)) {
    throw new Error('invalid video cover path');
  }
  const edge = Math.max(128, Math.min(4096, Math.floor(Number(size) || 1280)));
  let thumbnail;
  try {
    thumbnail = await nativeImage.createThumbnailFromPath(source, { width: edge, height: edge });
  } catch {}
  if (!thumbnail || thumbnail.isEmpty()) thumbnail = await videoFrameThumbnail(source, edge);
  if (!thumbnail || thumbnail.isEmpty()) throw new Error('video thumbnail unavailable');
  const buffer = thumbnail.toPNG();
  await fs.promises.writeFile(destination, buffer, { flag: 'wx' });
  return { path: destination, bytes: buffer.length, size: thumbnail.getSize() };
}

module.exports = { writeVideoCover };
