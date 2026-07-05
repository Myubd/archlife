# ArchLifeOS フロントエンド (Vite + React)

`archlife-backend` (Vercel/Render/Neon版) と組み合わせて動かす、実際にビルド・デプロイ可能な
フロントエンドのプロジェクト一式です。中身の `src/ArchLifeApp.jsx` は既存のものをそのまま使っており、
ロジックの変更は「APIのURLを環境変数から読むようにした」1点だけです。

## 構成

- `src/ArchLifeApp.jsx` — 全機能を含むメインコンポーネント(既存のものと同一、`API_BASE_URL`のみ環境変数対応)
- `src/main.jsx` — Reactのエントリーポイント
- `index.html` / `vite.config.js` — Viteの雛形
- `.env.example` — バックエンドAPIのURLを設定する環境変数のサンプル
- `vercel.json` — VercelでSPAとしてルーティングするための設定

## ローカルで動かす

```bash
npm install
cp .env.example .env.local   # 中身をローカルのbackend URL(例: http://localhost:8080)に変更
npm run dev
```

`archlife-backend` 側を先に `docker compose up -d --build` で起動しておくこと。

## Vercelへのデプロイ

1. このディレクトリをGitリポジトリのルート(またはmonorepoの1パッケージ)としてVercelに接続する。
2. Vercelのプロジェクト設定 → Environment Variables に `VITE_API_BASE_URL` を追加し、
   Renderにデプロイした `archlife-backend` のURL(例: `https://archlife-backend.onrender.com`)を設定する。
3. Build Command: `npm run build` / Output Directory: `dist`(Viteプロジェクトなら自動検出される)。
4. デプロイ後、初回アクセス時にパスフレーズの入力を求められる(端末側暗号化のため)。

## 端末内AI(WebLLM)について

`@mlc-ai/web-llm` を依存関係に追加済み。WebGPU対応・非モバイル・十分なスペックの端末では、
サーバーを介さず端末内でモデルを動かす経路が自動選択される(`ArchLifeApp.jsx` 内のロジック参照)。
初回ロード時にモデルダウンロードが走るため、低スペック端末やモバイルでは自動的にバックエンド
(ローカルLLM/外部API)経路にフォールバックする設計になっている。

## 既存ファイルとの関係

- `archlife-backend/frontend-integration/cryptoStorage.js` と `aiClient.js` は、
  暗号化ストレージ・AI呼び出しのロジックを**別ファイルとして組み込む場合の参考実装**として
  引き続き残しています。ただし `ArchLifeApp.jsx` にはすでに同等のロジックが直接組み込まれているため、
  このプロジェクトをそのまま使う分には追加の作業は不要です。
