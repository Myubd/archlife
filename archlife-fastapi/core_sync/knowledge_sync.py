# -*- coding: utf-8 -*-
"""
core_sync/knowledge_sync.py
------------------------------
ArchLifeの目標(lifeos:goals)を、local-ai-core の knowledge_items
(全アプリ横断のナレッジ台帳)へ反映する。

【なぜdiary/memosではなくgoalsを先にやるか】
diary(日記)・memos(メモ)は自由記述で、内容の機微度が高い
(悩み・愚痴・人間関係の話などが書かれる可能性が高い)。これを安易に
共通台帳に「要約」として書き出すと、「AIが全部知っている」を避けるという
方針と衝突しやすい。一方goalsは「タイトル+進捗%」という定型データで、
就活支援アプリ側のキャリア相談などと組み合わせても違和感が少なく、
機微度も相対的に低い。そのため今回はgoalsのみを対象にした。
diary/memosを共通化するかどうかは、要約の粒度・ユーザーへの同意の取り方
(アプリ全体の許可ではなく、エントリ単位で「これは共有していい」を
選ばせるUIが要るのではないか)を別途検討してから決めるべきだと考える。

【暗号化ストレージとの関係】schedule_sync.py と同じ設計。バックエンドは
goalsの中身を保存目的では復号しないが、このモジュールに渡される平文は
フロントエンドが「同期のためだけに」明示的に送ってくるものであり、
/api/blobs に保存される暗号文とは独立している。
"""
from __future__ import annotations

from local_ai_core.knowledge import KnowledgeStore
from local_ai_core.permissions import PermissionDenied

from core_sync.bootstrap import get_profile_id, get_gate

APP_KEY = "archlife"


def sync_goals(goals: list[dict]) -> None:
    """フロントエンドから渡された平文goalsを knowledge_items へ反映する。

    goals の各要素は ArchLifeApp.jsx の goal 形状( {id, title, progress} )を想定。
    タイトルそのものは書き出すが、進捗はsummaryに数値として入れるのみで、
    目標の背景・理由といった自由記述は元々goalsに含まれていないため問題ない。

    権限が許可されていない場合は静かに諦める(goals本来の保存機能には影響させない)。
    """
    gate = get_gate()
    store = KnowledgeStore(gate.db_path, gate=gate)
    profile_id = get_profile_id()

    for goal in goals:
        source_ref_id = str(goal.get("id", ""))
        title = (goal.get("title") or "").strip()
        if not source_ref_id or not title:
            continue
        progress = goal.get("progress", 0)
        try:
            store.upsert(
                profile_id=profile_id,
                app_key=APP_KEY,
                source_ref_id=source_ref_id,
                title=title,
                category="life_goal",
                summary=f"進捗 {progress}%",
                tags=["goal"],
            )
        except PermissionDenied:
            return  # 許可されていないなら、以降も呼ぶだけ無駄なので打ち切る
