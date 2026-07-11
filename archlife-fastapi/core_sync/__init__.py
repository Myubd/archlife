# -*- coding: utf-8 -*-
"""
core_sync
----------
Archlife(ライフサポートOS)を local-ai-core の共通データ基盤に参加させるための
最小限のブリッジ。interview_app 側の core_sync と同じ形にしてある
(2つのアプリが同じインターフェースで共通基盤に触れることで、実装の乖離を防ぐ)。
"""
from .bootstrap import bootstrap, get_profile_id, get_gate
from .schedule_sync import sync_todos, list_cross_app_schedule
from .knowledge_sync import sync_goals

__all__ = [
    "bootstrap",
    "get_profile_id",
    "get_gate",
    "sync_todos",
    "list_cross_app_schedule",
    "sync_goals",
]
