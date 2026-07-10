# -*- mode: python ; coding: utf-8 -*-
import os
from PyInstaller.utils.hooks import copy_metadata, collect_all

datas_meta = []
for pkg in [
    'fastapi', 'uvicorn', 'starlette', 'pydantic', 'anyio', 'httpx', 'cryptography',
]:
    try:
        datas_meta += copy_metadata(pkg)
    except Exception:
        pass

# [修正] local_ai_core が依存する外部パッケージ(httpx, cryptography)は、
# collect_all('local_ai_core') だけでは検出されない
# ("ModuleNotFoundError: No module named 'httpx'")。
# local_ai_core と同様に、依存パッケージ自体も明示的に collect_all する。
local_ai_core_datas, local_ai_core_binaries, local_ai_core_hiddenimports = collect_all('local_ai_core')
httpx_datas, httpx_binaries, httpx_hiddenimports = collect_all('httpx')
cryptography_datas, cryptography_binaries, cryptography_hiddenimports = collect_all('cryptography')

a = Analysis(
    ['launch_fastapi.py'],
    pathex=[],
    binaries=local_ai_core_binaries + httpx_binaries + cryptography_binaries,
    datas=datas_meta + local_ai_core_datas + httpx_datas + cryptography_datas + [
        ('main.py', '.'),
        ('db.py', '.'),
        # フロントエンドはElectronのBrowserWindowが直接loadFileするため、
        # interview_appとは異なりこのexeには同梱しない。
    ],
    hiddenimports=[
        'uvicorn', 'uvicorn.logging', 'uvicorn.loops', 'uvicorn.loops.auto',
        'uvicorn.protocols', 'uvicorn.protocols.http', 'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets', 'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan', 'uvicorn.lifespan.on',
        'fastapi', 'starlette',
        'anyio', 'anyio._backends._asyncio',
        'main', 'db',
    ] + local_ai_core_hiddenimports + httpx_hiddenimports + cryptography_hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='launch_fastapi',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    icon=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='launch_fastapi',
)
