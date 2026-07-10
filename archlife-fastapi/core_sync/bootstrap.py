# -*- coding: utf-8 -*-
"""
core_sync/bootstrap.py
------------------------
アプリ起動時(FastAPIのstartupイベント)に1回呼ぶ。

実際の初期化(共通スキーマの初期化・device_identity/既定プロフィールの
確保・plugin_manifest.jsonの登録)は local_ai_core.bootstrap_app に
一本化されている。ここでは interview_app と同じインターフェース
(bootstrap / get_profile_id / get_gate)を提供するだけの薄いラッパー。

重要: パスは一切ここで組み立てない。local_ai_core.paths が解決する
共有パス(全アプリ共通の core.db / device_identity.json)を使うことで、
interview_app が起動した後でも先に起動していても、同じ profile を指す。
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

from local_ai_core import bootstrap_app
from local_ai_core.paths import get_core_db_path
from local_ai_core.permissions import PermissionGate

_BACKEND_DIR = Path(__file__).resolve().parent.parent
_PLUGIN_MANIFEST_PATH = _BACKEND_DIR / "plugin_manifest.json"

_profile_id_cache: Optional[int] = None


def bootstrap() -> int:
    global _profile_id_cache
    profile_id = bootstrap_app(_PLUGIN_MANIFEST_PATH)
    _profile_id_cache = profile_id
    return profile_id


def get_profile_id() -> int:
    if _profile_id_cache is None:
        return bootstrap()
    return _profile_id_cache


def get_gate() -> PermissionGate:
    return PermissionGate(get_core_db_path())
