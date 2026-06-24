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

# [0/3] 注入 BUILD_ID（git short SHA）→ src/build-id.ts
# 仅当目标内容与现有一致时跳过改写，避免重复构建污染 src tree。
# 放在 pnpm build（tsc）之前：tsc 把 build-id.ts 的 BUILD_ID 编译进 dist → ncc 内联进 bundle。
BUILD_ID="$(git rev-parse --short HEAD 2>/dev/null || echo dev)"
BUILD_ID_FILE="src/build-id.ts"
# 单引号风格与 src/build-id.ts 占位保持一致（项目惯例），shell 用双引号包裹整体 + 内部单引号字面量。
DESIRED="export const BUILD_ID = '${BUILD_ID}';"
if [[ -f "$BUILD_ID_FILE" ]] && [[ "$(cat "$BUILD_ID_FILE")" == "$DESIRED" ]]; then
  echo "==> [0/3] BUILD_ID=${BUILD_ID} unchanged, skip rewrite"
else
  echo "==> [0/3] Writing BUILD_ID=${BUILD_ID} -> ${BUILD_ID_FILE}"
  printf '%s\n' "$DESIRED" > "$BUILD_ID_FILE"
fi

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
