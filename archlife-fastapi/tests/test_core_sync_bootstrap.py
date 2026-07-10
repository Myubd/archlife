"""
tests/test_core_sync_bootstrap.py
----------------------------------
Archlifeがlocal-ai-coreの共通データ基盤に正しく参加できることの
スモークテスト。実プロセスでは interview_app と同じ core.db /
device_identity.json を指すが、テストでは env var で一時パスに
隔離し、他のテストや実データに影響しないようにする。
"""
import os
import tempfile

import pytest


@pytest.fixture()
def isolated_core_paths(tmp_path, monkeypatch):
    monkeypatch.setenv("LOCAL_AI_CORE_DB_PATH", str(tmp_path / "core.db"))
    monkeypatch.setenv("LOCAL_AI_CORE_DEVICE_IDENTITY_PATH", str(tmp_path / "device_identity.json"))
    yield tmp_path


def test_bootstrap_registers_archlife_as_source_app(isolated_core_paths):
    from core_sync import bootstrap
    from local_ai_core.schema import db_session

    profile_id = bootstrap()
    assert isinstance(profile_id, int)

    core_db_path = str(isolated_core_paths / "core.db")
    with db_session(core_db_path) as conn:
        row = conn.execute(
            "SELECT app_key FROM source_apps WHERE app_key = 'archlife'"
        ).fetchone()
    assert row is not None


def test_bootstrap_is_idempotent(isolated_core_paths):
    from core_sync import bootstrap

    first = bootstrap()
    second = bootstrap()
    assert first == second
