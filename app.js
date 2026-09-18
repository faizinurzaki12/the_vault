import { sb } from "./js/supabaseClient.js";
import { QUOTA_BYTES, PAGE_SIZE } from "./js/config.js";
import { $, debounce } from "./js/utils.js";
import { getSession, signIn, signOut } from "./js/auth.js";
import { fetchUsageStats, fetchFilesPage, fetchFolders, createFolder, renameFolder, deleteFolderWithContents, uploadFile, deleteFile } from "./js/api.js";
import {
  showGate,
  showApp,
  renderUsage,
  clearGrid,
  toggleEmptyState,
  appendFileCards,
  watchInfiniteScroll,
  renderUploadRow,
  openPreviewModal,
  renderFolderNav,
  renderFolderTiles,
  updateFolderHint,
  showFolderMenu,
  hideFolderMenu,
  openFolderModal,
} from "./js/ui.js";

let session = null;
let folders = []; // this user's folders, refreshed after login and after creating one
let menuFolder = null; // folder currently targeted by the ⋮ / long-press / right-click menu
let renamingFolder = null; // set while folderForm is being used to rename rather than create

// Pagination / query state — reset to page 0 whenever category, search, sort or folder changes.
const state = { category: "all", search: "", sortField: "created_at", sortDir: "desc", offset: 0, total: 0, loading: false, folder: "" };

// ============================================================
// AUTH
// ============================================================
async function boot() {
  session = await getSession();
  session ? enterApp() : showGate();
}

$("authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("gateError").textContent = "";
  $("unlockBtn").disabled = true;
  const { error, data } = await signIn($("email").value.trim(), $("password").value);
  $("unlockBtn").disabled = false;
  if (error) {
    $("gateError").textContent = "Incorrect email or passphrase.";
    return;
  }
  session = data.session;
  enterApp();
});

$("signOutBtn").addEventListener("click", async () => {
  await signOut();
  session = null;
  $("authForm").reset(); // clear email/password fields left over from the previous session
  $("gateError").textContent = "";
  showGate();
});

async function enterApp() {
  showApp();
  await refreshUsage();
  await loadFolders();
  await resetAndLoad();
}

async function loadFolders() {
  folders = await fetchFolders();
  renderFolderNav(folders, state.folder);
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
  // Explorer-style tiles up top — skipped while searching, since search
  // is a flat, cross-folder lookup rather than "what's in this folder".
  if (!state.search) {
    renderFolderTiles({
      folders,
      showBack: !!state.folder,
      onOpenFolder: (f) => selectFolder(f.id, f.name),
      onBack: () => selectFolder("", "Root"),
      onNewFolder: () => {
        renamingFolder = null;
        openFolderModal("create");
      },
      onFolderMenu: (f, x, y) => {
        menuFolder = f;
        showFolderMenu(x, y);
      },
    });
  }
  await loadNextPage();
}

function selectFolder(id, name) {
  state.folder = id;
  renderFolderNav(folders, id);
  updateFolderHint(name);
  resetAndLoad();
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

$("searchInput").addEventListener(
  "input",
  debounce((e) => {
    state.search = e.target.value.trim();
    resetAndLoad();
  }, 300),
);

$("sortSelect").addEventListener("change", (e) => {
  [state.sortField, state.sortDir] = e.target.value.split("-");
  resetAndLoad();
});

$("categoryNav").addEventListener("click", (e) => {
  const btn = e.target.closest(".nav-item");
  if (!btn) return;
  document.querySelectorAll("#categoryNav .nav-item").forEach((b) => b.classList.remove("is-active"));
  btn.classList.add("is-active");
  state.category = btn.dataset.category;
  resetAndLoad();
});

$("folderNav").addEventListener("click", (e) => {
  const btn = e.target.closest(".nav-item");
  if (!btn) return;
  const id = btn.dataset.folder; // '' means Root
  const name = id ? (folders.find((f) => f.id === id)?.name ?? "Folder") : "Root";
  selectFolder(id, name);
});

$("newFolderBtn").addEventListener("click", () => {
  renamingFolder = null;
  openFolderModal("create");
});
$("folderCloseBtn").addEventListener("click", () => $("folderModal").classList.add("hidden"));

$("folderForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("folderNameInput").value.trim();
  if (!name) return;
  try {
    if (renamingFolder) {
      const updated = await renameFolder(renamingFolder.id, name);
      $("folderModal").classList.add("hidden");
      await loadFolders();
      if (state.folder === updated.id) updateFolderHint(updated.name);
      resetAndLoad();
    } else {
      const created = await createFolder(name, session.user.id);
      $("folderModal").classList.add("hidden");
      await loadFolders();
      selectFolder(created.id, created.name); // jump straight into the folder you just made
    }
  } catch (err) {
    alert(err.message?.includes("duplicate") ? "You already have a folder with that name." : "Could not save the folder.");
    console.error(err);
  }
});

// ---- ⋮ / long-press / right-click menu on a folder tile ----
$("folderMenuRename").addEventListener("click", () => {
  hideFolderMenu();
  renamingFolder = menuFolder;
  openFolderModal("rename", menuFolder.name);
});

$("folderMenuDelete").addEventListener("click", async () => {
  const target = menuFolder;
  hideFolderMenu();
  if (!target) return;
  if (!confirm(`Delete "${target.name}" and everything inside it? This can't be undone.`)) return;
  try {
    await deleteFolderWithContents(target);
    await loadFolders();
    await refreshUsage();
    if (state.folder === target.id) selectFolder("", "Root");
    else resetAndLoad();
  } catch (err) {
    alert("Could not delete the folder.");
    console.error(err);
  }
});

document.addEventListener("click", (e) => {
  if (!$("folderMenu").contains(e.target) && !e.target.closest(".card-menu-btn")) hideFolderMenu();
});

// ============================================================
// UPLOAD
// ============================================================
$("uploadOpenBtn").addEventListener("click", () => $("uploadModal").classList.remove("hidden"));
$("uploadCloseBtn").addEventListener("click", () => {
  $("uploadModal").classList.add("hidden");
  $("uploadList").innerHTML = "";
});
$("dropzone").addEventListener("click", () => $("fileInput").click());
$("fileInput").addEventListener("change", (e) => handleUploads([...e.target.files]));
["dragover", "dragleave", "drop"].forEach((evt) =>
  $("dropzone").addEventListener(evt, (e) => {
    e.preventDefault();
    $("dropzone").classList.toggle("is-drag", evt === "dragover");
    if (evt === "drop") handleUploads([...e.dataTransfer.files]);
  }),
);

async function handleUploads(fileList) {
  for (const file of fileList) {
    const { bar, status } = renderUploadRow(file.name);
    try {
      bar.style.width = "40%";
      await uploadFile(file, session.user.id, state.folder);
      bar.style.width = "100%";
      status.textContent = "saved";
      status.classList.add("ok");
    } catch (err) {
      status.textContent = "failed";
      status.classList.add("err");
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
    onDownload: (url) => url && window.open(url, "_blank"),
    onDelete: async (file) => {
      if (!confirm(`Delete "${file.file_name}" permanently?`)) return;
      await deleteFile(file);
      $("previewModal").classList.add("hidden");
      await refreshUsage();
      await resetAndLoad();
    },
  });
}

$("previewCloseBtn").addEventListener("click", () => $("previewModal").classList.add("hidden"));

boot();
