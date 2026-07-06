"""
db.py
-----
旧 `server.js` の Postgres(Neon)スキーマ(schema.sql)を、SQLiteに移植したもの。

方針(旧実装からの継承):
  - サーバーは anon_id と暗号文(ciphertext/iv)しか扱わない。中身は復号しない。
  - ai_settings は anon_id 単位で「外部APIを使うか」を保持するだけで、個人情報は含まない。

Phase 3(共通データ基盤統合)への引き継ぎ事項:
  - 現状の anon_id は Archlife 独自の識別子。local_ai_core.identity.DeviceIdentity の
    device_id に統合する場合、既存ユーザーの anon_id からの移行パスが必要になる。
    今回はスコープ外とし、まずは server.js と同じ契約のままFastAPI化することを優先した。
"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

_SCHEMA = """
CREATE TABLE IF NOT EXISTS blobs (
    anon_id     TEXT NOT NULL,
    item_key    TEXT NOT NULL,
    ciphertext  TEXT NOT NULL,
    iv          TEXT NOT NULL,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY (anon_id, item_key)
);

CREATE TABLE IF NOT EXISTS ai_settings (
    anon_id             TEXT PRIMARY KEY,
    allow_external_api  INTEGER NOT NULL DEFAULT 0,
    external_provider   TEXT CHECK (external_provider IN ('claude', 'openai')) DEFAULT 'claude'
);

CREATE INDEX IF NOT EXISTS idx_blobs_anon_id ON blobs (anon_id);
"""

_DB_PATH = "archlife.db"


def set_db_path(path: str) -> None:
    global _DB_PATH
    _DB_PATH = path


def init_db(path: str | None = None) -> None:
    if path:
        set_db_path(path)
    if _DB_PATH != ":memory:":
        Path(_DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    with db_session() as conn:
        conn.executescript(_SCHEMA)


@contextmanager
def db_session() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Blobs
# ---------------------------------------------------------------------------

def put_blob(anon_id: str, key: str, ciphertext: str, iv: str) -> None:
    with db_session() as conn:
        conn.execute(
            """
            INSERT INTO blobs (anon_id, item_key, ciphertext, iv, updated_at)
            VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
            ON CONFLICT(anon_id, item_key)
            DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, updated_at = excluded.updated_at
            """,
            (anon_id, key, ciphertext, iv),
        )


def get_blob(anon_id: str, key: str) -> dict | None:
    with db_session() as conn:
        row = conn.execute(
            "SELECT ciphertext, iv, updated_at FROM blobs WHERE anon_id = ? AND item_key = ?",
            (anon_id, key),
        ).fetchone()
        return dict(row) if row else None


def list_blob_keys(anon_id: str) -> list[dict]:
    with db_session() as conn:
        rows = conn.execute(
            "SELECT item_key, updated_at FROM blobs WHERE anon_id = ? ORDER BY updated_at DESC",
            (anon_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def delete_blob(anon_id: str, key: str) -> None:
    with db_session() as conn:
        conn.execute("DELETE FROM blobs WHERE anon_id = ? AND item_key = ?", (anon_id, key))


# ---------------------------------------------------------------------------
# AI settings
# ---------------------------------------------------------------------------

def get_ai_settings(anon_id: str) -> dict:
    with db_session() as conn:
        row = conn.execute(
            "SELECT allow_external_api, external_provider FROM ai_settings WHERE anon_id = ?",
            (anon_id,),
        ).fetchone()
        if row is None:
            return {"allow_external_api": False, "external_provider": "claude"}
        return {"allow_external_api": bool(row["allow_external_api"]), "external_provider": row["external_provider"]}


def put_ai_settings(anon_id: str, allow_external_api: bool, external_provider: str) -> None:
    with db_session() as conn:
        conn.execute(
            """
            INSERT INTO ai_settings (anon_id, allow_external_api, external_provider)
            VALUES (?, ?, ?)
            ON CONFLICT(anon_id) DO UPDATE SET
                allow_external_api = excluded.allow_external_api,
                external_provider = excluded.external_provider
            """,
            (anon_id, int(bool(allow_external_api)), external_provider or "claude"),
        )
