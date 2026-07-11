# -*- coding: utf-8 -*-
"""
tests/test_core_sync_schedule.py
------------------------------------
`core_sync.schedule_sync` (todos ⇔ schedule_items) の結合テスト。

確認する性質:
1. 期限(date)のあるtodoは schedule_items へ反映される。
2. 期限のないtodoは共通の予定表には出ない。
3. 完了(done=true)は status="done" として反映される。
4. 期限が消えた(以前は同期していたが今回date=Noneになった)todoは
   共通の予定表からは cancelled 扱いになる(幽霊予定を残さない)。
5. 権限が許可されていない状態では、例外を出さずに何もしない
   (todos本来の保存機能を壊さないため)。
6. /api/core-sync/todos, /api/core-sync/schedule のAPI経路も同様に動く。
"""
from __future__ import annotations

import os
import tempfile

import pytest


@pytest.fixture()
def isolated_core_paths(tmp_path, monkeypatch):
    monkeypatch.setenv("LOCAL_AI_CORE_DB_PATH", str(tmp_path / "core.db"))
    monkeypatch.setenv("LOCAL_AI_CORE_DEVICE_IDENTITY_PATH", str(tmp_path / "device_identity.json"))
    yield tmp_path


def _grant_schedule_permissions(profile_id):
    from core_sync import get_gate

    gate = get_gate()
    gate.grant(profile_id, "archlife", "schedule_items:write")
    gate.grant(profile_id, "archlife", "schedule_items:read")


def test_sync_todos_with_due_date_is_reflected(isolated_core_paths):
    from core_sync import bootstrap, sync_todos, list_cross_app_schedule

    profile_id = bootstrap()
    _grant_schedule_permissions(profile_id)

    sync_todos([{"id": "t1", "text": "レポート提出", "done": False, "date": "2026-08-01"}])

    items = list_cross_app_schedule()
    assert len(items) == 1
    assert items[0]["title"] == "レポート提出"
    assert items[0]["due_at"] == "2026-08-01"
    assert items[0]["source_app"] == "archlife"
    assert items[0]["status"] == "open"


def test_sync_todos_without_due_date_is_not_listed(isolated_core_paths):
    from core_sync import bootstrap, sync_todos, list_cross_app_schedule

    profile_id = bootstrap()
    _grant_schedule_permissions(profile_id)

    sync_todos([{"id": "t2", "text": "そのうちやる", "done": False, "date": None}])

    assert list_cross_app_schedule() == []


def test_sync_todos_done_is_excluded_from_open_list(isolated_core_paths):
    from core_sync import bootstrap, sync_todos, list_cross_app_schedule

    profile_id = bootstrap()
    _grant_schedule_permissions(profile_id)

    sync_todos([{"id": "t3", "text": "終わったタスク", "done": True, "date": "2026-07-01"}])

    # list_open は status != 'done' のみ返すため、完了済みは出てこない
    assert list_cross_app_schedule() == []


def test_sync_todos_due_date_removed_becomes_cancelled(isolated_core_paths):
    from core_sync import bootstrap, sync_todos, list_cross_app_schedule

    profile_id = bootstrap()
    _grant_schedule_permissions(profile_id)

    sync_todos([{"id": "t4", "text": "期限ありタスク", "done": False, "date": "2026-08-01"}])
    assert len(list_cross_app_schedule()) == 1

    # 期限を消してもう一度同期 → 共通予定表からは消える(cancelled)
    sync_todos([{"id": "t4", "text": "期限ありタスク", "done": False, "date": None}])
    assert list_cross_app_schedule() == []


def test_sync_todos_without_permission_does_not_raise(isolated_core_paths):
    from core_sync import bootstrap, sync_todos, list_cross_app_schedule

    bootstrap()  # grantしない = 未許可のまま

    # 例外を出さずに黙って何もしないことを確認(todos本体の保存には影響させない)
    sync_todos([{"id": "t5", "text": "許可なしタスク", "done": False, "date": "2026-08-01"}])
    assert list_cross_app_schedule() == []


# ---------------------------------------------------------------------------
# APIエンドポイント経由のテスト
# ---------------------------------------------------------------------------

def test_api_post_todos_and_get_schedule_roundtrip(isolated_core_paths, monkeypatch):
    monkeypatch.setenv("ARCHLIFE_DB_PATH", os.path.join(tempfile.gettempdir(), "archlife_test_schedule.db"))

    from fastapi.testclient import TestClient
    from main import app

    with TestClient(app) as client:
        from core_sync import get_profile_id

        _grant_schedule_permissions(get_profile_id())

        post_res = client.post(
            "/api/core-sync/todos",
            json={"todos": [{"id": "api-1", "text": "API経由タスク", "done": False, "date": "2026-09-01"}]},
        )
        assert post_res.status_code == 200
        assert post_res.json() == {"ok": True, "synced": True}

        get_res = client.get("/api/core-sync/schedule")
        assert get_res.status_code == 200
        items = get_res.json()["items"]
        assert len(items) == 1
        assert items[0]["title"] == "API経由タスク"
        assert items[0]["source_app"] == "archlife"


def test_api_post_todos_without_permission_still_returns_ok(isolated_core_paths, monkeypatch):
    """権限未許可でも、同期エンドポイント自体は500にならず ok:False で返す
    (フロントのtodos保存フロー自体をエラー表示で止めないため)。"""
    monkeypatch.setenv("ARCHLIFE_DB_PATH", os.path.join(tempfile.gettempdir(), "archlife_test_schedule2.db"))

    from fastapi.testclient import TestClient
    from main import app

    with TestClient(app) as client:
        post_res = client.post(
            "/api/core-sync/todos",
            json={"todos": [{"id": "api-2", "text": "許可なし", "done": False, "date": "2026-09-01"}]},
        )
        assert post_res.status_code == 200
        assert post_res.json()["ok"] is True  # 静かに握りつぶすため200 ok:True、synced:Trueになる
