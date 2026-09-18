export const $ = (id) => document.getElementById(id);

export function categorize(mime) {
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/zip' || mime === 'application/x-zip-compressed') return 'archive';
  if (mime === 'application/pdf' || mime.startsWith('text/') || mime.includes('word') || mime.includes('sheet')) return 'document';
  return 'other';
}

export function isTextMime(mime) {
  return mime.startsWith('text/') || ['application/json', 'application/xml'].includes(mime);
}

export function iconFor(category) {
  return { image: '🖼️', document: '📄', archive: '🗜️', other: '📁' }[category];
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
  return `${n.toFixed(1)} ${units[i]}`;
}

// Delays a function until `wait` ms of silence — used on the search box so
// we don't fire a query on every keystroke.
export function debounce(fn, wait = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}