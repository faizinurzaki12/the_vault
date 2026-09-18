import { sb } from "./supabaseClient.js";
import { BUCKET, SIGNED_URL_TTL, PAGE_SIZE } from "./config.js";
import { categorize } from "./utils.js";
import { compressImage } from "./compress.js";

// Signed URLs are reusable for an hour — cache them so re-rendering a page
// (search, sort, going back) doesn't re-hit Storage for the same file.
const signedUrlCache = new Map(); // storage_path -> { url, expiresAt }

export async function getSignedUrl(path) {
  const cached = signedUrlCache.get(path);
  const now = Date.now();
  if (cached && cached.expiresAt > now + 30_000) return cached.url;
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  if (error || !data) return null;
  signedUrlCache.set(path, { url: data.signedUrl, expiresAt: now + SIGNED_URL_TTL * 1000 });
  return data.signedUrl;
}

// One cheap aggregate query (via a Postgres function) instead of pulling
// every row just to sum sizes — see vault_usage_stats() in schema.sql.
export async function fetchUsageStats() {
  const { data, error } = await sb.rpc("vault_usage_stats");
  if (error) {
    console.error(error);
    return { total_bytes: 0, total_count: 0 };
  }
  return data?.[0] ?? { total_bytes: 0, total_count: 0 };
}

// Paginated + server-side filtered/sorted list. Never loads the whole table.
// folder: '' | null -> root (folder_id IS NULL); otherwise a folder's uuid.
export async function fetchFilesPage({ category, search, sortField, sortDir, offset, folder, limit = PAGE_SIZE }) {
  let query = sb.from("vault_files").select("*", { count: "exact" });
  if (category !== "all") query = query.eq("category", category);
  if (search) query = query.ilike("file_name", `%${search}%`);
  query = folder ? query.eq("folder_id", folder) : query.is("folder_id", null);
  query = query.order(sortField, { ascending: sortDir === "asc" }).range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) throw error;
  return { rows: data, total: count ?? 0 };
}

export async function fetchFolders() {
  const { data, error } = await sb.from("vault_folders").select("*").order("name", { ascending: true });
  if (error) {
    console.error(error);
    return [];
  }
  return data;
}

export async function createFolder(name, userId) {
  const { data, error } = await sb.from("vault_folders").insert({ user_id: userId, name }).select().single();
  if (error) throw error;
  return data;
}

export async function uploadFile(file, userId, folder) {
  const category = categorize(file.type || "application/octet-stream");
  const toUpload = category === "image" ? await compressImage(file) : file;

  const safeName = file.name.replace(/[^\w.\-]/g, "_");
  const path = `${userId}/${Date.now()}_${safeName}`;

  const { error: upErr } = await sb.storage.from(BUCKET).upload(path, toUpload, {
    contentType: toUpload.type || "application/octet-stream",
  });
  if (upErr) throw upErr;

  const { data, error: dbErr } = await sb
    .from("vault_files")
    .insert({
      user_id: userId,
      folder_id: folder || null,
      file_name: file.name,
      storage_path: path,
      mime_type: toUpload.type || "application/octet-stream",
      category,
      file_size: toUpload.size,
      original_size: file.size,
      is_compressed: toUpload !== file,
    })
    .select()
    .single();
  if (dbErr) throw dbErr;

  return data;
}

export async function deleteFile(file) {
  await sb.storage.from(BUCKET).remove([file.storage_path]);
  const { error } = await sb.from("vault_files").delete().eq("id", file.id);
  if (error) throw error;
  signedUrlCache.delete(file.storage_path);
}
