"""
launch_fastapi.py
------------------
ArchLifeOS backend (FastAPI版) の Electron 向けランチャー。

PyInstaller でビルドされた exe から、Electron の main.js が
子プロセスとして起動することを想定している。

Node版(archlife-backend)の main.js は `require("server.js")` で
同一プロセス内にバックエンドを読み込んでいたが、FastAPI(Python)は
別ランタイムなので同じことはできない。そのため、この exe は
Electron から `child_process.spawn()` される独立プロセスとして動く。

Electron側(main.js)との約束事:
  - 環境変数 PORT: 待ち受けポート(既定 8080)
  - 環境変数 DATA_DIR: ユーザーデータ保存先ディレクトリ
    (app.getPath("userData")。この中に archlife.db を作る)
  - 起動完了は GET /health のポーリングで判定される(Node版と同じ)
"""
from __future__ import annotations

import io
import os
import socket
import subprocess
import sys
import time


def _fix_stdio() -> None:
    """PyInstaller の console=False ビルドでは sys.stdout/stderr が None になる。
    uvicornのデフォルトログ設定は stdout.isatty() を呼び出すため、None のままだと
    'AttributeError: NoneType has no attribute isatty' や
    'ValueError: Unable to configure formatter default' で起動直後に落ちる。
    devnull に書き込むダミーのストリームで置き換えて回避する。
    (interview_appのlaunch_fastapi.pyと同じ対策)
    """
    if sys.stdout is None:
        sys.stdout = io.TextIOWrapper(open(os.devnull, "wb"), encoding="utf-8", errors="replace")
    if sys.stderr is None:
        sys.stderr = io.TextIOWrapper(open(os.devnull, "wb"), encoding="utf-8", errors="replace")


def _suppress_child_console() -> None:
    """Windows で万一サブプロセスを生成する場合に、コンソールウィンドウが
    余分に表示されないようにする(interview_appと同じ対策)。"""
    if sys.platform != "win32":
        return
    try:
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startupinfo.wShowWindow = 0
        subprocess._default_startupinfo = startupinfo  # type: ignore[attr-defined]
    except Exception:
        pass


def _kill_existing_process(port: int) -> None:
    """指定ポートを使っている古いプロセスを終了する(前回終了し損ねた場合の保険)。"""
    my_pid = os.getpid()
    try:
        result = subprocess.run(["netstat", "-ano"], capture_output=True, text=True)
        target_pids: set[int] = set()
        for line in result.stdout.splitlines():
            if f":{port} " in line and "LISTENING" in line:
                parts = line.split()
                if not parts:
                    continue
                try:
                    pid = int(parts[-1])
                except ValueError:
                    continue
                if pid in (0, my_pid):
                    continue
                target_pids.add(pid)
        for pid in target_pids:
            subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)
    except Exception:
        pass


def _wait_for_port_free(port: int, timeout: float = 5.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(0.1)
                if s.connect_ex(("127.0.0.1", port)) != 0:
                    return
        except Exception:
            return
        time.sleep(0.1)


def main() -> None:
    _fix_stdio()
    _suppress_child_console()

    port = int(os.environ.get("PORT", "8080"))
    data_dir = os.environ.get("DATA_DIR") or os.path.join(os.path.expanduser("~"), ".archlifeos")
    os.makedirs(data_dir, exist_ok=True)

    # main.py が読む環境変数を、Electronが渡すDATA_DIRから組み立てる
    os.environ["ARCHLIFE_DB_PATH"] = os.path.join(data_dir, "archlife.db")
    # ローカルOllamaは既定のhttp://localhost:11434のまま(Node版と同じ前提)

    _kill_existing_process(port)
    _wait_for_port_free(port)

    print(f"[archlife-fastapi] starting on 127.0.0.1:{port}", flush=True)
    print(f"[archlife-fastapi] db path: {os.environ['ARCHLIFE_DB_PATH']}", flush=True)

    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=port, log_level="warning", loop="asyncio")


if __name__ == "__main__":
    main()
