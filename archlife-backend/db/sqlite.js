const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

// Electronアプリからは app.getPath("userData") を DATA_DIR として渡す想定。
// 未指定時(通常のnpm実行時)は archlife-backend/data/ 以下に作る。
const dataDir = process.env.DATA_DIR || path.join(__dirname, "..", "data");
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "archlife.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS blobs (
    anon_id     TEXT NOT NULL,
    item_key    TEXT NOT NULL,
    ciphertext  TEXT NOT NULL,
    iv          TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (anon_id, item_key)
  );

  CREATE TABLE IF NOT EXISTS ai_settings (
    anon_id             TEXT PRIMARY KEY,
    allow_external_api  INTEGER NOT NULL DEFAULT 0,
    external_provider   TEXT DEFAULT 'claude'
  );

  CREATE INDEX IF NOT EXISTS idx_blobs_anon_id ON blobs (anon_id);
`);

const stmts = {
  putBlob: db.prepare(
    `INSERT INTO blobs (anon_id, item_key, ciphertext, iv, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(anon_id, item_key)
     DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, updated_at = datetime('now')`
  ),
  getBlob: db.prepare(
    "SELECT ciphertext, iv, updated_at FROM blobs WHERE anon_id = ? AND item_key = ?"
  ),
  listBlobs: db.prepare(
    "SELECT item_key, updated_at FROM blobs WHERE anon_id = ? ORDER BY updated_at DESC"
  ),
  deleteBlob: db.prepare("DELETE FROM blobs WHERE anon_id = ? AND item_key = ?"),
  getAiSettings: db.prepare(
    "SELECT allow_external_api, external_provider FROM ai_settings WHERE anon_id = ?"
  ),
  setAiSettings: db.prepare(
    `INSERT INTO ai_settings (anon_id, allow_external_api, external_provider)
     VALUES (?, ?, ?)
     ON CONFLICT(anon_id) DO UPDATE SET allow_external_api = excluded.allow_external_api, external_provider = excluded.external_provider`
  ),
};

async function putBlob(anonId, key, ciphertext, iv) {
  stmts.putBlob.run(anonId, key, ciphertext, iv);
}

async function getBlob(anonId, key) {
  return stmts.getBlob.get(anonId, key) || null;
}

async function listBlobs(anonId) {
  return stmts.listBlobs.all(anonId);
}

async function deleteBlob(anonId, key) {
  stmts.deleteBlob.run(anonId, key);
}

async function getAiSettings(anonId) {
  const row = stmts.getAiSettings.get(anonId);
  if (!row) return { allow_external_api: false, external_provider: "claude" };
  return { allow_external_api: !!row.allow_external_api, external_provider: row.external_provider };
}

async function setAiSettings(anonId, allowExternalApi, provider) {
  stmts.setAiSettings.run(anonId, allowExternalApi ? 1 : 0, provider || "claude");
}

module.exports = { putBlob, getBlob, listBlobs, deleteBlob, getAiSettings, setAiSettings };
