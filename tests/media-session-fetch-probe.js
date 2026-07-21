const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

function downloadWithNode(url, destination) {
  return new Promise((resolve, reject) => {
    const client = /^https:/i.test(url) ? https : http;
    const request = client.get(url, { headers: { Accept: 'video/mp4,video/*;q=0.9,*/*;q=0.5', 'User-Agent': 'Mozilla/5.0 XuanNianProbe' } }, (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      const output = fs.createWriteStream(destination);
      let bytes = 0;
      response.on('data', (chunk) => { bytes += chunk.length; });
      response.once('error', reject);
      output.once('error', reject);
      output.once('finish', () => output.close(() => resolve({ bytes, contentType: response.headers['content-type'] || '' })));
      response.pipe(output);
    });
    request.setTimeout(30000, () => request.destroy(new Error('timeout')));
    request.once('error', reject);
  });
}

async function run() {
  const url = String(process.env.REAL_MEDIA_CDN_URL || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('REAL_MEDIA_CDN_URL is required');
  await app.whenReady();
  const window = new BrowserWindow({ show: false });
  const destination = path.join(app.getPath('temp'), `xuannian-media-session-${Date.now()}.mp4`);
  const variants = [
    { name: 'referer-user-agent', url, headers: { Accept: 'video/mp4,video/*;q=0.9,application/octet-stream;q=0.7,*/*;q=0.5', Referer: 'https://www.seekin.ai/zh/downloader/', 'User-Agent': window.webContents.getUserAgent() } },
    { name: 'referer', url, headers: { Accept: 'video/mp4,video/*;q=0.9,*/*;q=0.5', Referer: 'https://www.seekin.ai/zh/downloader/' } },
    { name: 'plain', url, headers: { Accept: '*/*' } },
    { name: 'https', url: url.replace(/^http:/i, 'https:'), headers: { Accept: '*/*', Referer: 'https://www.seekin.ai/zh/downloader/' } },
  ];
  let response = null;
  const failures = [];
  for (const variant of variants) {
    try {
      const candidate = await window.webContents.session.fetch(variant.url, { headers: variant.headers, redirect: 'follow' });
      if (candidate.ok && candidate.body) {
        response = candidate;
        break;
      }
      failures.push(`${variant.name}:HTTP ${candidate.status}`);
    } catch (error) {
      failures.push(`${variant.name}:${error?.message || error}`);
    }
  }
  if (!response) {
    try {
      const nodeResult = await downloadWithNode(url, destination);
      const nodeBytes = fs.existsSync(destination) ? fs.statSync(destination).size : 0;
      console.log('media session fetch metrics ' + JSON.stringify({ strategy: 'node-http', failures, nodeResult, nodeBytes }));
      try { if (fs.existsSync(destination)) fs.unlinkSync(destination); } catch {}
      window.destroy();
      app.exit(nodeBytes > 0 && nodeBytes === nodeResult.bytes ? 0 : 1);
      return;
    } catch (error) {
      failures.push(`node-http:${error?.message || error}`);
    }
    const nativeDownload = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 60000);
      const onDownload = (_event, item, sourceWebContents) => {
        if (sourceWebContents !== window.webContents) return;
        window.webContents.session.removeListener('will-download', onDownload);
        const filename = item.getFilename();
        const downloadUrl = item.getURL();
        item.setSavePath(destination);
        item.once('done', (_doneEvent, state) => {
          clearTimeout(timer);
          resolve({ filename, url: downloadUrl, state });
        });
      };
      window.webContents.session.on('will-download', onDownload);
      window.webContents.downloadURL(url);
    });
    if (!nativeDownload) throw new Error(`media fetch and native download failed: ${failures.join(', ')}`);
    const nativeBytes = fs.existsSync(destination) ? fs.statSync(destination).size : 0;
    console.log('media session fetch metrics ' + JSON.stringify({ strategy: 'header-free-downloadURL', failures, nativeDownload, nativeBytes }));
    try { if (fs.existsSync(destination)) fs.unlinkSync(destination); } catch {}
    window.destroy();
    app.exit(nativeDownload.state === 'completed' && nativeBytes > 0 ? 0 : 1);
    return;
  }
  const reader = response.body.getReader();
  const output = fs.createWriteStream(destination);
  let bytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    const buffer = Buffer.from(chunk.value);
    await new Promise((resolve, reject) => output.write(buffer, (error) => error ? reject(error) : resolve()));
    bytes += buffer.length;
  }
  await new Promise((resolve, reject) => output.end((error) => error ? reject(error) : resolve()));
  const stat = fs.statSync(destination);
  console.log('media session fetch metrics ' + JSON.stringify({ status: response.status, contentType: response.headers.get('content-type') || '', bytes, fileBytes: stat.size }));
  fs.unlinkSync(destination);
  window.destroy();
  app.exit(bytes > 0 && stat.size === bytes ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  app.exit(1);
});
