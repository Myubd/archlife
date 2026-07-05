const { Pool } = require("pg");

// Neonは接続にSSLを要求する。ローカルのdocker-compose用Postgresでは無効化できるよう
// PGSSLMODE=disable を明示的に指定できるようにしてある。
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
});

async function putBlob(anonId, key, ciphertext, iv) {
  await pool.query(
    `INSERT INTO blobs (anon_id, item_key, ciphertext, iv, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (anon_id, item_key)
     DO UPDATE SET ciphertext = $3, iv = $4, updated_at = now()`,
    [anonId, key, ciphertext, iv]
  );
}

async function getBlob(anonId, key) {
  const r = await pool.query(
    "SELECT ciphertext, iv, updated_at FROM blobs WHERE anon_id = $1 AND item_key = $2",
    [anonId, key]
  );
  return r.rows[0] || null;
}

async function listBlobs(anonId) {
  const r = await pool.query(
    "SELECT item_key, updated_at FROM blobs WHERE anon_id = $1 ORDER BY updated_at DESC",
    [anonId]
  );
  return r.rows;
}

async function deleteBlob(anonId, key) {
  await pool.query("DELETE FROM blobs WHERE anon_id = $1 AND item_key = $2", [anonId, key]);
}

async function getAiSettings(anonId) {
  const r = await pool.query(
    "SELECT allow_external_api, external_provider FROM ai_settings WHERE anon_id = $1",
    [anonId]
  );
  return r.rows[0] || { allow_external_api: false, external_provider: "claude" };
}

async function setAiSettings(anonId, allowExternalApi, provider) {
  await pool.query(
    `INSERT INTO ai_settings (anon_id, allow_external_api, external_provider)
     VALUES ($1, $2, $3)
     ON CONFLICT (anon_id) DO UPDATE SET allow_external_api = $2, external_provider = $3`,
    [anonId, !!allowExternalApi, provider || "claude"]
  );
}

module.exports = { putBlob, getBlob, listBlobs, deleteBlob, getAiSettings, setAiSettings };
