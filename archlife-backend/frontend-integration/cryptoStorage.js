// cryptoStorage.js
//
// window.storage(get/set/delete/list) と同じ形のAPIを持つ、暗号化ストレージのアダプター。
// ArchLifeApp.jsx 内の `window.storage.xxx(...)` を、このファイルが export する
// `storage` インスタンスのメソッドに置き換えるだけで、既存のUIコードはそのまま使える。
//
// 仕組み:
// - 端末に保存した匿名ID(anonId)とユーザーが入力したパスフレーズから鍵を導出する。
// - 値はAES-GCMで暗号化してからバックエンドに送る。バックエンドは中身を復号しない。
// - パスフレーズを忘れると、そのデータは二度と復号できない(design上の制約)。

const ANON_ID_KEY = "archlife_anon_id";

function getOrCreateAnonId() {
  let id = localStorage.getItem(ANON_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(ANON_ID_KEY, id);
  }
  return id;
}

async function deriveKey(passphrase, saltStr) {
  const salt = new TextEncoder().encode(saltStr);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function bufToB64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function b64ToBuf(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}

async function encryptJSON(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  return { iv: bufToB64(iv), ciphertext: bufToB64(cipherBuf) };
}

async function decryptJSON(key, { iv, ciphertext }) {
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64ToBuf(iv) },
    key,
    b64ToBuf(ciphertext)
  );
  return JSON.parse(new TextDecoder().decode(plainBuf));
}

/**
 * @param {Object} opts
 * @param {string} opts.apiBaseUrl - 例: "http://localhost:8080"
 * @param {string} opts.passphrase - ユーザーが決めたパスフレーズ(忘れると復元不可)
 */
export function createStorage({ apiBaseUrl, passphrase }) {
  const anonId = getOrCreateAnonId();
  // saltは匿名ID自体を使う(端末ごとに固定、パスフレーズと組み合わせて鍵を導出する)
  const keyPromise = deriveKey(passphrase, anonId);

  return {
    // window.storage.get と同じ形: 成功時 {key, value(文字列化されたJSON)}, 失敗時throw
    async get(key) {
      const cryptoKey = await keyPromise;
      const r = await fetch(`${apiBaseUrl}/api/blobs/${anonId}/${encodeURIComponent(key)}`);
      if (r.status === 404) throw new Error("not found");
      if (!r.ok) throw new Error(`取得に失敗しました (status ${r.status})`);
      const enc = await r.json();
      const value = await decryptJSON(cryptoKey, enc);
      return { key, value: JSON.stringify(value), shared: false };
    },

    async set(key, value) {
      const cryptoKey = await keyPromise;
      const obj = typeof value === "string" ? JSON.parse(value) : value;
      const enc = await encryptJSON(cryptoKey, obj);
      const r = await fetch(`${apiBaseUrl}/api/blobs/${anonId}/${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(enc),
      });
      if (!r.ok) throw new Error(`保存に失敗しました (status ${r.status})`);
      return { key, value, shared: false };
    },

    async delete(key) {
      const r = await fetch(`${apiBaseUrl}/api/blobs/${anonId}/${encodeURIComponent(key)}`, {
        method: "DELETE",
      });
      if (!r.ok) throw new Error(`削除に失敗しました (status ${r.status})`);
      return { key, deleted: true, shared: false };
    },

    async list(prefix = "") {
      const r = await fetch(`${apiBaseUrl}/api/blobs/${anonId}`);
      if (!r.ok) throw new Error(`一覧取得に失敗しました (status ${r.status})`);
      const rows = await r.json();
      return { keys: rows.map((row) => row.item_key).filter((k) => k.startsWith(prefix)) };
    },

    anonId,
  };
}
