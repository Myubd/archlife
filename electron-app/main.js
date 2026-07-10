const { app, BrowserWindow, dialog } = require("electron");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

// パッケージ後は resourcesPath 配下に archlife-fastapi(PyInstallerでexe化済み) /
// archlife-frontend/dist を同梱している。
// 開発時(electron .)はリポジトリ直下を参照する。
const resourcesRoot = app.isPackaged ? process.resourcesPath : path.join(__dirname, "..");
const backendExe = app.isPackaged
  ? path.join(resourcesRoot, "archlife-fastapi", "launch_fastapi.exe")
  : null; // 開発時はexe化されていないので、後述のとおり別途 uvicorn を手動起動しておく
const frontendIndexHtml = path.join(resourcesRoot, "archlife-frontend", "dist", "index.html");
// [要確認] packaged版はここを file:// プロトコルで読み込むため、
// レンダラーからのfetchのOriginは "file://" または送信されない(null)になる。
// archlife-fastapi 側のCORS設定が http://localhost:5173 しか許可していない場合、
// 本番ビルドでAPIが全て弾かれるので、file://起源も許可するよう修正すること。

// [追加] 開発時はViteのdevサーバーを見る(ホットリロードを効かせるため)。
// distを都度ビルドし直さなくても、フロントの変更がすぐ反映される。
// 「本番相当の見た目で確認したい」場合は、代わりに frontendIndexHtml をloadFileしてください。
const FRONTEND_DEV_URL = "http://localhost:5173";

let mainWindow;
let backendProcess = null;

function waitForHealth(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve();
        retry();
      });
      req.on("error", retry);
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error("バックエンドの起動確認がタイムアウトしました"));
        return;
      }
      setTimeout(attempt, 300);
    };
    attempt();
  });
}

async function startBackend() {
  process.env.PORT = process.env.PORT || "8080";
  // ユーザーごとのデータ保存先。旧Node版の DATA_DIR と同じ考え方を踏襲し、
  // launch_fastapi.py 側がこの中に archlife.db を作る。
  process.env.DATA_DIR = app.getPath("userData");

  if (app.isPackaged) {
    // [変更] 旧Node版は require("server.js") で同一プロセス内にバックエンドを
    // 読み込んでいたが、FastAPI(Python)は別ランタイムのため同じことはできない。
    // そのため child_process.spawn で独立プロセスとして起動する。
    backendProcess = spawn(backendExe, [], {
      env: { ...process.env },
      windowsHide: true,
    });

    backendProcess.stdout.on("data", (data) => {
      console.log(`[backend] ${data}`.trimEnd());
    });
    backendProcess.stderr.on("data", (data) => {
      console.error(`[backend] ${data}`.trimEnd());
    });
    backendProcess.on("exit", (code) => {
      console.log(`[backend] exited with code ${code}`);
    });
    // [追加] exeのパス違い・権限不足などでspawn自体が失敗した場合、
    // "exit"ではなく"error"しか飛んでこないことがある。
    // これを拾わないと、原因不明のままヘルスチェックのタイムアウト
    // (15秒後の汎用エラー)にしかならないため、明示的に拾って再送出する。
    backendProcess.on("error", (err) => {
      console.error(`[backend] failed to start: ${err.message}`);
    });
  } else {
    // [開発時] exe化されていないため、事前に別ウィンドウで
    //   cd archlife-fastapi
    //   uvicorn main:app --host 0.0.0.0 --port 8080
    // を起動しておくこと。ここではヘルスチェックの待受のみ行う。
    console.log("[dev] 開発モードのため、archlife-fastapiは別途手動起動しておいてください。");
  }

  await waitForHealth(`http://localhost:${process.env.PORT}/health`, 15000);
}

function stopBackend() {
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
    backendProcess = null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: "ArchLifeOS",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);

  if (app.isPackaged) {
    return mainWindow.loadFile(frontendIndexHtml);
  }
  // [変更] 開発時はdistの都度ビルドを不要にするため、Viteのdevサーバーを見る。
  // `cd archlife-frontend && npm run dev` を別途起動しておくこと。
  return mainWindow.loadURL(FRONTEND_DEV_URL);
}

app.whenReady().then(async () => {
  try {
    await startBackend();
  } catch (err) {
    dialog.showErrorBox(
      "ArchLifeOS",
      "バックエンドの起動に失敗しました。\n" + (err && err.message ? err.message : String(err))
    );
    stopBackend();
    app.quit();
    return;
  }

  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  stopBackend();
  if (process.platform !== "darwin") app.quit();
});

// [追加] spawnした子プロセスがElectron終了後も残り続けないようにする
app.on("before-quit", () => {
  stopBackend();
});

process.on("exit", () => {
  stopBackend();
});
