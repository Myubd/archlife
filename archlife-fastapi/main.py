"""
main.py
-------
ArchLifeOS backend (FastAPI版)。

旧 `server.js` (Node/Express) と同じエンドポイント契約(パス・レスポンス形式)を
維持したまま、内部実装を Python/FastAPI + SQLite + local_ai_core に置き換えたもの。
既存フロントエンド(cryptoStorage.js 等)は無改修で動く想定。

設計方針(旧実装から継承):
  - サーバーは anon_id と暗号文(ciphertext/iv)しか扱わない。中身は復号しない。
  - AI分析は既定でローカルLLM(local_ai_core経由のOllama)に投げる。
  - 外部API(Claude/GPT)は、フロントが明示的に useExternal=true を送ったときだけ呼ぶ。
  - リクエストボディはログに出さない。
"""
from __future__ import annotations

import logging
import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import db
from local_ai_core.llm import (
    AiSettings,
    ChatMessage,
    ClaudeProvider,
    LLMProviderError,
    LLMRouter,
    OllamaProvider,
    OpenAIProvider,
)
from local_ai_core.prompts import PromptRegistry, PromptTemplate, guards

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("archlife")

app = FastAPI(title="ArchLifeOS backend")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def _minimal_access_log(request, call_next):
    # プライバシー配慮: ボディを含まない最小限のアクセスログのみ出す(旧実装と同じ方針)
    logger.info("%s %s", request.method, request.url.path)
    return await call_next(request)


@app.on_event("startup")
def _startup() -> None:
    db.init_db(os.environ.get("ARCHLIFE_DB_PATH", "archlife.db"))

    # 共通データ基盤(core.db)への参加。anon_id/blobs等のArchlife固有データは
    # 引き続き上のdb.init_db()が管理するarchlife.dbに残す。ここで行うのは
    # 「共通スキーマの初期化」「共通のdevice_identity/profileの確保」
    # 「plugin_manifest.jsonの申告」のみで、これらは全アプリで同じ
    # local_ai_core.paths のパスを指すため、interview_appと同じprofileを共有する。
    # 失敗してもArchlife本来の機能(暗号化データの保存/取得)には影響させない。
    try:
        from core_sync import bootstrap as core_bootstrap

        profile_id = core_bootstrap()
        logger.info("core_sync bootstrap done (profile_id=%s)", profile_id)
    except Exception:
        logger.exception("core_sync bootstrap failed (continuing without it)")


llm_router = LLMRouter(
    local=OllamaProvider(
        base_url=os.environ.get("OLLAMA_URL"),
        model=os.environ.get("OLLAMA_MODEL", "qwen3:8b"),
    ),
    external={"claude": ClaudeProvider(), "openai": OpenAIProvider()},
)

# 旧 server.js の buildPrompt() にあった7種類のテンプレートを移植
registry = PromptRegistry()
_ROLE_DESCRIPTIONS = {
    "today": "あなたはライフ管理アプリのアシスタントです。要約データ(タスク・習慣・目標)をもとに、今日優先すべきことを3〜5個、短い箇条書きで提案してください。",
    "spending": "あなたは家計簿アシスタントです。支出集計データ(カテゴリ別合計)を分析し、気づいた傾向や節約のヒントを3〜5個、短い箇条書きで提案してください。",
    "habits": "あなたは習慣コーチです。習慣の記録データ(継続日数など)を分析し、改善のための具体的な工夫を3〜5個、短い箇条書きで提案してください。",
    "calendar": "あなたはスケジュールアシスタントです。今後7日間の未完了タスクのデータを見て、優先順位や詰め込みすぎていないかについて3〜5個、短い箇条書きで提案してください。",
    "goals": "あなたは目標達成コーチです。目標一覧(タイトルと進捗%)を見て、進みが良いもの・停滞していそうなものを踏まえ、次に取れる具体的で小さな一歩を3〜5個、短い箇条書きで提案してください。",
    "subscriptions": "あなたはサブスク管理アシスタントです。サブスク一覧(名前・金額・周期)を見て、重複していそうなものや見直す価値がありそうなものを3〜5個、短い箇条書きで指摘してください。",
    "assets": "あなたは資産管理アシスタントです。資産推移の記録(日付・金額)を見て、変化の傾向やペースについて気づいたことを3〜5個、短い箇条書きでコメントしてください。",
}
_FINANCIAL_KINDS = {"spending", "subscriptions", "assets"}
for _kind, _role in _ROLE_DESCRIPTIONS.items():
    registry.register(
        PromptTemplate(
            key=_kind,
            system_prompt=guards.build_system_prompt(
                _role,
                guards.NO_FABRICATION_GUARD,
                guards.JAPANESE_OUTPUT_GUARD,
                *([guards.NO_FINANCIAL_ADVICE_GUARD] if _kind in _FINANCIAL_KINDS else []),
            ),
        )
    )


# ---------------------------------------------------------------------------
# health
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"ok": True}


# ---------------------------------------------------------------------------
# 暗号化ブロブの保存/取得(旧実装と同一のエンドポイント契約)
# ---------------------------------------------------------------------------

class BlobBody(BaseModel):
    ciphertext: str | None = None
    iv: str | None = None


@app.put("/api/blobs/{anon_id}/{key}")
def put_blob(anon_id: str, key: str, body: BlobBody):
    if not body.ciphertext or not body.iv:
        raise HTTPException(status_code=400, detail="ciphertext and iv are required")
    try:
        db.put_blob(anon_id, key, body.ciphertext, body.iv)
    except Exception:
        raise HTTPException(status_code=500, detail="保存に失敗しました")
    return {"ok": True}


@app.get("/api/blobs/{anon_id}/{key}")
def get_blob(anon_id: str, key: str):
    try:
        blob = db.get_blob(anon_id, key)
    except Exception:
        raise HTTPException(status_code=500, detail="取得に失敗しました")
    if blob is None:
        raise HTTPException(status_code=404, detail="not found")
    return blob


@app.get("/api/blobs/{anon_id}")
def list_blobs(anon_id: str):
    try:
        return db.list_blob_keys(anon_id)
    except Exception:
        raise HTTPException(status_code=500, detail="一覧取得に失敗しました")


@app.delete("/api/blobs/{anon_id}/{key}")
def delete_blob(anon_id: str, key: str):
    try:
        db.delete_blob(anon_id, key)
    except Exception:
        raise HTTPException(status_code=500, detail="削除に失敗しました")
    return {"ok": True}


# ---------------------------------------------------------------------------
# AI設定(外部APIを使うかどうか)
# ---------------------------------------------------------------------------

class AiSettingsBody(BaseModel):
    allow_external_api: bool = False
    external_provider: str = "claude"


@app.get("/api/ai-settings/{anon_id}")
def get_ai_settings(anon_id: str):
    return db.get_ai_settings(anon_id)


@app.put("/api/ai-settings/{anon_id}")
def put_ai_settings(anon_id: str, body: AiSettingsBody):
    db.put_ai_settings(anon_id, body.allow_external_api, body.external_provider)
    return {"ok": True}


# ---------------------------------------------------------------------------
# AI利用可否の確認
# ---------------------------------------------------------------------------

@app.get("/api/ai/status")
async def ai_status():
    status = await llm_router.status()
    model = llm_router.local.model
    model_installed = any(m.startswith(model) for m in status["local"]["models"])
    return {
        "local": {
            "available": status["local"]["available"],
            "modelInstalled": model_installed,
            "model": model,
        },
        "external": {
            "anthropic": status["external"].get("claude", False),
            "openai": status["external"].get("openai", False),
        },
    }


# ---------------------------------------------------------------------------
# AI分析: ローカル優先、外部はオプトインのみ
# ---------------------------------------------------------------------------

class AnalyzeBody(BaseModel):
    kind: str | None = None
    payload: dict | None = None
    useExternal: bool = False
    provider: str = "claude"


@app.post("/api/ai/analyze")
async def analyze(body: AnalyzeBody):
    if body.payload is None:
        raise HTTPException(status_code=400, detail="payload is required")

    try:
        system_prompt, user_prompt = registry.render(body.kind or "", body.payload)
    except KeyError:
        system_prompt = guards.build_system_prompt(
            "以下のデータについて分析し、短くコメントしてください。", guards.JAPANESE_OUTPUT_GUARD
        )
        import json as _json

        user_prompt = _json.dumps(body.payload, ensure_ascii=False)

    settings = AiSettings(allow_external_api=body.useExternal, external_provider=body.provider)
    try:
        response = await llm_router.chat(
            [ChatMessage(role="system", content=system_prompt), ChatMessage(role="user", content=user_prompt)],
            settings=settings,
        )
    except LLMProviderError as e:
        raise HTTPException(status_code=502, detail=str(e))

    return {"text": response.content, "source": response.provider}
