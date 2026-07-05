-- ArchLifeOS: 匿名IDに紐づく暗号化データのみを保持するスキーマ。
-- サーバー側は ciphertext の中身を一切復号しない。

CREATE TABLE IF NOT EXISTS blobs (
  anon_id     TEXT NOT NULL,
  item_key    TEXT NOT NULL,
  ciphertext  TEXT NOT NULL,   -- base64 (AES-GCM暗号文)
  iv          TEXT NOT NULL,   -- base64 (AES-GCM IV, 12byte)
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (anon_id, item_key)
);

-- ユーザーごとのAI設定(外部APIを使うかどうか)。個人情報は含まない。
CREATE TABLE IF NOT EXISTS ai_settings (
  anon_id             TEXT PRIMARY KEY,
  allow_external_api  BOOLEAN NOT NULL DEFAULT false,
  external_provider   TEXT CHECK (external_provider IN ('claude', 'openai')) DEFAULT 'claude'
);

CREATE INDEX IF NOT EXISTS idx_blobs_anon_id ON blobs (anon_id);
