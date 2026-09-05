export const appRoot = new URL('./', import.meta.url);
export const rooms = [
  { id: 'corridor', path: '', old: '', title: '満足教 — 回廊', music: 'corridor' },
  { id: 'truth', path: 'truth/', old: 'truth/', title: '真理の扉 — 満足教', music: 'truth' },
  { id: 'gallery', path: 'truth/gallery/', old: 'truth/gallery/', title: '記憶の画廊 — 満足教', music: 'truth' },
  { id: 'red-house', path: 'truth/red-house/', old: 'truth/red-house/', title: '懺悔室 — 満足教', music: 'truth' },
  { id: 'archive', path: 'truth/red-house/archive/', old: 'truth/red-house/archive/', title: '保管庫 — 満足教', music: 'corridor' },
  { id: 'novel', path: 'novel/', old: 'novel/', title: '満足教 — 物語', music: 'corridor' }
];
const canonicalRoot = new URL('../manzokukyo/', appRoot);
export function resolveRoom(href, base = appRoot) {
  const url = new URL(href, base);
  if (url.origin !== appRoot.origin) return null;
  const pathname = url.pathname.replace(/index\.html$/, '').replace(/\/?$/, '/');
  const room = rooms.find(item => [new URL(item.path, appRoot).pathname, new URL(item.old, canonicalRoot).pathname].includes(pathname));
  return room ? { room, url: new URL(`${room.path}${url.search}${url.hash}`, appRoot) } : null;
}
export function roomTrack(room) {
  return room.music === 'truth'
    ? { id: 'truth', label: '真理の扉', sources: ['music/truth-chamber-bgm.flac', 'music/truth-chamber-bgm.mp3'].map(src => new URL(src, appRoot).href) }
    : { id: 'corridor', label: '満足教', sources: [new URL('assets/satisfaction-bgm.m4a', appRoot).href] };
}
