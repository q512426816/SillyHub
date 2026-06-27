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

# 检测 WSL：WSL 下 uname -r 含 microsoft/Microsoft。
# WSL + Windows node.exe 时必须装到 /mnt/c/... 路径，否则 Windows node
# 看不懂 WSL 的 /home/... 路径。
IS_WSL=0
if grep -qiE 'microsoft|Microsoft' /proc/sys/kernel/osrelease 2>/dev/null; then
  IS_WSL=1
fi

if [[ "$IS_WSL" -eq 1 ]]; then
  # WSL：用 Windows 用户目录（/mnt/c/Users/<name>）
  # WSL 的 $USER 默认就是 Windows 用户名，直接用，不调 cmd.exe
  # （cmd.exe 在 pipe 环境下可能失败，且 set -e + pipefail 会静默退出脚本）
  INSTALL_DIR="/mnt/c/Users/${USER}/.sillyhub/daemon"
else
  INSTALL_DIR="${HOME}/.sillyhub/daemon"
fi
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
# Windows（Git Bash）下 bash 的 PATH 可能不含 nvm4w / Program Files 的 node。
# 无条件尝试常见 Windows 路径——在 Linux/macOS 上这些路径不存在，无副作用。
NODE_BIN=""
check_node() {
  # 1a. 标准 PATH 查找
  if command -v node >/dev/null 2>&1; then
    NODE_BIN="$(command -v node)"
  fi

  # 1b. Windows 路径直查——Git Bash 用 /c/...，WSL 用 /mnt/c/...
  # 两套都试，Linux/macOS 上这些路径不存在所以无副作用
  if [[ -z "$NODE_BIN" ]]; then
    local candidates=(
      # Git Bash 格式
      "/c/nvm4w/nodejs/node.exe"
      "/c/Program Files/nodejs/node.exe"
      "/c/Program Files (x86)/nodejs/node.exe"
      # WSL 格式
      "/mnt/c/nvm4w/nodejs/node.exe"
      "/mnt/c/Program Files/nodejs/node.exe"
      "/mnt/c/Program Files (x86)/nodejs/node.exe"
    )
    for p in "${candidates[@]}"; do
      if [[ -f "$p" ]]; then
        NODE_BIN="$p"
        info "找到 node（路径探测）: $NODE_BIN"
        break
      fi
    done
  fi

  # 1c. cmd.exe / powershell.exe where 兜底
  if [[ -z "$NODE_BIN" ]]; then
    local win_node=""
    # Git Bash：cmd.exe 在 PATH
    if command -v cmd.exe >/dev/null 2>&1; then
      win_node="$(cmd.exe /c "where node" 2>/dev/null | tr -d '\r' | head -n1 || true)"
    fi
    # WSL：cmd.exe 不在 PATH，用完整路径
    if [[ -z "$win_node" ]] && [[ -f "/mnt/c/Windows/System32/cmd.exe" ]]; then
      win_node="$("/mnt/c/Windows/System32/cmd.exe" /c "where node" 2>/dev/null | tr -d '\r' | head -n1 || true)"
    fi
    if [[ -n "$win_node" ]]; then
      # C:\nvm4w\nodejs\node.exe → /c/nvm4w/nodejs/node.exe
      win_node="$(echo "$win_node" | sed 's|\\|/|g; s|^C:|/c|; s|^c:|/c|')"
      if [[ -f "$win_node" ]]; then
        NODE_BIN="$win_node"
        info "找到 node（cmd where）: $NODE_BIN"
      fi
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

  # WSL + Windows node.exe：路径需要 wslpath -w 转换
  local node_path_converter=""
  if [[ "$IS_WSL" -eq 1 ]] && [[ "$NODE_BIN" == *.exe ]]; then
    node_path_converter='$(wslpath -w "$DIR/'"$BUNDLE_NAME"'")'
  else
    node_path_converter="\$DIR/$BUNDLE_NAME"
  fi

  cat > "$BIN_DIR/$WRAPPER_NAME" <<EOF
#!/usr/bin/env bash
# Auto-generated by SillyHub install.sh - do not edit.
DIR="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN="\$(command -v node 2>/dev/null || echo "$NODE_BIN")"
# WSL + Windows node.exe 需要把 WSL 路径转成 Windows 路径
if [[ "\$NODE_BIN" == *.exe ]] && command -v wslpath >/dev/null 2>&1; then
  exec "\$NODE_BIN" "\$(wslpath -w "\$DIR/$BUNDLE_NAME")" "\$@"
else
  exec "\$NODE_BIN" "\$DIR/$BUNDLE_NAME" "\$@"
fi
EOF
  chmod 0755 "$BIN_DIR/$WRAPPER_NAME"
  ok "wrapper 已创建"

  # Windows（Git Bash / WSL）：额外创建 .cmd wrapper，让 cmd.exe / PowerShell 也能用
  local win_node_dir=""
  if [[ "$NODE_BIN" == *.exe ]]; then
    # 取 node.exe 所在目录，用于 .cmd 中写绝对路径（不依赖运行时 PATH 含 node）
    win_node_dir="$(dirname "$NODE_BIN")"
  fi

  # Git Bash: INSTALL_DIR 已是 /c/Users/... 格式；WSL: 是 /mnt/c/Users/... 格式
  # 转成 Windows 路径（C:\Users\...）给 .cmd 用
  local win_bin_dir=""
  if [[ "$IS_WSL" -eq 1 ]]; then
    win_bin_dir="$(wslpath -w "$BIN_DIR" 2>/dev/null || echo "")"
  else
    # Git Bash: /c/Users/... → C:\Users\...
    win_bin_dir="$(echo "$BIN_DIR" | sed 's|^/\([a-zA-Z]\)/|\1:|; s|/|\\|g')"
  fi

  if [[ -n "$win_bin_dir" ]]; then
    local cmd_wrapper="$BIN_DIR/${WRAPPER_NAME}.cmd"
    cat > "$cmd_wrapper" <<CMDEOF
@echo off
REM Auto-generated by SillyHub install.sh - do not edit.
if exist "${win_node_dir}\node.exe" (
  "${win_node_dir}\node.exe" "${win_bin_dir}\${BUNDLE_NAME}" %*
) else (
  node "${win_bin_dir}\${BUNDLE_NAME}" %*
)
CMDEOF
    chmod 0755 "$cmd_wrapper"
    ok ".cmd wrapper 已创建: $cmd_wrapper"
  fi
}

# ── 4b. 保存 server_url 到 config.json ────────────────────────────────────────
save_server_url() {
  local config_dir="$INSTALL_DIR"
  local config_file="$config_dir/config.json"
  mkdir -p "$config_dir"

  # WSL + Windows node.exe：路径需要转换
  local config_arg="$config_file"
  if [[ "$IS_WSL" -eq 1 ]] && [[ "$NODE_BIN" == *.exe ]] && command -v wslpath >/dev/null 2>&1; then
    config_arg="$(wslpath -w "$config_file")"
  fi

  # 如果 config.json 已存在，用 node 合并；否则创建新的
  if [[ -f "$config_file" ]]; then
    info "更新 config.json 中的 server_url"
    "$NODE_BIN" -e "
      const fs = require('fs');
      const p = process.argv[1];
      const c = JSON.parse(fs.readFileSync(p, 'utf-8'));
      c.server_url = process.argv[2];
      fs.writeFileSync(p, JSON.stringify(c, null, 2) + '\n');
    " "$config_arg" "$SERVER_URL" 2>/dev/null || {
      warn "config.json 更新失败（权限？），server_url 未持久化"
      return
    }
  else
    info "创建 config.json（server_url=$SERVER_URL）"
    "$NODE_BIN" -e "
      const fs = require('fs');
      const c = {
        server_url: process.argv[1],
        token: null,
        api_key: null,
        runtime_id: require('crypto').randomUUID(),
        profile: 'default',
        poll_interval: 30,
        heartbeat_interval: 15,
        max_concurrent_tasks: 5,
        log_level: 'info',
        default_timeout_seconds: 1800,
      };
      fs.writeFileSync(process.argv[2], JSON.stringify(c, null, 2) + '\n');
    " "$SERVER_URL" "$config_arg" 2>/dev/null || {
      warn "config.json 创建失败，server_url 未持久化"
      return
    }
  fi
  ok "server_url 已保存到 config.json"
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

    # Windows：把 bin 目录加到用户级 PATH（setx，幂等）
    local win_bin_for_path=""
    if [[ "$IS_WSL" -eq 1 ]]; then
      win_bin_for_path="$(wslpath -w "$BIN_DIR" 2>/dev/null || echo "")"
    else
      win_bin_for_path="$(echo "$BIN_DIR" | sed 's|^/\([a-zA-Z]\)/|\1:|; s|/|\\|g')"
    fi
    if [[ -n "$win_bin_for_path" ]]; then
      # 用 cmd.exe setx 永久写入用户 PATH（幂等：先检查是否已含）
      if command -v cmd.exe >/dev/null 2>&1; then
        cmd.exe /c "echo %PATH%" 2>/dev/null | tr -d '\r' | grep -qiF "$win_bin_for_path" || {
          info "将 $win_bin_for_path 加入 Windows 用户 PATH"
          # setx 设置用户环境变量（新开 cmd/PowerShell 生效）
          cmd.exe /c "setx PATH \"%PATH%;${win_bin_for_path}\"" >/dev/null 2>&1 || warn "setx PATH 失败（可能权限不足），请手动添加"
          ok "Windows PATH 已更新（新开终端生效）"
        }
      elif [[ -f "/mnt/c/Windows/System32/cmd.exe" ]]; then
        "/mnt/c/Windows/System32/cmd.exe" /c "echo %PATH%" 2>/dev/null | tr -d '\r' | grep -qiF "$win_bin_for_path" || {
          info "将 $win_bin_for_path 加入 Windows 用户 PATH"
          "/mnt/c/Windows/System32/cmd.exe" /c "setx PATH \"%PATH%;${win_bin_for_path}\"" >/dev/null 2>&1 || warn "setx PATH 失败"
          ok "Windows PATH 已更新（新开终端生效）"
        }
      fi
    fi
  fi
}

# ── 6. 验证 --version ─────────────────────────────────────────────────────────
verify() {
  info "验证 sillyhub-daemon --version"

  # WSL + Windows node.exe：路径需要 wslpath -w 转换
  local bundle_arg="$BIN_DIR/$BUNDLE_NAME"
  if [[ "$IS_WSL" -eq 1 ]] && [[ "$NODE_BIN" == *.exe ]] && command -v wslpath >/dev/null 2>&1; then
    bundle_arg="$(wslpath -w "$BIN_DIR/$BUNDLE_NAME")"
  fi

  if "$NODE_BIN" "$bundle_arg" --version >/dev/null 2>&1; then
    ok "sillyhub-daemon $("$NODE_BIN" "$bundle_arg" --version 2>/dev/null) 运行正常"
  else
    warn "验证失败，bundle 可能需要 PATH 配置后才能运行。"
    warn "请手动执行: $NODE_BIN \"$bundle_arg\" --version"
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
  save_server_url
  ensure_path
  verify
  echo ""
  ok "安装完成！"
  echo  "  服务器地址已保存: $SERVER_URL"
  echo  "  下一步: sillyhub-daemon start --api-key <你的 API Key>"
  echo  "  （server_url 已写入 config.json，无需再传 --server）"
  echo  "  （或重新 source shell rc 后在任意目录运行）"
  echo ""
  maybe_start
}

main "$@"
