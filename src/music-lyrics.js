function isGequbaoMusicUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:'
      && url.hostname.toLowerCase().replace(/^www\./, '') === 'gequbao.com'
      && /^\/music\/\d+(?:[/?#]|$)/i.test(url.pathname);
  } catch {
    return false;
  }
}

function decodeHtmlEntities(value) {
  const named = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  return String(value || '').replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/gi, (match, entity) => {
    if (entity[0] !== '#') return named[entity.toLowerCase()] ?? match;
    const hexadecimal = entity[1]?.toLowerCase() === 'x';
    const codePoint = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return match;
    try {
      return String.fromCodePoint(codePoint);
    } catch {
      return match;
    }
  });
}

function extractGequbaoLyrics(html) {
  const source = String(html || '');
  const match = source.match(/<div\b[^>]*\bid=["']content-lrc["'][^>]*>([\s\S]*?)<\/div>/i);
  if (!match) return '';
  const lyrics = decodeHtmlEntities(match[1]
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
  return /\[\d{1,3}:\d{2}(?:\.\d{1,3})?\]/.test(lyrics) ? `${lyrics}\n` : '';
}

module.exports = {
  extractGequbaoLyrics,
  isGequbaoMusicUrl,
};
