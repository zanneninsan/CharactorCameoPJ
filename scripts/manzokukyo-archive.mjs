import path from 'node:path';

// Standalone pages retain their original asset/link base while living under old/.
export function archiveManzokukyoPage(html, route = '') {
  const original = `zannenin/manzokukyo/${route}`;
  const archived = `zannenin/manzokukyo/old/${route}`;
  const base = path.posix.relative(archived, original) + '/';
  const self = path.posix.relative(original, archived) + '/';
  return html
    .replace(/<head\b[^>]*>/i, match => `${match}\n  <base href="${base}">`)
    .replace(/(<meta\b[^>]*\bname="robots"[^>]*\bcontent=")[^"]*/i, '$1noindex,follow')
    .replace(/href="#/g, `href="${self}#`);
}
