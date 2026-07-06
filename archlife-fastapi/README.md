# ArchLifeOS backend (FastAPI版)

旧 `archlife-backend/server.js`(Node/Express + Postgres/Neon)を、
`local-ai-core`共通コアを使ったFastAPI + SQLiteに移植したもの。

「プライバイシーファーストなローカルAIエコシステム」共通化設計書のPhase 1後半に対応。

## 旧実装からの変更点

| 項目 | 旧(server.js) | 新(main.py) |
|---|---|---|
| Webフレームワーク | Express | FastAPI |
| DB | PostgreSQL(Neon/docker-compose) | SQLite(ローカルファイル) |
| AI呼び出し | `callLocalQwen`/`callClaude`/`callOpenAI`を自前実装 | `local_ai_core.llm`(interview_appと共通) |
| ローカルLLM呼び出し方式 | `/api/generate`(単発プロンプト) | `/api/chat`(system+userメッセージ、`local_ai_core`経由) |
| プロンプトテンプレート | `buildPrompt()`に直書き | `local_ai_core.prompts.PromptRegistry`に登録(interview_appと共通の仕組み) |

**エンドポイントの契約(パス・リクエスト/レスポンス形式)は完全互換**にしてあるため、
既存のフロントエンド(cryptoStorage.js等)は無改修で動く想定。

## 起動方法

```bash
pip install -r requirements.txt

# 環境変数(すべて任意、指定しなければローカルOllama+デフォルトモデルを使う)
set OLLAMA_URL=http://localhost:11434
set OLLAMA_MODEL=qwen3:8b
set ARCHLIFE_DB_PATH=archlife.db
set ANTHROPIC_API_KEY=...   # 外部APIをオプトインで使う場合のみ
set OPENAI_API_KEY=...      # 同上

uvicorn main:app --host 0.0.0.0 --port 8080
```

フロントエンド側の接続先URL(`VITE_API_BASE`等)を、このFastAPIサーバーのポートに向ける。

## 動作確認済みの範囲(このサンドボックスでの検証)

ネットワーク制限のため実際のOllama/FastAPIプロセスは起動していないが、以下は
**実際のコード(main.py・db.py)を直接インポートして実行**し、正しく動くことを確認した。

- `db.py`: blob CRUD(保存・取得・上書き・一覧・削除)、ai_settings の取得・更新
- AI分析ロジック(`registry.render` → `guards.build_system_prompt` → `llm_router.chat`):
  疑似Ollamaサーバーに対して実際に呼び出し、`{"text":..., "source": "local"}` を確認
- AI利用可否ロジック(`llm_router.status()` → status レスポンス整形):
  `modelInstalled` 判定やexternal(anthropic/openai)可否判定が正しく動くことを確認

FastAPI自体(ルーティングのデコレータ部分)は、このサンドボックスに`fastapi`パッケージを
インストールできなかったため、`ast.parse`による構文チェックのみ。実機で
`uvicorn main:app`を起動して、`GET /health`と`GET /api/ai/status`が返ることを
最初に確認することを推奨する。

## 次のステップ(このリポジトリのスコープ外)

- `anon_id`をこのエコシステム共通の`local_ai_core.identity.DeviceIdentity`に統合する(Phase 3)
- `blobs`テーブルと、共通データ基盤の`schedule_items`/`knowledge_items`との関係を整理する
- Dockerfile / docker-compose.yml の更新(Postgresコンテナが不要になったため)
