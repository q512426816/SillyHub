#!/usr/bin/env bash
#
# install.sh —— SillyHub daemon 一键安装脚本。
#
# 用法（用户侧）：
#   curl -fsSL <SERVER>/daemon/install.sh | bash
#   curl -fsSL <SERVER>/daemon/install.sh | bash -s -- --server <url> --api-key <key>
#
# 功能：
#   1. 检测 node >= 20（缺失则提示安装 nvm/node）
#   2. 拉取 <SERVER>/daemon/latest.json 获取最新版本号 + 下载 URL
#   3. 下载 sillyhub-daemon.js 到 ~/.sillyhub/daemon/bin/
#   4. 创建 wrapper ~/.sillyhub/daemon/bin/sillyhub-daemon（node "$DIR/sillyhub-daemon.js" "$@"）
#   5. 尝试把 bin 目录加进 PATH（写 .bashrc/.zshrc，幂等）
#   6. 验证 sillyhub-daemon --version
#   7. 若传了 --server/--api-key/--token，装完直接 sillyhub-daemon start
#
# SERVER_URL 推导（优先级从高到低，不硬编码 IP）：
#   a. 命令行 --server-url <url>
#   b. 环境变量 SILLYHUB_SERVER_URL
#   c. 内置默认（可被 SILLYHUB_SERVER_URL 覆盖）
#
set -euo pipefail

# ── 默认值 / 颜色 ────────────────────────────────────────────────────────────
DEFAULT_SERVER_URL="${SILLYHUB_SERVER_URL:-http://127.0.0.1:8001}"
INSTALL_DIR="${HOME}/.sillyhub/daemon"
BIN_DIR="${INSTALL_DIR}/bin"
BUNDLE_NAME="sillyhub-daemon.js"
WRAPPER_NAME="sillyhub-daemon"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()  { printf "${BLUE}[info]${NC}  %s\n"  "$*"; }
ok()    { printf "${GREEN}[ok]${NC}    %s\n"  "$*"; }
warn()  { printf "${YELLOW}[warn]${NC}  %s\n"  "$*"; }
die()   { printf "${RED}[error]${NC} %s\n" "$*" >&2; exit 1; }

# ── 参数解析 ──────────────────────────────────────────────────────────────────
SERVER_URL=""
START_SERVER=""
START_API_KEY=""
START_TOKEN=""
AUTO_START=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server-url) SERVER_URL="$2"; shift 2;;
    --server)     START_SERVER="$2"; AUTO_START=1; shift 2;;
    --api-key)    START_API_KEY="$2"; AUTO_START=1; shift 2;;
    --token)      START_TOKEN="$2"; AUTO_START=1; shift 2;;
    --start)      AUTO_START=1; shift;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0;;
    *) die "未知参数: $1（用 --help 查看用法）";;
  esac
done

# SERVER_URL 推导
if [[ -z "$SERVER_URL" ]]; then
  SERVER_URL="$DEFAULT_SERVER_URL"
fi
# 去掉末尾斜杠
SERVER_URL="${SERVER_URL%/}"
info "使用服务端地址: $SERVER_URL"

# ── 1. 检测 node >= 20 ────────────────────────────────────────────────────────
# Windows（Git Bash / WSL）下 bash 的 PATH 可能不包含 nvm4w / Program Files 的
# node。尝试通过常见路径 + cmd.exe where 探测，找到后导出为 NODE_BIN 供后续使用。
NODE_BIN=""
check_node() {
  # 1a. 标准 PATH 查找
  if command -v node >/dev/null 2>&1; then
    NODE_BIN="$(command -v node)"
  fi

  # 1b. Windows 兜底：Git Bash 的 PATH 不含 nvm4w / Program Files
  if [[ -z "$NODE_BIN" ]] && [[ -n "${OS:-}" && "${OS}" == "Windows_NT" ]]; then
    info "检测到 Windows 环境，尝试探测 node 路径..."
    # 用 cmd.exe where 查（Git Bash 能调 cmd.exe）
    local win_node
    win_node="$(cmd.exe /c "where node" 2>/dev/null | tr -d '\r' | head -n1)"
    if [[ -n "$win_node" ]]; then
      # 转成 Unix 路径（Git Bash 的 cd 能识别 /c/... 格式）
      win_node="${win_node//\\//}"           # 反斜杠 → 正斜杠
      win_node="${win_node/C:/\/c}"           # C:\... → /c/...
      win_node="${win_node//\//:}"            # 其余盘符冒号处理
      if [[ -x "$win_node" || -f "$win_node" ]]; then
        NODE_BIN="$win_node"
        info "找到 node（Windows）: $NODE_BIN"
      fi
    fi
    # 1c. 常见安装路径直查
    if [[ -z "$NODE_BIN" ]]; then
      local candidates=(
        "/c/nvm4w/nodejs/node.exe"
        "/c/Program Files/nodejs/node.exe"
        "/c/Program Files (x86)/nodejs/node.exe"
      )
      for p in "${candidates[@]}"; do
        if [[ -f "$p" ]]; then
          NODE_BIN="$p"
          info "找到 node（路径探测）: $NODE_BIN"
          break
        fi
      done
    fi
  fi

  if [[ -z "$NODE_BIN" ]]; then
    warn "未检测到 node。请先安装 Node.js >= 20："
    echo  "  方式一（nvm-windows）: https://github.com/coreybutler/nvm-windows/releases"
    echo  "  方式二（官方）:        https://nodejs.org/en/download"
    die "缺少 node，安装中止。装好 node 后重新运行本脚本。"
  fi

  local major
  major="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [[ "$major" -lt 20 ]]; then
    die "node 版本过低 (v$("$NODE_BIN" -v))，需要 >= 20。"
  fi
  ok "node v$("$NODE_BIN" -v) 满足要求 (>= 20)"
}

# ── 2. 拉取 latest.json ──────────────────────────────────────────────────────
fetch_latest() {
  local url="${SERVER_URL}/daemon/latest.json"
  info "获取最新版本信息: $url"
  local resp
  if ! resp="$(curl -fsSL "$url" 2>/dev/null)"; then
    warn "无法获取 latest.json（$url），回退到默认下载路径。"
    LATEST_VERSION="unknown"
    DOWNLOAD_URL="${SERVER_URL}/daemon/latest/sillyhub-daemon.js"
    return
  fi
  # 纯 shell 解析 JSON（不依赖 jq）：取 "version" / "downloadUrl" 字段。
  LATEST_VERSION="$(printf '%s' "$resp" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
  DOWNLOAD_URL="$(printf '%s' "$resp" | sed -n 's/.*"downloadUrl"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
  if [[ -z "$LATEST_VERSION" ]]; then LATEST_VERSION="unknown"; fi
  if [[ -z "$DOWNLOAD_URL" ]]; then
    DOWNLOAD_URL="${SERVER_URL}/daemon/latest/sillyhub-daemon.js"
  elif [[ "$DOWNLOAD_URL" != http* ]]; then
    # 相对路径 → 拼接 SERVER_URL
    DOWNLOAD_URL="${SERVER_URL}${DOWNLOAD_URL}"
  fi
  ok "最新版本: $LATEST_VERSION"
  ok "下载地址: $DOWNLOAD_URL"
}

# ── 3. 下载 bundle ────────────────────────────────────────────────────────────
download_bundle() {
  mkdir -p "$BIN_DIR"
  info "下载 sillyhub-daemon.js -> $BIN_DIR/$BUNDLE_NAME"
  if ! curl -fSL "$DOWNLOAD_URL" -o "$BIN_DIR/$BUNDLE_NAME.tmp"; then
    die "下载失败: $DOWNLOAD_URL"
  fi
  mv "$BIN_DIR/$BUNDLE_NAME.tmp" "$BIN_DIR/$BUNDLE_NAME"
  chmod 0644 "$BIN_DIR/$BUNDLE_NAME"
  ok "下载完成 ($(du -h "$BIN_DIR/$BUNDLE_NAME" | cut -f1))"
}

# ── 4. 创建 wrapper ───────────────────────────────────────────────────────────
write_wrapper() {
  info "创建 wrapper: $BIN_DIR/$WRAPPER_NAME"
  cat > "$BIN_DIR/$WRAPPER_NAME" <<EOF
#!/usr/bin/env bash
# Auto-generated by SillyHub install.sh - do not edit.
# 转发所有参数到 node sillyhub-daemon.js
DIR="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
# 探测 node：优先 PATH，找不到则回退到安装时探测的绝对路径
NODE_BIN="\$(command -v node 2>/dev/null || echo "$NODE_BIN")"
exec "\$NODE_BIN" "\$DIR/$BUNDLE_NAME" "\$@"
EOF
  chmod 0755 "$BIN_DIR/$WRAPPER_NAME"
  ok "wrapper 已创建"
}

# ── 5. 加 PATH ────────────────────────────────────────────────────────────────
ensure_path() {
  if [[ ":${PATH}:" == *":${BIN_DIR}:"* ]]; then
    ok "PATH 已包含 $BIN_DIR"
    return
  fi
  info "尝试把 $BIN_DIR 加入 shell rc（幂等）"
  local rc_file=""
  if [[ -n "${ZSH_VERSION:-}" ]] || [[ -n "${ZSH_NAME:-}" ]]; then
    rc_file="${HOME}/.zshrc"
  elif [[ -n "${BASH_VERSION:-}" ]]; then
    rc_file="${HOME}/.bashrc"
  else
    case "${SHELL:-}" in
      */zsh)  rc_file="${HOME}/.zshrc";;
      */bash) rc_file="${HOME}/.bashrc";;
      *)      rc_file="${HOME}/.profile";;
    esac
  fi
  local marker='# sillyhub-daemon bin'
  if [[ -f "$rc_file" ]] && grep -qF "$marker" "$rc_file" 2>/dev/null; then
    ok "$rc_file 已含 PATH 配置（跳过）"
  else
    {
      echo ""
      echo "$marker"
      echo "export PATH=\"$BIN_DIR:\$PATH\""
    } >> "$rc_file"
    ok "已写入 $rc_file"
  fi
  export PATH="${BIN_DIR}:${PATH}"
  warn "新终端会话生效；当前终端请执行: export PATH=\"$BIN_DIR:\$PATH\""
}

# ── 6. 验证 --version ─────────────────────────────────────────────────────────
verify() {
  info "验证 sillyhub-daemon --version"
  if "$BIN_DIR/$WRAPPER_NAME" --version >/dev/null 2>&1; then
    ok "sillyhub-daemon $("$BIN_DIR/$WRAPPER_NAME" --version 2>/dev/null) 运行正常"
  else
    warn "wrapper 直接调用 --version 失败，尝试 node 显式调用："
    if "$NODE_BIN" "$BIN_DIR/$BUNDLE_NAME" --version; then
      ok "node 直接调用正常（PATH/wrapper 可能需手动 source）"
    else
      die "验证失败：bundle 无法执行。请检查 node 版本与下载完整性。"
    fi
  fi
}

# ── 7. （可选）直接 start ─────────────────────────────────────────────────────
maybe_start() {
  if [[ "$AUTO_START" -ne 1 ]]; then return; fi
  local args=(start)
  [[ -n "$START_SERVER" ]]  && args+=(--server "$START_SERVER")
  [[ -n "$START_API_KEY" ]] && args+=(--api-key "$START_API_KEY")
  [[ -n "$START_TOKEN" ]]   && args+=(--token "$START_TOKEN")
  if [[ ${#args[@]} -le 1 ]]; then
    warn "未提供 --server/--api-key/--token，跳过自动 start（仅安装）。"
    return
  fi
  info "启动 daemon..."
  exec "$BIN_DIR/$WRAPPER_NAME" "${args[@]}"
}

# ── 主流程 ────────────────────────────────────────────────────────────────────
main() {
  info "SillyHub daemon 安装脚本"
  check_node
  fetch_latest
  download_bundle
  write_wrapper
  ensure_path
  verify
  echo ""
  ok "安装完成！"
  echo  "  下一步: sillyhub-daemon start --server <SillyHub 地址> --api-key <你的 API Key>"
  echo  "  （或重新 source shell rc 后在任意目录运行）"
  echo ""
  maybe_start
}

main "$@"
