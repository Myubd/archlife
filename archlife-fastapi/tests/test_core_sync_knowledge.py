# -*- coding: utf-8 -*-
"""
tests/test_core_sync_knowledge.py
-------------------------------------
`core_sync.knowledge_sync` (goals ⇔ knowledge_items) の結合テスト。
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


def _grant_knowledge_permissions(profile_id):
    from core_sync import get_gate

    gate = get_gate()
    gate.grant(profile_id, "archlife", "knowledge_items:write")
    gate.grant(profile_id, "archlife", "knowledge_items:read")


def test_sync_goals_is_reflected_with_progress_summary(isolated_core_paths):
    from core_sync import bootstrap, sync_goals, get_gate
    from local_ai_core.knowledge import KnowledgeStore

    profile_id = bootstrap()
    _grant_knowledge_permissions(profile_id)

    sync_goals([{"id": "g1", "title": "TOEIC800点", "progress": 40}])

    store = KnowledgeStore(get_gate().db_path, gate=get_gate())
    items = store.list_active(profile_id, "archlife", category="life_goal")
    assert len(items) == 1
    assert items[0].title == "TOEIC800点"
    assert items[0].summary == "進捗 40%"
    assert items[0].source_app == "archlife"


def test_sync_goals_upsert_updates_progress(isolated_core_paths):
    from core_sync import bootstrap, sync_goals, get_gate
    from local_ai_core.knowledge import KnowledgeStore

    profile_id = bootstrap()
    _grant_knowledge_permissions(profile_id)

    sync_goals([{"id": "g2", "title": "簿記2級", "progress": 10}])
    sync_goals([{"id": "g2", "title": "簿記2級", "progress": 80}])

    store = KnowledgeStore(get_gate().db_path, gate=get_gate())
    items = store.list_active(profile_id, "archlife", category="life_goal")
    assert len(items) == 1
    assert items[0].summary == "進捗 80%"


def test_sync_goals_without_permission_does_not_raise(isolated_core_paths):
    from core_sync import bootstrap, sync_goals, get_gate
    from local_ai_core.knowledge import KnowledgeStore

    profile_id = bootstrap()  # grantしない

    sync_goals([{"id": "g3", "title": "許可なし目標", "progress": 5}])

    _grant_knowledge_permissions(profile_id)
    store = KnowledgeStore(get_gate().db_path, gate=get_gate())
    assert store.list_active(profile_id, "archlife", category="life_goal") == []


def test_api_post_goals_roundtrip(isolated_core_paths, monkeypatch):
    monkeypatch.setenv("ARCHLIFE_DB_PATH", os.path.join(tempfile.gettempdir(), "archlife_test_goals.db"))

    from fastapi.testclient import TestClient
    from main import app

    with TestClient(app) as client:
        from core_sync import get_profile_id

        _grant_knowledge_permissions(get_profile_id())

        res = client.post(
            "/api/core-sync/goals",
            json={"goals": [{"id": "api-g1", "title": "API経由の目標", "progress": 25}]},
        )
        assert res.status_code == 200
        assert res.json() == {"ok": True, "synced": True}
