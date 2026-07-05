// DATABASE_URL が設定されていれば Postgres(Render/Neon等のクラウド用)、
// 設定されていなければ SQLite(ローカル実行 / デスクトップ版 Electron 用)を使う。
// どちらも同じ関数群 (putBlob / getBlob / listBlobs / deleteBlob / getAiSettings / setAiSettings)
// を export するので、server.js 側はどちらのDBかを意識しなくてよい。

const usePostgres = !!process.env.DATABASE_URL;

module.exports = usePostgres ? require("./postgres") : require("./sqlite");
