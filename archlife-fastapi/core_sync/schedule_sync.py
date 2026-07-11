# -*- coding: utf-8 -*-
"""
core_sync/schedule_sync.py
-----------------------------
ArchLifeの「今日のタスク」(lifeos:todos)を、local-ai-core の schedule_items
(全アプリ横断の予定/タスク台帳)へ反映する。

【重要な設計上の制約】
ArchLifeのバックエンドは暗号文(ciphertext/iv)しか保持せず、todosの中身を
一切復号しない(main.pyの方針と同じ)。したがってこのモジュールは
「暗号化ストレージから読み出して同期する」のではなく、**フロントエンドが
既に復号して手元に持っている平文のtodosを、明示的にこのモジュールへ渡す**
ことを前提にしている。フロントエンド側の実装は
frontend-integration/ArchLifeApp.jsx の persistTodos を参照。

interview_app の core_sync/schedule_sync.py と対になる実装だが、
「アプリのDBから直接読む」interview_app側とは異なり、こちらは
「フロントエンドから渡された平文を受け取る」形になっている点が異なる。
"""
from __future__ import annotations

from typing import Optional

from local_ai_core.schedule import ScheduleStore, ScheduleItem
from local_ai_core.permissions import PermissionDenied

from core_sync.bootstrap import get_profile_id, get_gate

APP_KEY = "archlife"


def sync_todos(todos: list[dict]) -> None:
    """フロントエンドから渡された平文todosを schedule_items へ反映する。

    todos の各要素は ArchLifeApp.jsx の todo 形状
    ( {id, text, done, date} ) を想定。date が無いtodoは「いつまでか」を
    持たないため、共通の予定表には出さない(schedule_itemsはそのために作った
    テーブルではあるが、期限のないメモまで並べると却って埋もれるため)。

    権限が許可されていない場合は PermissionDenied を静かに握りつぶす
    (=同期に失敗しても、ArchLife本来のtodo機能自体には一切影響させない)。
    """
    gate = get_gate()
    store = ScheduleStore(gate.db_path, gate=gate)
    profile_id = get_profile_id()

    for todo in todos:
        source_ref_id = str(todo.get("id", ""))
        if not source_ref_id:
            continue
        due_at = todo.get("date")
        title = (todo.get("text") or "").strip()
        if not title:
            continue
        status = "done" if todo.get("done") else "open"

        try:
            if not due_at:
                # 期限のないtodoは共通の予定表には出さないが、過去に同期済みなら
                # 「期限が消えた」扱いでキャンセルしておき、幽霊予定を残さない。
                store.set_status(profile_id, APP_KEY, source_ref_id, status="cancelled")
                continue
            store.upsert(
                profile_id=profile_id,
                app_key=APP_KEY,
                source_ref_id=source_ref_id,
                item_type="task",
                title=title,
                due_at=due_at,
                status=status,
            )
        except PermissionDenied:
            return  # このプロフィールで許可されていないなら、以降も呼ぶだけ無駄なので打ち切る


def list_cross_app_schedule() -> list[dict]:
    """他アプリ(interview_app等)発の予定も含めた、未完了の予定/タスク一覧を返す。

    ArchLifeの「今日」タブなどで「他アプリの予定も一緒に見せる」ために使う想定。
    権限が許可されていない場合は PermissionDenied を握りつぶして空リストを返す
    (ArchLife本来の機能はこれが読めなくても成立するため)。
    """
    gate = get_gate()
    store = ScheduleStore(gate.db_path, gate=gate)
    try:
        items: list[ScheduleItem] = store.list_open(get_profile_id(), APP_KEY)
    except PermissionDenied:
        return []
    return [
        {
            "id": item.id,
            "source_app": item.source_app,
            "item_type": item.item_type,
            "title": item.title,
            "due_at": item.due_at,
            "status": item.status,
        }
        for item in items
    ]
