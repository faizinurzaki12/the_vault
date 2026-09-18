import { $, formatBytes, iconFor } from './utils.js';
import { getSignedUrl } from './api.js';

export function showGate() {
  $('gate').classList.remove('hidden');
  $('app').classList.add('hidden');
}

export function showApp() {
  $('gate').classList.add('hidden');
  $('app').classList.remove('hidden');
}

export function renderUsage({ total_bytes = 0, total_count = 0 }, quotaBytes) {
  const pct = Math.min(1, total_bytes / quotaBytes);
  const circumference = 264; // 2 * PI * r(42)
  $('usageFill').style.strokeDashoffset = String(circumference * (1 - pct));
  $('usageBytes').textContent = formatBytes(total_bytes);
  $('usageCount').textContent = `${total_count} item${total_count === 1 ? '' : 's'}`;
}

// Cards only fetch their thumbnail's signed URL once they actually scroll
// into view, so opening a big vault doesn't fire one Storage request per row.
const thumbObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const img = entry.target;
    thumbObserver.unobserve(img);
    getSignedUrl(img.dataset.lazy).then((url) => { if (url) img.src = url; });
  }
}, { rootMargin: '200px' });

export function clearGrid() {
  $('grid').innerHTML = '';
}

export function toggleEmptyState(show) {
  $('emptyState').classList.toggle('hidden', !show);
}

export function appendFileCards(rows, onOpen) {
  const frag = document.createDocumentFragment();
  for (const f of rows) {
    const card = document.createElement('div');
    card.className = 'card';
    const thumbInner = f.category === 'image'
      ? `<img data-lazy="${f.storage_path}" alt="">`
      : iconFor(f.category);
    card.innerHTML = `
      <div class="card-thumb">${thumbInner}</div>
      <div class="card-body">
        <div class="card-name" title="${f.file_name}">${f.file_name}</div>
        <div class="card-meta"><span>${formatBytes(f.file_size)}</span><span>${new Date(f.created_at).toLocaleDateString()}</span></div>
      </div>`;
    card.addEventListener('click', () => onOpen(f));
    const img = card.querySelector('img[data-lazy]');
    if (img) thumbObserver.observe(img);
    frag.appendChild(card);
  }
  $('grid').appendChild(frag);
}

// Sentinel-based infinite scroll: fires `onReachEnd` once the bottom marker
// becomes visible, instead of listening to scroll events on every frame.
let scrollObserver = null;
export function watchInfiniteScroll(onReachEnd) {
  if (scrollObserver) scrollObserver.disconnect();
  scrollObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) onReachEnd();
  }, { rootMargin: '400px' });
  scrollObserver.observe($('scrollSentinel'));
}

export function renderUploadRow(name) {
  const row = document.createElement('li');
  row.className = 'upload-row';
  row.innerHTML = `<span class="upload-row-name">${name}</span>
                    <div class="bar"><div class="bar-fill"></div></div>
                    <span class="upload-row-status">uploading…</span>`;
  $('uploadList').prepend(row);
  return { bar: row.querySelector('.bar-fill'), status: row.querySelector('.upload-row-status') };
}

export async function openPreviewModal(f, { onDelete, onDownload }) {
  $('previewName').textContent = f.file_name;
  $('previewMeta').innerHTML = `
    <dt>Type</dt><dd>${f.mime_type}</dd>
    <dt>Size</dt><dd>${formatBytes(f.file_size)}${f.is_compressed ? ` (was ${formatBytes(f.original_size)})` : ''}</dd>
    <dt>Added</dt><dd>${new Date(f.created_at).toLocaleString()}</dd>`;

  const visual = $('previewVisual');
  visual.textContent = 'Loading…';
  $('previewModal').classList.remove('hidden');

  const url = await getSignedUrl(f.storage_path);
  $('downloadBtn').onclick = () => onDownload(url);
  $('deleteBtn').onclick = () => onDelete(f);

  if (!url) { visual.textContent = iconFor(f.category); return; }
  if (f.category === 'image') {
    visual.innerHTML = `<img src="${url}" alt="${f.file_name}">`;
  } else if (f.mime_type === 'application/pdf') {
    visual.innerHTML = `<iframe src="${url}" style="width:100%;height:320px;border:0;"></iframe>`;
  } else if (f.category === 'archive') {
    await renderZipContents(url, visual);
  } else if (isTextMimeLocal(f.mime_type)) {
    await renderTextContents(url, visual);
  } else {
    visual.textContent = iconFor(f.category);
  }
}

function isTextMimeLocal(mime) {
  return mime.startsWith('text/') || ['application/json', 'application/xml'].includes(mime);
}

async function renderZipContents(url, visual) {
  try {
    const buf = await (await fetch(url)).arrayBuffer();
    const zip = await window.JSZip.loadAsync(buf);
    const entries = Object.values(zip.files).filter((e) => !e.dir);
    if (!entries.length) { visual.innerHTML = '<span class="zip-empty">Empty archive.</span>'; return; }
    visual.innerHTML = `<ul class="zip-list">${entries.map((e) => `
      <li class="zip-row"><span>${e.name}</span><span>${formatBytes(e._data?.uncompressedSize ?? 0)}</span></li>`).join('')}</ul>`;
  } catch (err) {
    console.error(err);
    visual.textContent = 'Could not read this archive.';
  }
}

async function renderTextContents(url, visual) {
  try {
    const text = await (await fetch(url)).text();
    const shown = text.length > 20000 ? text.slice(0, 20000) + '\n…(truncated)' : text;
    visual.innerHTML = `<pre class="text-preview"></pre>`;
    visual.querySelector('pre').textContent = shown;
  } catch (err) {
    console.error(err);
    visual.textContent = 'Could not read this file.';
  }
}