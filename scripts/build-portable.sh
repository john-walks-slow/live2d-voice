#!/usr/bin/env bash
# Build a portable live2d-voice bundle: node runtime + launcher app + preinstalled data.
# Usage: scripts/build-portable.sh [win-x64|linux-x64|linux-arm64|darwin-arm64|darwin-x64]
# Must run on the target platform — native profile deps install per-platform.
set -euo pipefail

NODE_VER=22.23.3
PLAT="${1:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VER="$(cd "$ROOT" && node -p "require('./package.json').version")"

if [ -z "$PLAT" ]; then
	case "$(uname -s)/$(uname -m)" in
		Linux/aarch64) PLAT=linux-arm64 ;;
		Linux/x86_64) PLAT=linux-x64 ;;
		Darwin/arm64) PLAT=darwin-arm64 ;;
		Darwin/x86_64) PLAT=darwin-x64 ;;
		MINGW*/*64) PLAT=win-x64 ;;
		*) echo "未知主机，请显式传平台参数 unknown host — pass platform explicitly" >&2; exit 1 ;;
	esac
fi

OUT_DIR="$ROOT/dist"
STAGE="$ROOT/.build/live2d-voice-$VER-$PLAT"
rm -rf "$STAGE"
mkdir -p "$STAGE" "$OUT_DIR"

echo "==> [1/5] node runtime v$NODE_VER ($PLAT)"
if [ "$PLAT" = "win-x64" ]; then
	DIST="node-v$NODE_VER-win-x64.zip"
	curl -fL "https://nodejs.org/dist/v$NODE_VER/$DIST" -o "$STAGE/$DIST"
	if command -v unzip >/dev/null 2>&1; then
		unzip -q "$STAGE/$DIST" -d "$STAGE"
	else
		powershell -NoProfile -Command "Expand-Archive -Force '$DIST' '.'"
	fi
	mv "$STAGE/node-v$NODE_VER-win-x64" "$STAGE/runtime"
	rm -f "$STAGE/$DIST"
else
	DIST="node-v$NODE_VER-$PLAT.tar.xz"
	curl -fL "https://nodejs.org/dist/v$NODE_VER/$DIST" -o "$STAGE/$DIST"
	tar -xJf "$STAGE/$DIST" -C "$STAGE"
	mv "$STAGE/node-v$NODE_VER-$PLAT" "$STAGE/runtime"
	rm -f "$STAGE/$DIST"
fi

echo "==> [2/5] launcher app (preinstalled)"
mkdir -p "$STAGE/app"
# Explicit copy list — never walk the whole repo: staging (.build) and dist/
# live under ROOT and a wildcard copy would recurse into the bundle itself.
(cd "$ROOT" && cp -a bin.mjs package.json package-lock.json README.md LICENSE node_modules "$STAGE/app/")

echo "==> [3/5] data home (scaffold + profile deps)"
node "$STAGE/app/bin.mjs" --home "$STAGE/data" --prepare

echo "==> [4/5] start scripts + README"
cat > "$STAGE/start.sh" <<'EOF'
#!/bin/sh
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/runtime/bin/node" "$DIR/app/bin.mjs" --home "$DIR/data" "$@"
EOF
chmod +x "$STAGE/start.sh"

cat > "$STAGE/start.command" <<'EOF'
#!/bin/sh
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/runtime/bin/node" "$DIR/app/bin.mjs" --home "$DIR/data" "$@"
EOF
chmod +x "$STAGE/start.command"

printf '@echo off\r\nset "DIR=%%~dp0"\r\n"%%DIR%%runtime\\node.exe" "%%DIR%%app\\bin.mjs" --home "%%DIR%%data" %%*\r\npause\r\n' > "$STAGE/start.bat"

cat > "$STAGE/README.txt" <<EOF
Live2D 语音伴侣 v$VER（便携版）
================================

启动：
  Windows  双击 start.bat
  macOS    双击 start.command（首次如被拦：系统设置 → 隐私与安全性 → 仍要打开）
  Linux    ./start.sh

首次启动约 10–30 秒后自动打开浏览器。

配置 API key（聊天必需）：
  编辑 data/.env，填入 LIVE2D_VOICE_API_KEY=sk-...（https://platform.deepseek.com/）

放入 Live2D 模型：
  把模型文件夹（含 .model3.json）放进 data/models/，页面 ⚙ 里选择。

完全卸载：删除整个文件夹即可（所有数据都在这里）。
详细文档：https://github.com/john-walks-slow/live2d-voice#readme
EOF

echo "==> [5/5] archive"
if [ "$PLAT" = "win-x64" ]; then
	(cd "$ROOT/.build" && powershell -NoProfile -Command "Compress-Archive -Path 'live2d-voice-$VER-$PLAT' -DestinationPath 'live2d-voice-$VER-$PLAT.zip' -Force" 2>/dev/null)
	mv "$ROOT/.build/live2d-voice-$VER-$PLAT.zip" "$OUT_DIR/"
	OUT="$OUT_DIR/live2d-voice-$VER-$PLAT.zip"
else
	tar -czf "$OUT_DIR/live2d-voice-$VER-$PLAT.tar.gz" -C "$ROOT/.build" "live2d-voice-$VER-$PLAT"
	OUT="$OUT_DIR/live2d-voice-$VER-$PLAT.tar.gz"
fi

echo "==> done: $OUT ($(du -h "$OUT" | cut -f1))"
