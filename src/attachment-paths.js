// Used by the main window, quick panel and pinned favorites.
function fileUrlFromPath(value = '') {
  const raw = String(value || '');
  if (/^[a-z]:[\\/]/i.test(raw)) {
    const segments = raw.slice(2).split(/[\\/]/).map(encodeURIComponent);
    return 'file:///' + raw.slice(0, 2) + segments.join('/');
  }
  if (raw.startsWith('\\\\')) {
    const [server, ...segments] = raw.slice(2).split(/[\\/]/);
    return 'file://' + server + '/' + segments.map(encodeURIComponent).join('/');
  }
  if (raw.startsWith('/')) return 'file://' + raw.split('/').map(encodeURIComponent).join('/');
  return raw;
}

function filePathFromPreview(value = '') {
  if (!/^file:\/\//i.test(value)) return '';
  try {
    const url = new URL(value);
    const pathname = decodeURIComponent(url.pathname);
    if (url.hostname) return '\\\\' + url.hostname + pathname.replace(/\//g, '\\');
    if (/^\/[a-z]:\//i.test(pathname)) return pathname.slice(1).replace(/\//g, '\\');
    return pathname;
  } catch {
    return '';
  }
}

function attachmentImageSrc(item) {
  return fileUrlFromPath(item?.dataUrl || item?.preview || item?.path || item?.filePath);
}
