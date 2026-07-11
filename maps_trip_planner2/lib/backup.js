// Durable JSON-file backup for trips + saved places.
//
// chrome.storage.local stays the fast working store all three surfaces share,
// but it's wiped if the extension is removed/reinstalled. To make the data
// survive that, the planner mirrors it into a real file the user picks, using
// the File System Access API (the planner page is a secure extension context).
// The file lives outside Chrome, so removing the extension can't touch it.
//
// The picked file's handle is persisted in IndexedDB so the same file is reused
// across sessions. Chrome re-asks for write permission once per browser restart
// (a single click) — that's a security rule we can't bypass, so the UI surfaces
// a "Reconnect" affordance when the grant has lapsed.

const DB_NAME = "mtp-backup";
const STORE = "handles";
const HANDLE_KEY = "backupFile";

export const BACKUP_FORMAT = "maps_trip_planner.backup";
export const BACKUP_VERSION = 1;

// ---- IndexedDB (persist the FileSystemFileHandle across sessions) ----------
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbPut(key, val) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(val, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbGet(key) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
async function idbDel(key) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function isSupported() {
  return typeof window !== "undefined" && "showSaveFilePicker" in window;
}

export function getSavedHandle() { return idbGet(HANDLE_KEY); }
export function saveHandle(handle) { return idbPut(HANDLE_KEY, handle); }
export function clearHandle() { return idbDel(HANDLE_KEY); }

// ---- Permissions -----------------------------------------------------------
export async function queryGranted(handle, readWrite) {
  const opts = { mode: readWrite ? "readwrite" : "read" };
  try { return (await handle.queryPermission(opts)) === "granted"; }
  catch { return false; }
}
export async function verifyPermission(handle, readWrite) {
  const opts = { mode: readWrite ? "readwrite" : "read" };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  return (await handle.requestPermission(opts)) === "granted";
}

// ---- Serialize / parse -----------------------------------------------------
// data = { trips, activeTripId, locations }
export function serialize(data) {
  return JSON.stringify({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      trips: data.trips || [],
      activeTripId: data.activeTripId || "",
      locations: data.locations || [],
    },
  }, null, 2);
}

// Accepts our wrapped format, a bare { trips, ... } object, a raw array of
// trips, or a single trip object — so hand-written or older exports still work.
export function parse(text) {
  const obj = JSON.parse(text);
  if (Array.isArray(obj)) return { trips: obj, activeTripId: "", locations: [] };
  if (obj && obj.data && (obj.data.trips || obj.data.locations)) {
    return {
      trips: obj.data.trips || [],
      activeTripId: obj.data.activeTripId || "",
      locations: obj.data.locations || [],
    };
  }
  if (obj && (obj.trips || obj.locations)) {
    return {
      trips: obj.trips || [],
      activeTripId: obj.activeTripId || "",
      locations: obj.locations || [],
    };
  }
  if (obj && obj.stops) return { trips: [obj], activeTripId: "", locations: [] };
  throw new Error("Unrecognized backup file");
}

// ---- File I/O --------------------------------------------------------------
export async function writeHandle(handle, text) {
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}
export async function readHandle(handle) {
  const file = await handle.getFile();
  return file.text();
}

export function pickSaveFile() {
  return window.showSaveFilePicker({
    suggestedName: "maps-trip-planner-backup.json",
    types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
  });
}
export async function pickOpenFile() {
  const [handle] = await window.showOpenFilePicker({
    types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
    multiple: false,
  });
  return handle;
}
