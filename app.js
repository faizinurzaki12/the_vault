import { sb } from './js/supabaseClient.js';
import { QUOTA_BYTES, PAGE_SIZE } from './js/config.js';
import { $, debounce } from './js/utils.js';
import { getSession, signIn, signOut } from './js/auth.js';
import { fetchUsageStats, fetchFilesPage, uploadFile, deleteFile } from './js/api.js';
import {
  showGate, showApp, renderUsage, clearGrid, toggleEmptyState,
  appendFileCards, watchInfiniteScroll, renderUploadRow, openPreviewModal,
} from './js/ui.js';

let session = null;

// Pagination / query state — reset to page 0 whenever category, search or sort changes.
const state = { category: 'all', search: '', sortField: 'created_at', sortDir: 'desc', offset: 0, total: 0, loading: false };

// ============================================================
// AUTH
// ============================================================
async function boot() {
  session = await getSession();
  session ? enterApp() : showGate();
}

$('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('gateError').textContent = '';
  $('unlockBtn').disabled = true;
  const { error, data } = await signIn($('email').value.trim(), $('password').value);
  $('unlockBtn').disabled = false;
  if (error) { $('gateError').textContent = 'Incorrect email or passphrase.'; return; }
  session = data.session;
  enterApp();
});

$('signOutBtn').addEventListener('click', async () => {
  await signOut();
  session = null;
  showGate();
});

async function enterApp() {
  showApp();
  await refreshUsage();
  await resetAndLoad();
}

async function refreshUsage() {
  renderUsage(await fetchUsageStats(), QUOTA_BYTES);
}

// ============================================================
// LIST: query resets (search/filter/sort) vs. pagination (scroll)
// ============================================================
async function resetAndLoad() {
  state.offset = 0;
  clearGrid();
  await loadNextPage();
}

async function loadNextPage() {
  if (state.loading || (state.total && state.offset >= state.total)) return;
  state.loading = true;
  try {
    const { rows, total } = await fetchFilesPage({ ...state, limit: PAGE_SIZE });
    state.total = total;
    state.offset += rows.length;
    toggleEmptyState(state.offset === 0);
    appendFileCards(rows, handleOpenFile);
    watchInfiniteScroll(loadNextPage); // re-arm the sentinel for the new page
  } finally {
    state.loading = false;
  }
}

$('searchInput').addEventListener('input', debounce((e) => {
  state.search = e.target.value.trim();
  resetAndLoad();
}, 300));

$('sortSelect').addEventListener('change', (e) => {
  [state.sortField, state.sortDir] = e.target.value.split('-');
  resetAndLoad();
});

$('categoryNav').addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-item');
  if (!btn) return;
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('is-active'));
  btn.classList.add('is-active');
  state.category = btn.dataset.category;
  resetAndLoad();
});

// ============================================================
// UPLOAD
// ============================================================
$('uploadOpenBtn').addEventListener('click', () => $('uploadModal').classList.remove('hidden'));
$('uploadCloseBtn').addEventListener('click', () => { $('uploadModal').classList.add('hidden'); $('uploadList').innerHTML = ''; });
$('dropzone').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', (e) => handleUploads([...e.target.files]));
['dragover', 'dragleave', 'drop'].forEach((evt) =>
  $('dropzone').addEventListener(evt, (e) => {
    e.preventDefault();
    $('dropzone').classList.toggle('is-drag', evt === 'dragover');
    if (evt === 'drop') handleUploads([...e.dataTransfer.files]);
  })
);

async function handleUploads(fileList) {
  for (const file of fileList) {
    const { bar, status } = renderUploadRow(file.name);
    try {
      bar.style.width = '40%';
      await uploadFile(file, session.user.id);
      bar.style.width = '100%';
      status.textContent = 'saved';
      status.classList.add('ok');
    } catch (err) {
      status.textContent = 'failed';
      status.classList.add('err');
      console.error(err);
    }
  }
  await refreshUsage();
  await resetAndLoad(); // newest-first sort will surface them at the top
}

// ============================================================
// PREVIEW / DOWNLOAD / DELETE
// ============================================================
function handleOpenFile(f) {
  openPreviewModal(f, {
    onDownload: (url) => url && window.open(url, '_blank'),
    onDelete: async (file) => {
      if (!confirm(`Delete "${file.file_name}" permanently?`)) return;
      await deleteFile(file);
      $('previewModal').classList.add('hidden');
      await refreshUsage();
      await resetAndLoad();
    },
  });
}

$('previewCloseBtn').addEventListener('click', () => $('previewModal').classList.add('hidden'));

boot();