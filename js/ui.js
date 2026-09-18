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

export function renderFolderNav(folders, activeId) {
  const rootBtn = `<button class="nav-item ${!activeId ? 'is-active' : ''}" data-folder="">📂 Root</button>`;
  const rest = folders.map((f) => `<button class="nav-item ${activeId === f.id ? 'is-active' : ''}" data-folder="${f.id}">📁 ${f.name}</button>`).join('');
  $('folderNav').innerHTML = rootBtn + rest;
}

// Explorer-style tiles at the top of the grid: folders (or a "back" tile
// when inside one) plus a dashed "New folder" tile, all sitting above
// the file cards for the currently selected folder.
export function renderFolderTiles({ folders, showBack, onOpenFolder, onBack, onNewFolder, onFolderMenu }) {
  const frag = document.createDocumentFragment();

  if (showBack) {
    const back = document.createElement('div');
    back.className = 'card card--folder';
    back.innerHTML = `<div class="card-thumb">⤴️</div><div class="card-body"><div class="card-name">.. Back to Root</div></div>`;
    back.addEventListener('click', onBack);
    frag.appendChild(back);
  } else {
    const newFolder = document.createElement('div');
    newFolder.className = 'card card--folder card--new-folder';
    newFolder.innerHTML = `<div class="card-thumb">📁 ＋</div><div class="card-body"><div class="card-name">New folder</div></div>`;
    newFolder.addEventListener('click', onNewFolder);
    frag.appendChild(newFolder);

    for (const f of folders) {
      const card = document.createElement('div');
      card.className = 'card card--folder';
      card.innerHTML = `
        <div class="card-thumb">📁</div>
        <div class="card-body"><div class="card-name" title="${f.name}">${f.name}</div></div>
        <button type="button" class="card-menu-btn" aria-label="Folder options">⋮</button>`;
      attachFolderTileInteractions(card, f, onOpenFolder, onFolderMenu);
      frag.appendChild(card);
    }
  }
  $('grid').appendChild(frag);
}

// Tap/click opens the folder. A long-press (touch) or right-click (mouse),
// or tapping the ⋮ button, opens the rename/delete menu instead — and
// suppresses the click that would otherwise follow a long-press.
function attachFolderTileInteractions(card, folder, onOpenFolder, onFolderMenu) {
  const LONG_PRESS_MS = 550;
  let pressTimer = null;
  let longPressed = false;

  const startPress = (x, y) => {
    longPressed = false;
    pressTimer = setTimeout(() => { longPressed = true; onFolderMenu(folder, x, y); }, LONG_PRESS_MS);
  };
  const cancelPress = () => clearTimeout(pressTimer);

  card.addEventListener('pointerdown', (e) => { if (e.button > 0) return; startPress(e.clientX, e.clientY); });
  card.addEventListener('pointerup', cancelPress);
  card.addEventListener('pointerleave', cancelPress);
  card.addEventListener('pointercancel', cancelPress);
  card.addEventListener('contextmenu', (e) => { e.preventDefault(); onFolderMenu(folder, e.clientX, e.clientY); });
  card.addEventListener('click', (e) => {
    if (longPressed) { longPressed = false; e.stopPropagation(); return; } // don't let this bubble and instantly close the menu we just opened
    onOpenFolder(folder);
  });

  card.querySelector('.card-menu-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    onFolderMenu(folder, rect.left, rect.bottom + 4);
  });
}

export function showFolderMenu(x, y) {
  const menu = $('folderMenu');
  menu.classList.remove('hidden');
  const rect = menu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 8);
  const top = Math.min(y, window.innerHeight - rect.height - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
}

export function hideFolderMenu() {
  $('folderMenu').classList.add('hidden');
}

export function openFolderModal(mode, name = '') {
  $('folderModalTitle').textContent = mode === 'rename' ? 'Rename folder' : 'New folder';
  $('folderSubmitBtn').textContent = mode === 'rename' ? 'Save' : 'Create';
  $('folderNameInput').value = name;
  $('folderModal').classList.remove('hidden');
  $('folderNameInput').focus();
}

export function updateFolderHint(name) {
  $('folderHint').innerHTML = `Adding files to <strong>${name}</strong>.`;
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