#!/usr/bin/env bash
#
# build-bundle.sh —— 把 sillyhub-daemon 打成单文件 ncc bundle。
#
# 步骤：
#   1. tsc 编译 src/ → dist/（生成 ESM .js + .d.ts）
#   2. ncc 把 dist/cli.js 及其依赖（含 claude-agent-sdk 原生包）内联成
#      build/bundle/index.js（单文件，零依赖，仅依赖 node runtime）
#   3. 复制为 build/bundle/sillyhub-daemon.js（install.sh 下载此文件名）
#
# 产物：
#   build/bundle/index.js            —— ncc 原始输出
#   build/bundle/sillyhub-daemon.js  —— 同上，重命名为发布用文件名
#
# 验证：
#   node build/bundle/index.js --version
#   node build/bundle/index.js --help
#
set -euo pipefail

# 切到 sillyhub-daemon 根目录（scripts/ 的上一级）。
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

echo "==> [1/3] Building TypeScript (pnpm build)"
pnpm build

echo "==> [2/3] Bundling with ncc → build/bundle/index.js"
# --no-source-map-register：不注入 source-map-support（减小体积，错误栈仍可用）
# 不加 --minify：保留可读性，单文件已够小（~1.6MB），便于线上排查
rm -rf build/bundle
pnpm exec ncc build dist/cli.js -o build/bundle --no-source-map-register

# ncc 输出固定为 index.js。复制为发布用文件名 sillyhub-daemon.js，
# install.sh / nginx 托管都用这个名字。
echo "==> [3/3] Renaming index.js → sillyhub-daemon.js"
cp build/bundle/index.js build/bundle/sillyhub-daemon.js

echo ""
echo "✅ Bundle ready:"
echo "   build/bundle/index.js"
echo "   build/bundle/sillyhub-daemon.js"
echo ""
echo "Verify:  node build/bundle/sillyhub-daemon.js --version"
