# ArchLifeOS

## フォルダ構成

```
archlife-project/
├── start-all.bat     ← これをダブルクリックで起動(DB + API + フロント。AIなし)
├── start-ai.bat      ← ローカルAI(Ollama)を使いたい時だけ実行
├── stop-all.bat      ← 全部停止
├── archlife-backend/ ← APIサーバー・DB・Ollama(docker-compose)
└── archlife-frontend/← React(Vite)フロントエンド
```

## 使い方(Windows)

1. **前提**: [Docker Desktop](https://www.docker.com/products/docker-desktop/) と
   [Node.js](https://nodejs.org/)(LTS版)を先にインストールし、Docker Desktopを起動しておく。
2. `start-all.bat` をダブルクリック。
   - DBとAPIサーバーが起動し、`http://localhost:8080/health` の応答を確認します。
   - 続けて新しいウィンドウでフロントエンドが起動します(初回は`npm install`が自動実行されるため
     数分かかることがあります)。
   - フロントエンドのウィンドウに表示されるURL(通常 `http://localhost:5173`)をブラウザで開く。
3. AI機能(今日の提案・支出分析・習慣分析)を使いたくなったら `start-ai.bat` を実行。
   - 初回はOllamaのイメージ取得・モデルのダウンロードで時間がかかります。
4. 終わったら `stop-all.bat` でコンテナを停止(フロントエンドのウィンドウは手動で閉じてください)。

## トラブルシューティング

- `start-all.bat`で「docker コマンドが見つかりません」→ Docker Desktopをインストール/起動してください。
- ヘルスチェックが警告のまま進む → `archlife-backend`フォルダで `docker compose logs -f` を実行してログを確認。
- ポートが使用中でエラーになる → 8080番(API)・5432番(Postgres)・5173番(フロント)・11434番(Ollama、AI利用時のみ)
  を他のアプリが使っていないか確認してください。

## Mac/Linuxの場合

`.bat`はWindows専用です。Mac/Linuxでは各READMEに書いてある通り、コマンドを直接実行してください:

```bash
cd archlife-backend && docker compose up -d --build
cd ../archlife-frontend && npm install && npm run dev
```

AIを使う場合は `docker compose --profile ai up -d --build` を追加で実行してください。
