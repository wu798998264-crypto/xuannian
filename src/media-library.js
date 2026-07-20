const fs = require('fs');
const path = require('path');

const VIDEO_EXTENSIONS = new Set([
  'mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'wmv', 'flv', 'mpeg', 'mpg', 'ts', 'm2ts',
]);
const AUDIO_EXTENSIONS = new Set([
  'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wma', 'aiff', 'ape',
]);

const VIDEO_PROVIDERS = [
  {
    id: 'douyin-tiktok',
    label: '抖音 / TikTok',
    hosts: ['douyin.com', 'iesdouyin.com', 'tiktok.com'],
    portalUrl: 'https://dlpanda.com/zh-CN',
  },
  {
    id: 'bilibili',
    label: '哔哩哔哩',
    hosts: ['bilibili.com', 'b23.tv'],
    portalUrl: 'https://www.seekin.ai/zh/bilibili-downloader/',
  },
  {
    id: 'xiaohongshu',
    label: '小红书',
    hosts: ['xiaohongshu.com', 'xhslink.com'],
    portalUrl: 'https://www.xiaohongshua.com/',
    fallbackUrl: 'https://www.hellotik.app/zh/rednote',
  },
  {
    id: 'kuaishou',
    label: '快手',
    hosts: ['kuaishou.com', 'gifshow.com', 'kwai.com'],
    portalUrl: 'https://www.hellotik.app/zh/kuaishou',
  },
];

const PORTAL_HOSTS = new Set([
  'dlpanda.com',
  'seekin.ai',
  'xiaohongshua.com',
  'hellotik.app',
  'gequbao.com',
]);

function mediaKindForPath(filePath) {
  const extension = path.extname(String(filePath || '')).slice(1).toLowerCase();
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  return '';
}

function extractHttpUrl(value) {
  const match = String(value || '').trim().match(/https?:\/\/[^\s<>"']+/i);
  if (!match) return '';
  return match[0].replace(/[，。！？、；：）】}>]+$/u, '');
}

function normalizedHost(value) {
  return String(value || '').toLowerCase().replace(/^www\./, '');
}

function hostMatches(host, domains) {
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function detectVideoProvider(value) {
  const sourceUrl = extractHttpUrl(value);
  if (!sourceUrl) return null;
  try {
    const host = normalizedHost(new URL(sourceUrl).hostname);
    const provider = VIDEO_PROVIDERS.find((item) => hostMatches(host, item.hosts));
    return provider ? { ...provider, sourceUrl } : null;
  } catch {
    return null;
  }
}

function musicSearchUrl(keyword) {
  const value = String(keyword || '').trim();
  if (!value) return 'https://www.gequbao.com/';
  return `https://www.gequbao.com/search-fallback?keyword=${encodeURIComponent(value)}`;
}

function isAllowedPortalUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:') return false;
    const host = normalizedHost(url.hostname);
    return [...PORTAL_HOSTS].some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

async function mapWithConcurrency(items, limit, worker) {
  const result = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      result[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return result;
}

async function scanMediaDirectory(directory, favorite = false, limit = 2500) {
  const root = String(directory || '').trim();
  if (!root || !path.isAbsolute(root)) return [];
  let entries;
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const candidates = entries
    .filter((entry) => entry.isFile() && mediaKindForPath(entry.name))
    .slice(0, Math.max(1, Number(limit) || 2500));
  const items = await mapWithConcurrency(candidates, 24, async (entry) => {
    const filePath = path.join(root, entry.name);
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) return null;
      return {
        path: filePath,
        directory: root,
        name: entry.name,
        kind: mediaKindForPath(entry.name),
        size: stat.size,
        modifiedAt: stat.mtimeMs,
        favorite: !!favorite,
        location: favorite ? 'favorites' : 'downloads',
      };
    } catch {
      return null;
    }
  });
  return items.filter(Boolean);
}

function normalizedPathKey(filePath) {
  const resolved = path.resolve(String(filePath || ''));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

async function listMediaFiles(downloadDirectory, favoriteDirectory) {
  const [downloads, favorites] = await Promise.all([
    scanMediaDirectory(downloadDirectory, false),
    scanMediaDirectory(favoriteDirectory, true),
  ]);
  const favoriteKeys = new Set(favorites.map((item) => normalizedPathKey(item.path)));
  const favoriteSignatures = new Set(favorites.map((item) => `${String(item.name || '').toLowerCase()}\n${Number(item.size || 0)}`));
  const seen = new Set();
  const items = [];
  for (const item of [...favorites, ...downloads]) {
    const key = normalizedPathKey(item.path);
    if (seen.has(key)) continue;
    seen.add(key);
    const signature = `${String(item.name || '').toLowerCase()}\n${Number(item.size || 0)}`;
    items.push({ ...item, favorite: item.favorite || favoriteKeys.has(key) || favoriteSignatures.has(signature) });
  }
  return items.sort((left, right) => Number(right.modifiedAt || 0) - Number(left.modifiedAt || 0));
}

function collisionFreePath(directory, filename) {
  const extension = path.extname(filename);
  const stem = path.basename(filename, extension);
  let candidate = path.join(directory, filename);
  let suffix = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(directory, `${stem} (${suffix})${extension}`);
    suffix += 1;
  }
  return candidate;
}

async function copyMediaToFavorites(sourcePath, favoriteDirectory) {
  const source = String(sourcePath || '').trim();
  const destinationRoot = String(favoriteDirectory || '').trim();
  if (!source || !path.isAbsolute(source) || !mediaKindForPath(source)) {
    return { ok: false, reason: '文件格式不受支持' };
  }
  if (!destinationRoot || !path.isAbsolute(destinationRoot)) {
    return { ok: false, reason: '收藏目录无效' };
  }
  let stat;
  try {
    stat = await fs.promises.stat(source);
  } catch {
    return { ok: false, reason: '文件已被移动或删除' };
  }
  if (!stat.isFile()) return { ok: false, reason: '只能收藏媒体文件' };
  await fs.promises.mkdir(destinationRoot, { recursive: true });
  const sourceKey = normalizedPathKey(source);
  const rootKey = `${normalizedPathKey(destinationRoot)}${path.sep}`;
  if (sourceKey.startsWith(rootKey)) return { ok: true, path: source, alreadyFavorite: true };

  const sameNameTarget = path.join(destinationRoot, path.basename(source));
  try {
    const existing = await fs.promises.stat(sameNameTarget);
    if (existing.isFile() && existing.size === stat.size) {
      return { ok: true, path: sameNameTarget, alreadyFavorite: true };
    }
  } catch {}

  const target = collisionFreePath(destinationRoot, path.basename(source));
  await fs.promises.copyFile(source, target, fs.constants.COPYFILE_EXCL);
  await fs.promises.utimes(target, stat.atime, stat.mtime).catch(() => {});
  return { ok: true, path: target, alreadyFavorite: false };
}

module.exports = {
  AUDIO_EXTENSIONS,
  VIDEO_EXTENSIONS,
  VIDEO_PROVIDERS,
  copyMediaToFavorites,
  detectVideoProvider,
  extractHttpUrl,
  isAllowedPortalUrl,
  listMediaFiles,
  mediaKindForPath,
  musicSearchUrl,
  scanMediaDirectory,
};
