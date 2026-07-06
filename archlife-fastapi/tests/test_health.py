"""
tests/test_health.py
---------------------
archlife-fastapi の最小限のスモークテスト。

このアプリにはまだテストが1つも無かったため、まずは「起動できて、
主要エンドポイントが応答する」ことだけを確認する最小構成から始める。
Ollamaが起動していないCI環境でも通るよう、実際のAI呼び出しはテストしない
(それは今後、local_ai_core側をモックする形で追加する)。
"""
import os
import tempfile

import pytest

os.environ["ARCHLIFE_DB_PATH"] = os.path.join(tempfile.gettempdir(), "archlife_test.db")

from fastapi.testclient import TestClient

from main import app


@pytest.fixture()
def client():
    # `with`ブロックで使うことで、@app.on_event("startup") (db.init_db) を
    # 確実に発火させる。そうしないとテーブル未作成のままリクエストが飛び、
    # "no such table: blobs" のようなエラーになる。
    with TestClient(app) as c:
        yield c


def test_health(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"ok": True}


def test_blob_put_get_delete_roundtrip(client):
    anon_id = "test-anon"
    key = "today-tasks"

    put_res = client.put(f"/api/blobs/{anon_id}/{key}", json={"ciphertext": "abc", "iv": "def"})
    assert put_res.status_code == 200
    assert put_res.json() == {"ok": True}

    get_res = client.get(f"/api/blobs/{anon_id}/{key}")
    assert get_res.status_code == 200
    assert get_res.json()["ciphertext"] == "abc"
    assert get_res.json()["iv"] == "def"

    list_res = client.get(f"/api/blobs/{anon_id}")
    assert list_res.status_code == 200
    assert any(b["item_key"] == key for b in list_res.json())

    del_res = client.delete(f"/api/blobs/{anon_id}/{key}")
    assert del_res.status_code == 200

    get_after_delete = client.get(f"/api/blobs/{anon_id}/{key}")
    assert get_after_delete.status_code == 404


def test_ai_settings_default_and_update(client):
    anon_id = "test-anon-2"

    default_res = client.get(f"/api/ai-settings/{anon_id}")
    assert default_res.status_code == 200
    assert default_res.json() == {"allow_external_api": False, "external_provider": "claude"}

    put_res = client.put(
        f"/api/ai-settings/{anon_id}",
        json={"allow_external_api": True, "external_provider": "openai"},
    )
    assert put_res.status_code == 200

    updated_res = client.get(f"/api/ai-settings/{anon_id}")
    assert updated_res.json() == {"allow_external_api": True, "external_provider": "openai"}
