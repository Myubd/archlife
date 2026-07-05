# ArchLifeOS 起動方法 & デプロイ確認メモ

今回の作業内容: (1) デプロイ手順の検証(実際にバックエンドを動かして確認)、(2) ストリーク/サブスクの
リマインドをブラウザ側で表示する機能の実装。この2点の結果と、実際の起動方法をまとめています。

---

## 1. 見つかった不具合と修正

`server.js` の `callLocalQwen` が `OLLAMA_URL` をそのまま使っていましたが、
`render.yaml` では `fromService: property: hostport` で値を注入しており、これは
`archlife-llm:11434` のような **スキーム(`http://`)無しの `host:port` 形式**です。
このままだと本番(Render)環境でAI分析(ローカルLLM)が動かない可能性がありました。

**修正**: `OLLAMA_URL` にスキームが無ければ自動で `http://` を補う `normalizeOllamaBase()` を追加。
ローカル(`docker-compose.yml`。もとから`http://ollama:11434`とスキーム付き)・Render(スキーム無し)の
どちらでも動くようにしました。

実際に以下を確認済みです(このチャット上でサーバーを起動してcurlでテスト):
- `GET /health` → `{"ok":true}`
- `PUT /api/blobs/...`(DB未接続時)→ クラッシュせず `500` を返す
- `POST /api/ai/analyze`(Ollama未接続時)→ クラッシュせず `502` を返す
- `OLLAMA_URL=archlife-llm:11434`(スキーム無し)を渡しても、内部で `http://archlife-llm:11434/...` に
  正しく変換されることを確認

`docker-compose.yml` / `render.yaml` / `package.json` / `vercel.json` は文法エラーが無いことも確認済みです
(実際のDocker起動そのものはこの環境からは実行できないため、Render/ローカルDockerでの最終確認は引き続き推奨します)。

---

## 2. 追加したリマインド機能

`archlife-frontend/src/ArchLifeApp.jsx` に `ReminderBanner` を追加しました。
アプリを開くと、メイン画面の上部に以下がある場合だけバナーが表示されます:

- **習慣**: 連続記録(ストリーク)が1日以上あるのに、今日はまだチェックしていない習慣
  → 「⚠️ ○○ が今日まだ未達成です(連続n日が途切れます)」
- **サブスク**: 次回請求日が今日から3日以内のもの
  → 「💳 ○○ の次回請求日が近づいています(MM/DD)」

該当が無ければ何も表示されません。バナーは×で閉じられます(閉じた状態はそのセッション中のみ有効。
次回アプリを開いた時にはまた表示されます)。

サーバー側は暗号文しか持たず中身を復号できないため、この判定は**常に端末側(ブラウザ)** で行う設計です
(設計書5章の方針通り)。

---

## 3. 起動方法

### 3-1. ローカルで一式動かす(バックエンド + DB + ローカルLLM)

```bash
cd archlife-backend
docker compose up -d --build
docker exec -it archlife-ollama ollama pull qwen3:8b
```

確認:
```bash
curl http://localhost:8080/health
# => {"ok":true}
```

### 3-2. フロントエンドをローカルで動かす

```bash
cd archlife-frontend
npm install
cp .env.example .env.local
# .env.local の VITE_API_BASE_URL を http://localhost:8080 のままにする(ローカルバックエンド用)
npm run dev
```

ブラウザで `http://localhost:5173` を開く。初回はパスフレーズの入力を求められます
(忘れると復元できないので注意)。

### 3-3. 本番デプロイ(Render + Neon + Vercel)

1. **Neon**: プロジェクト作成 → 接続文字列を控える → `db/schema.sql` を流し込む
2. **Render**: `archlife-backend` リポジトリを Blueprint (`render.yaml`) で読み込む
   → ダッシュボードで `DATABASE_URL`(Neonの接続文字列)を設定
   → デプロイ後 `https://<service>.onrender.com/health` が `{"ok":true}` を返すことを確認
3. **Vercel**: `archlife-frontend` リポジトリを接続 → 環境変数 `VITE_API_BASE_URL` に
   Renderの`archlife-backend`のURLを設定 → デプロイ

---

## 次にできそうなこと

- サブスク検知(3日以内)としきい値をユーザーが設定できるようにする
- リマインドの既読状態を(暗号化した上で)サーバー側にも保存し、他端末でも既読を共有する
- AI分析(支出分析・習慣分析)のプロンプト精度の調整
