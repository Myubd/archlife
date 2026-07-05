const { app, BrowserWindow, dialog } = require("electron");
const path = require("path");
const http = require("http");

// パッケージ後は resourcesPath 配下に archlife-backend / archlife-frontend/dist を同梱している。
// 開発時(electron .)はリポジトリ直下を参照する。
const resourcesRoot = app.isPackaged ? process.resourcesPath : path.join(__dirname, "..");
const backendDir = path.join(resourcesRoot, "archlife-backend");
const frontendIndexHtml = path.join(resourcesRoot, "archlife-frontend", "dist", "index.html");

let mainWindow;

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
  // ユーザーごとのデータ保存先。DATABASE_URL は意図的に設定しないことで
  // db/index.js が自動的に SQLite モードを選ぶ(Docker/Postgres不要)。
  process.env.DATA_DIR = app.getPath("userData");

  // server.js はrequireされた時点で app.listen() まで実行する作りなので、
  // requireするだけでバックエンドが起動する。
  require(path.join(backendDir, "server.js"));

  await waitForHealth(`http://localhost:${process.env.PORT}/health`, 15000);
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
  return mainWindow.loadFile(frontendIndexHtml);
}

app.whenReady().then(async () => {
  try {
    await startBackend();
  } catch (err) {
    dialog.showErrorBox(
      "ArchLifeOS",
      "バックエンドの起動に失敗しました。\n" + (err && err.message ? err.message : String(err))
    );
    app.quit();
    return;
  }

  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
