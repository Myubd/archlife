# ArchLifeOS バックエンド (Vercel + Render + Neon版)

ログイン不要(匿名ID＋端末側の暗号化)で、AIは既定でローカルLLM(Qwen、Render上でCPU動作)、
必要な時だけClaude/GPTの外部APIを叩く構成です。設計の詳細は
`ArchLifeOS_設計書_Vercel-Render-Neon版.md` を参照してください。

構成:
- `server.js` — 暗号化ブロブの保存/取得APIと、AI分析の振り分け(ローカル/外部)
- `db/schema.sql` — Postgresスキーマ(匿名IDと暗号文のみ保持)
- `docker-compose.yml` — ローカル開発用(Postgres + Ollama + backend)
- `llm-service/` — Render Private Service用。CPUで動く小型Qwenモデルをホストする
- `render.yaml` — Renderのデプロイ設定(Blueprint)
- `vercel.json` — Vercelのデプロイ設定(SPAのルーティング用)
- `frontend-integration/` — 既存の`ArchLifeApp.jsx`に組み込むための暗号化ストレージ/AIクライアント

---

## 1. ローカルで動かす(これはAWS版から変更なし)

```bash
cd archlife-backend
docker compose up -d --build
```

これだけでDB + APIサーバーが起動します。**Ollama(ローカルAI)は既定では起動しません。**
AI機能(今日の提案・支出分析・習慣分析)を使いたい時だけ、以下を実行してください:

```bash
docker compose --profile ai up -d --build
docker exec -it archlife-ollama ollama pull qwen3:8b
```

動作確認:

```bash
curl http://localhost:8080/health
curl http://localhost:8080/api/ai/status
# ollamaを起動していない場合 -> {"local":{"available":false,...}}
# 起動・pull済みの場合       -> {"local":{"available":true,"modelInstalled":true,...}}
```

フロントエンドのAIタブを開くと、この`/api/ai/status`を使って「ローカルAIが今使えるか」を
自動で確認し、使えない場合は起動コマンドをその場で案内します(AIを使わないページには一切影響しません)。

---

## 2. Neonのセットアップ

1. https://neon.tech でプロジェクトを作成し、データベースを1つ作る。
2. 接続文字列(Connection String)をコピーする。`?sslmode=require` が付いた形式。
3. これを後述のRenderの環境変数 `DATABASE_URL` に設定する。
4. `db/schema.sql` の内容を、Neonのダッシュボード上のSQLエディタ、または
   `psql "<Neonの接続文字列>" -f db/schema.sql` で流し込む。

---

## 3. Renderへのデプロイ

このリポジトリには `render.yaml` (Blueprint) を用意してあるので、
Renderのダッシュボードで「New +」→「Blueprint」からこのリポジトリを選ぶだけで、
`archlife-backend`(公開APIサーバー)と `archlife-llm`(非公開のローカルLLM)の
2サービスがまとめて作成されます。

作成後、ダッシュボードで以下を設定してください(`render.yaml`で`sync: false`にしてある項目):

- `archlife-backend` の環境変数
  - `DATABASE_URL` — Neonの接続文字列
  - `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` — 外部APIを使う場合のみ。空でよい(既定はローカルLLMのみ)。

デプロイ後、`https://<your-service>.onrender.com/health` にアクセスして
`{"ok":true}` が返ることを確認してください。

**モデルサイズについて**: `llm-service/Dockerfile` は既定で `qwen3:8b` を使います。
Renderのプランを上げても速度に不満がある場合、`3b-instruct` を試すか、方針を見直して
外部APIを主体にすることも検討してください(その場合もオプトインの仕組みはそのまま使えます)。

---

## 4. Vercelへのデプロイ(フロントエンド)

1. `ArchLifeApp.jsx` を含むReactプロジェクトのリポジトリをVercelに接続する。
2. 環境変数に、Renderで作られたAPIのURL(例: `https://archlife-backend.onrender.com`)を設定する
   (例: `VITE_API_BASE_URL` など、使っているビルドツールに合わせた名前で)。
3. `frontend-integration/cryptoStorage.js` と `aiClient.js` の `apiBaseUrl` に、
   その環境変数を渡すようにする。
4. デプロイ後、VercelのURLからアプリにアクセスできる。

`vercel.json` はSPAのルーティング用(react-router等でクライアントサイドルーティングを
使う場合に必要)。単純なタブ切り替えのみ(URL遷移なし)であれば無くても動く。

---

## 5. 既存のReactアプリ(ArchLifeApp.jsx)への組み込み方

**注意:** `ArchLifeApp.jsx`の最新版では、端末スペックに応じたAI経路の自動選択
(端末内WebLLM → 自己ホストLLM → 外部API、設計書2.5章参照)が**すでに組み込み済み**です。
以下は、まだ組み込んでいない場合の手順です。

0. 端末内AIを使うため、Reactプロジェクト側で以下を追加でインストールする。
   ```bash
   npm install @mlc-ai/web-llm
   ```

1. `frontend-integration/cryptoStorage.js` と `frontend-integration/aiClient.js` を
   プロジェクトの `src/` にコピーする。

2. アプリの起動時に、匿名IDと紐づくパスフレーズをユーザーに決めてもらい(初回のみ)、
   ストレージを初期化する:

   ```js
   import { createStorage } from "./cryptoStorage";

   const storage = createStorage({
     apiBaseUrl: import.meta.env.VITE_API_BASE_URL, // Renderのバックエンドのオリジン
     passphrase: userEnteredPassphrase,
   });
   ```

3. `ArchLifeApp.jsx` 内の `window.storage.get/set/delete/list` の呼び出しを、
   上で作った `storage.get/set/delete/list` に置き換える。

4. AIタブの `callClaude(prompt)` 呼び出しは、`analyzeWithBackend` に置き換える:

   ```js
   import { analyzeWithBackend } from "./aiClient";

   const { text } = await analyzeWithBackend({
     apiBaseUrl: import.meta.env.VITE_API_BASE_URL,
     kind: "spending",
     payload: { total, byCategory },
     useExternal: false,
   });
   ```

5. **新規**: ストリークの継続判定やサブスクの更新日リマインドは、サーバーが中身を
   復号できない(設計書3章参照)ため、**アプリを開いた時にブラウザ側で**判定・表示する
   処理として実装する必要がある(復号後のデータに対してJS側で日付比較をするだけなので、
   既存の`HabitsView`/`SubscriptionsView`のコンポーネント内にロジックを足す形で対応できる)。

---

## 6. このアーキテクチャが守っているもの・守っていないもの

**守っているもの:**
- サーバーはメールアドレス等の個人情報を一切収集しない
- データは端末側で暗号化されてから送信され、サーバー(Render/Neon)は暗号文しか持たない
- AIは可能な限り端末内(WebLLM)またはRender上の自己ホストLLMで処理され、外部には出ない。外部APIは低スペック端末で明示的に同意した場合のみ使われる
- 外部API利用時も、生データではなく集計済みの数値のみを送る設計

**守っていない/注意が必要なもの:**
- パスフレーズを忘れるとデータは復元できない
- サーバー側からの「プッシュ通知」的なリマインドは(方針転換しない限り)提供できない
  (3章参照。アプリを開いた時にその場で判定・表示する形になる)
- RenderにはGPUプランがないため、ローカルLLMは小型モデル(既定1.5B)での運用になる。
  AWS版(EC2+GPU)ほどの応答品質・速度は期待しにくい
