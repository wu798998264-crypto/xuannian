const fs = require('fs');
const path = require('path');

const VIDEO_EXTENSIONS = new Set([
  'mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'wmv', 'flv', 'mpeg', 'mpg', 'ts', 'm2ts',
]);
const AUDIO_EXTENSIONS = new Set([
  'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wma', 'aiff', 'ape',
]);
const MEDIA_KIND_DIRECTORIES = Object.freeze({ video: '视频', audio: '音乐' });
const SEEKIN_UNIVERSAL_PORTAL = 'https://www.seekin.ai/zh/downloader/';
const SEEKIN_ONLY_PORTALS = Object.freeze([
  Object.freeze({ url: SEEKIN_UNIVERSAL_PORTAL, label: 'Seekin' }),
]);

const VIDEO_PROVIDERS = [
  {
    id: 'douyin',
    label: '抖音',
    hosts: ['douyin.com', 'iesdouyin.com'],
    portalUrl: SEEKIN_UNIVERSAL_PORTAL,
    portals: SEEKIN_ONLY_PORTALS,
    autoDownloadQuality: 'highest',
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    hosts: ['tiktok.com'],
    portalUrl: SEEKIN_UNIVERSAL_PORTAL,
    portals: SEEKIN_ONLY_PORTALS,
  },
  {
    id: 'bilibili',
    label: '哔哩哔哩',
    hosts: ['bilibili.com', 'b23.tv'],
    portalUrl: SEEKIN_UNIVERSAL_PORTAL,
    portals: SEEKIN_ONLY_PORTALS,
  },
  {
    id: 'xiaohongshu',
    label: '小红书',
    hosts: ['xiaohongshu.com', 'xhslink.com'],
    portalUrl: SEEKIN_UNIVERSAL_PORTAL,
    portals: SEEKIN_ONLY_PORTALS,
  },
  {
    id: 'kuaishou',
    label: '快手',
    hosts: ['kuaishou.com', 'gifshow.com', 'kwai.com'],
    portalUrl: SEEKIN_UNIVERSAL_PORTAL,
    portals: SEEKIN_ONLY_PORTALS,
  },
  {
    id: 'youtube',
    label: 'YouTube',
    hosts: ['youtube.com', 'youtu.be'],
    portalUrl: SEEKIN_UNIVERSAL_PORTAL,
    portals: SEEKIN_ONLY_PORTALS,
  },
  {
    id: 'instagram',
    label: 'Instagram',
    hosts: ['instagram.com'],
    portalUrl: SEEKIN_UNIVERSAL_PORTAL,
    portals: SEEKIN_ONLY_PORTALS,
  },
  {
    id: 'twitter',
    label: 'Twitter / X',
    hosts: ['twitter.com', 'x.com'],
    portalUrl: SEEKIN_UNIVERSAL_PORTAL,
    portals: SEEKIN_ONLY_PORTALS,
  },
  {
    id: 'facebook',
    label: 'Facebook',
    hosts: ['facebook.com', 'fb.watch'],
    portalUrl: SEEKIN_UNIVERSAL_PORTAL,
    portals: SEEKIN_ONLY_PORTALS,
  },
];

const PORTAL_HOSTS = new Set([
  'seekin.ai',
  'gequbao.com',
  'bilibili.com',
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

function bilibiliEpisodeId(value) {
  const sourceUrl = extractHttpUrl(value);
  if (!sourceUrl) return '';
  try {
    const parsed = new URL(sourceUrl);
    if (!hostMatches(normalizedHost(parsed.hostname), ['bilibili.com'])) return '';
    return parsed.pathname.match(/\/bangumi\/play\/ep(\d+)/i)?.[1] || '';
  } catch {
    return '';
  }
}

const BILIBILI_QUALITY_LABELS = Object.freeze({
  127: '8K',
  126: '杜比视界',
  125: 'HDR',
  120: '4K',
  116: '1080P60',
  112: '1080P+',
  80: '1080P',
  74: '720P60',
  64: '720P',
  32: '480P',
  16: '360P',
  6: '240P',
});

function bilibiliVideoIdentity(value) {
  const sourceUrl = extractHttpUrl(value);
  if (!sourceUrl) return null;
  try {
    const parsed = new URL(sourceUrl);
    if (!hostMatches(normalizedHost(parsed.hostname), ['bilibili.com'])) return null;
    const token = parsed.pathname.match(/\/video\/(BV[0-9A-Za-z]+|av\d+)/i)?.[1] || '';
    if (!token) return null;
    return /^BV/i.test(token)
      ? { bvid: token, aid: '' }
      : { bvid: '', aid: token.replace(/^av/i, '') };
  } catch {
    return null;
  }
}

function bilibiliViewApiUrl(value) {
  const identity = bilibiliVideoIdentity(value);
  if (!identity) return '';
  return identity.bvid
    ? `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(identity.bvid)}`
    : `https://api.bilibili.com/x/web-interface/view?aid=${encodeURIComponent(identity.aid)}`;
}

function bilibiliProgressiveApiUrl(value, quality = 80, cid = '') {
  const episodeId = bilibiliEpisodeId(value);
  const qn = Math.max(6, Math.min(127, Number(quality) || 80));
  if (episodeId) {
    return `https://api.bilibili.com/pgc/player/web/playurl?ep_id=${episodeId}&qn=${qn}&fnval=0&fourk=1`;
  }
  const identity = bilibiliVideoIdentity(value);
  const pageId = String(cid || '').trim();
  if (!identity || !/^\d+$/.test(pageId)) return '';
  const identityQuery = identity.bvid
    ? `bvid=${encodeURIComponent(identity.bvid)}`
    : `avid=${encodeURIComponent(identity.aid)}`;
  return `https://api.bilibili.com/x/player/playurl?${identityQuery}&cid=${encodeURIComponent(pageId)}&qn=${qn}&fnval=0&fourk=1`;
}

function bilibiliQualityLabel(value, fallback = '') {
  const quality = Number(value || 0);
  return BILIBILI_QUALITY_LABELS[quality] || String(fallback || '').trim() || `清晰度 ${quality}`;
}

function bilibiliPlaybackAccess(payload = {}) {
  const result = payload?.result || payload?.data || {};
  const enabled = (value) => value === true || value === 1 || value === '1';
  const downloads = Array.isArray(result.durl) ? result.durl : [];
  const sourceDurationMs = Math.max(0, Number(result.timelength || 0));
  const deliveredDurationMs = downloads.reduce((total, item) => (
    total + Math.max(0, Number(item?.length || 0))
  ), 0);
  const explicitlyPreview = enabled(result.is_preview) || enabled(result.isPreview);
  const clearlyTruncated = sourceDurationMs >= 90000
    && deliveredDurationMs > 0
    && deliveredDurationMs + 5000 < sourceDurationMs * 0.5;
  return {
    previewOnly: explicitlyPreview || clearlyTruncated,
    drm: enabled(result.is_drm) || enabled(result.isDrm),
    sourceDurationMs,
    deliveredDurationMs,
  };
}

function bilibiliProgressiveOptions(payloads = []) {
  const options = new Map();
  for (const payload of Array.isArray(payloads) ? payloads : []) {
    const result = payload?.result || payload?.data;
    if (!result || Number(payload?.code || 0) !== 0) continue;
    const access = bilibiliPlaybackAccess(payload);
    if (access.previewOnly || access.drm) continue;
    const quality = Number(result.quality || 0);
    const downloads = Array.isArray(result.durl) ? result.durl : [];
    if (!quality || downloads.length !== 1 || !/^https?:\/\//i.test(String(downloads[0]?.url || ''))) continue;
    const descriptions = new Map((Array.isArray(result.accept_quality) ? result.accept_quality : []).map((item, index) => (
      [Number(item || 0), String((Array.isArray(result.accept_description) ? result.accept_description[index] : '') || '').trim()]
    )));
    const bytes = Math.max(0, Number(downloads[0]?.size || 0));
    const sizeLabel = bytes > 0
      ? ` · ${(bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`
      : '';
    const option = {
      label: `${bilibiliQualityLabel(quality, descriptions.get(quality))}${sizeLabel}`,
      href: String(downloads[0].url),
      quality,
      source: 'bilibili',
    };
    const previous = options.get(quality);
    if (!previous || bytes > Number(previous.bytes || 0)) options.set(quality, { ...option, bytes });
  }
  return [...options.values()]
    .sort((left, right) => Number(right.quality || 0) - Number(left.quality || 0))
    .map(({ bytes: _bytes, ...option }) => option);
}

function scoreMediaDownloadQualityLabel(value) {
  const label = String(value || '').trim().toLowerCase();
  if (!label || /(?:复制|copy)/i.test(label)) return -1;
  if (!/(?:无水印|no\s*watermark|原画|original|最高|best|超清|高清|ultra\s*hd|uhd|full\s*hd|fhd|\bhd\b|(?:8|4|2)\s*k|\b\d{3,4}\s*p\b)/i.test(label)) return -1;

  let score = 100;
  if (/(?:原画|original|最高|best)/i.test(label)) score = Math.max(score, 12000);
  if (/(?:8\s*k)/i.test(label)) score = Math.max(score, 8000);
  if (/(?:4\s*k)/i.test(label)) score = Math.max(score, 4000);
  if (/(?:2\s*k)/i.test(label)) score = Math.max(score, 2000);
  if (/(?:超清|ultra\s*hd|uhd)/i.test(label)) score = Math.max(score, 2160);
  if (/(?:full\s*hd|fhd)/i.test(label)) score = Math.max(score, 1080);
  if (/(?:高清|\bhd\b)/i.test(label)) score = Math.max(score, 720);

  const resolutionMatches = label.match(/\b\d{3,4}\s*p?\b/gi) || [];
  for (const match of resolutionMatches) {
    const resolution = Number.parseInt(match, 10);
    if (Number.isFinite(resolution)) score = Math.max(score, resolution);
  }

  const sizeMatch = label.match(/(\d+(?:\.\d+)?)\s*(gb|mb|kb)\b/i);
  if (sizeMatch) {
    const amount = Number.parseFloat(sizeMatch[1]);
    const unit = sizeMatch[2].toLowerCase();
    const megabytes = unit === 'gb' ? amount * 1024 : (unit === 'kb' ? amount / 1024 : amount);
    if (Number.isFinite(megabytes)) score += Math.min(0.99, megabytes / 100000);
  }
  return score;
}

function sanitizeMediaVideoTitle(value, sourceValue = '') {
  const clean = (input) => String(input || '')
    .normalize('NFKC')
    .replace(/https?:\/\/[^\s<>"']+/gi, ' ')
    .replace(/(?:复制此链接|复制链接|打开(?:抖音|Dou音|小红书|快手|哔哩哔哩|B站|TikTok|X|Twitter)[^。！？!?\n]{0,80}|直接观看视频)[。！？!?\s]*$/gi, ' ')
    .replace(/\b(?:download|original|best|video|mp4|m4v|mov|webm|mkv)\b/gi, ' ')
    .replace(/(?:下载视频|立即下载|无水印下载|原画下载|最高画质|超清|高清)/g, ' ')
    .replace(/\b\d{3,4}\s*p\b/gi, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*(?:gb|mb|kb)\b/gi, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f\uFFFD]/g, ' ')
    .replace(/[^\p{L}\p{N}\s，。！？、；：,.!?;:（）()《》【】「」『』—_-]/gu, ' ')
    .replace(/([，。！？、；：,.!?;:])\1+/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/^[\s，。！？、；：,.!?;:_-]+|[\s，。！？、；：,.!?;:_-]+$/g, '')
    .trim();
  const genericTitle = /^(?:免费的?社交媒体视频下载|视频下载|社交媒体视频|seekin|download|已解析视频)$/i;
  let title = clean(value);
  if (!title || genericTitle.test(title)) title = clean(String(sourceValue || '').replace(extractHttpUrl(sourceValue), ' '));
  if (!title || genericTitle.test(title)) {
    const provider = detectVideoProvider(sourceValue);
    let token = '';
    try {
      const url = new URL(provider?.sourceUrl || extractHttpUrl(sourceValue));
      token = url.pathname.split('/').filter(Boolean).pop() || '';
    } catch {}
    title = [provider?.label || '视频', clean(token).slice(0, 32)].filter(Boolean).join('-');
  }
  return Array.from(title || '视频').slice(0, 100).join('').trim();
}

function musicSearchUrl(keyword) {
  const query = String(keyword || '').trim();
  return query
    ? `https://www.gequbao.com/s/${encodeURIComponent(query)}`
    : 'https://www.gequbao.com/';
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

function normalizedPathKey(filePath) {
  const resolved = path.resolve(String(filePath || ''));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isPathInside(filePath, directory) {
  const relative = path.relative(path.resolve(String(directory || '')), path.resolve(String(filePath || '')));
  return !!relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function sanitizeCollectionName(value) {
  const name = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/[. ]+$/g, '')
    .slice(0, 48);
  if (!name || name === '.' || name === '..') return '';
  return name;
}

function mediaTypeDirectory(directory, kind) {
  const folder = MEDIA_KIND_DIRECTORIES[kind];
  return folder ? path.join(String(directory || ''), folder) : '';
}

function mediaCollectionDirectory(directory, kind, collection = '') {
  const typeDirectory = mediaTypeDirectory(directory, kind);
  const name = sanitizeCollectionName(collection);
  return name ? path.join(typeDirectory, name) : typeDirectory;
}

async function scanMediaFilesInDirectory(directory, favorite, location, collection, remaining) {
  if (remaining <= 0) return [];
  let entries;
  try {
    entries = await fs.promises.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const candidates = entries
    .filter((entry) => entry.isFile() && mediaKindForPath(entry.name))
    .slice(0, remaining);
  const items = await mapWithConcurrency(candidates, 24, async (entry) => {
    const filePath = path.join(directory, entry.name);
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) return null;
      return {
        path: filePath,
        directory,
        name: entry.name,
        kind: mediaKindForPath(entry.name),
        size: stat.size,
        modifiedAt: stat.mtimeMs,
        favorite: !!favorite,
        location,
        collection: collection || '',
      };
    } catch {
      return null;
    }
  });
  return items.filter(Boolean);
}

async function listCollectionNames(directory, kind) {
  const typeDirectory = mediaTypeDirectory(directory, kind);
  if (!typeDirectory) return [];
  let entries;
  try {
    entries = await fs.promises.readdir(typeDirectory, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && sanitizeCollectionName(entry.name) === entry.name)
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

async function listMediaCollections(directory) {
  const [video, audio] = await Promise.all([
    listCollectionNames(directory, 'video'),
    listCollectionNames(directory, 'audio'),
  ]);
  return { video, audio };
}

async function listManagedMediaFiles(directory, favorite = false, limit = 100000) {
  const root = String(directory || '').trim();
  if (!root || !path.isAbsolute(root)) return [];
  const requestedLimit = Number(limit);
  if (Number.isFinite(requestedLimit) && requestedLimit <= 0) return [];
  const maxItems = Math.max(1, requestedLimit || 100000);
  const location = favorite ? 'favorites' : 'downloads';
  const items = [];
  for (const kind of ['video', 'audio']) {
    if (items.length >= maxItems) break;
    const typeDirectory = mediaTypeDirectory(root, kind);
    const unclassified = await scanMediaFilesInDirectory(typeDirectory, favorite, location, '', maxItems - items.length);
    items.push(...unclassified.filter((item) => item.kind === kind));
    const collections = await listCollectionNames(root, kind);
    for (const collection of collections) {
      if (items.length >= maxItems) break;
      const collected = await scanMediaFilesInDirectory(
        mediaCollectionDirectory(root, kind, collection),
        favorite,
        location,
        collection,
        maxItems - items.length,
      );
      items.push(...collected.filter((item) => item.kind === kind));
    }
  }
  return items;
}

async function scanMediaDirectory(directory, favorite = false, limit = 2500) {
  const root = String(directory || '').trim();
  if (!root || !path.isAbsolute(root)) return [];
  const maxItems = Math.max(1, Number(limit) || 2500);
  const location = favorite ? 'favorites' : 'downloads';
  const items = await scanMediaFilesInDirectory(root, favorite, location, '', maxItems);
  const managed = await listManagedMediaFiles(root, favorite, maxItems - items.length);
  items.push(...managed);
  return items;
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

async function copyMediaToFavorites(sourcePath, favoriteDirectory, collection = '') {
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
  const kind = mediaKindForPath(source);
  const targetRoot = mediaCollectionDirectory(destinationRoot, kind, collection);
  await fs.promises.mkdir(targetRoot, { recursive: true });
  const sourceKey = normalizedPathKey(source);
  const rootKey = `${normalizedPathKey(destinationRoot)}${path.sep}`;
  if (sourceKey.startsWith(rootKey)) return { ok: true, path: source, alreadyFavorite: true };

  const sameNameTarget = path.join(targetRoot, path.basename(source));
  try {
    const existing = await fs.promises.stat(sameNameTarget);
    if (existing.isFile() && existing.size === stat.size) {
      return { ok: true, path: sameNameTarget, alreadyFavorite: true };
    }
  } catch {}

  const target = collisionFreePath(targetRoot, path.basename(source));
  await fs.promises.copyFile(source, target, fs.constants.COPYFILE_EXCL);
  await fs.promises.utimes(target, stat.atime, stat.mtime).catch(() => {});
  return { ok: true, path: target, alreadyFavorite: false };
}

async function createMediaCollection(directory, kind, name) {
  const root = String(directory || '').trim();
  const collection = sanitizeCollectionName(name);
  if (!root || !path.isAbsolute(root) || !MEDIA_KIND_DIRECTORIES[kind]) return { ok: false, reason: '收藏夹参数无效' };
  if (!collection) return { ok: false, reason: '请输入有效的收藏夹名称' };
  const target = mediaCollectionDirectory(root, kind, collection);
  if (fs.existsSync(target)) return { ok: false, reason: '同名收藏夹已存在' };
  await fs.promises.mkdir(target, { recursive: false }).catch(async (error) => {
    if (error?.code !== 'ENOENT') throw error;
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.mkdir(target, { recursive: false });
  });
  return { ok: true, name: collection, path: target };
}

async function renameMediaCollection(directory, kind, currentName, nextName) {
  const root = String(directory || '').trim();
  const current = sanitizeCollectionName(currentName);
  const next = sanitizeCollectionName(nextName);
  if (!root || !path.isAbsolute(root) || !MEDIA_KIND_DIRECTORIES[kind] || !current || !next) {
    return { ok: false, reason: '收藏夹名称无效' };
  }
  if (current === next) return { ok: true, name: current, unchanged: true };
  const source = mediaCollectionDirectory(root, kind, current);
  const target = mediaCollectionDirectory(root, kind, next);
  if (!fs.existsSync(source)) return { ok: false, reason: '收藏夹已不存在' };
  if (fs.existsSync(target)) return { ok: false, reason: '同名收藏夹已存在' };
  await fs.promises.rename(source, target);
  return { ok: true, name: next, path: target };
}

async function movePathAcrossVolumes(source, target) {
  try {
    await fs.promises.rename(source, target);
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error;
    const stat = await fs.promises.lstat(source);
    if (stat.isDirectory()) {
      await fs.promises.cp(source, target, { recursive: true, force: false, errorOnExist: true });
      await fs.promises.rm(source, { recursive: true, force: false });
    } else {
      await fs.promises.copyFile(source, target, fs.constants.COPYFILE_EXCL);
      await fs.promises.unlink(source);
    }
  }
}

async function moveMediaToCollection(sourcePath, directory, collection = '') {
  const source = String(sourcePath || '').trim();
  const root = String(directory || '').trim();
  const kind = mediaKindForPath(source);
  if (!source || !path.isAbsolute(source) || !root || !path.isAbsolute(root) || !kind || !isPathInside(source, root)) {
    return { ok: false, reason: '媒体文件或目录无效' };
  }
  const targetRoot = mediaCollectionDirectory(root, kind, collection);
  await fs.promises.mkdir(targetRoot, { recursive: true });
  if (normalizedPathKey(path.dirname(source)) === normalizedPathKey(targetRoot)) {
    return { ok: true, path: source, unchanged: true };
  }
  const target = collisionFreePath(targetRoot, path.basename(source));
  await movePathAcrossVolumes(source, target);
  return { ok: true, path: target };
}

async function deleteMediaCollection(directory, kind, name) {
  const root = String(directory || '').trim();
  const collection = sanitizeCollectionName(name);
  if (!root || !path.isAbsolute(root) || !MEDIA_KIND_DIRECTORIES[kind] || !collection) {
    return { ok: false, reason: '收藏夹参数无效' };
  }
  const source = mediaCollectionDirectory(root, kind, collection);
  if (!fs.existsSync(source)) return { ok: false, reason: '收藏夹已不存在' };
  const entries = await fs.promises.readdir(source, { withFileTypes: true });
  const targetRoot = mediaCollectionDirectory(root, kind, '');
  await fs.promises.mkdir(targetRoot, { recursive: true });
  let moved = 0;
  let preserved = 0;
  let folders = 0;
  let otherFiles = 0;
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    await movePathAcrossVolumes(sourcePath, collisionFreePath(targetRoot, entry.name));
    preserved += 1;
    if (entry.isDirectory()) folders += 1;
    else if (entry.isFile() && mediaKindForPath(entry.name) === kind) moved += 1;
    else otherFiles += 1;
  }
  await fs.promises.rmdir(source);
  return { ok: true, moved, preserved, folders, otherFiles };
}

module.exports = {
  AUDIO_EXTENSIONS,
  MEDIA_KIND_DIRECTORIES,
  VIDEO_EXTENSIONS,
  VIDEO_PROVIDERS,
  bilibiliEpisodeId,
  bilibiliPlaybackAccess,
  bilibiliProgressiveOptions,
  bilibiliProgressiveApiUrl,
  bilibiliQualityLabel,
  bilibiliVideoIdentity,
  bilibiliViewApiUrl,
  copyMediaToFavorites,
  createMediaCollection,
  deleteMediaCollection,
  detectVideoProvider,
  extractHttpUrl,
  isAllowedPortalUrl,
  isPathInside,
  listManagedMediaFiles,
  listMediaCollections,
  listMediaFiles,
  mediaKindForPath,
  mediaCollectionDirectory,
  moveMediaToCollection,
  musicSearchUrl,
  renameMediaCollection,
  sanitizeMediaVideoTitle,
  sanitizeCollectionName,
  scanMediaDirectory,
  scoreMediaDownloadQualityLabel,
};
