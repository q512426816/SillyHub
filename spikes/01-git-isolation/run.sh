#!/usr/bin/env bash
set -euo pipefail

: "${REPO_A_URL:?REPO_A_URL not set}"
: "${REPO_B_URL:?REPO_B_URL not set}"
: "${PAT_A:?PAT_A not set}"
: "${PAT_B:?PAT_B not set}"

ROOT="$(mktemp -d -t sillyspec-spike-01-XXXX)"
echo "[spike01] root=$ROOT"
trap "rm -rf '$ROOT'" EXIT

run_as_user() {
  local USER_ID=$1
  local REPO_URL=$2
  local PAT=$3
  local RUN_TS=$(date +%s%N)

  local USER_HOME="$ROOT/$USER_ID/home"
  local WORKTREE="$ROOT/$USER_ID/repo"
  mkdir -p "$USER_HOME" "$(dirname "$WORKTREE")"

  cat > "$USER_HOME/askpass.sh" <<EOF
#!/usr/bin/env bash
echo "$PAT"
EOF
  chmod 0700 "$USER_HOME/askpass.sh"

  cat > "$USER_HOME/gitconfig" <<EOF
[user]
  name = $USER_ID-bot
  email = $USER_ID@spike.local
[credential]
  helper =
EOF

  # 保留最小 PATH（含 git for windows / Linux 默认位置）
  local MIN_PATH="/usr/bin:/bin:/usr/local/bin:/mingw64/bin:/mingw32/bin"
  # 网络代理由宿主机决定（与身份隔离正交），按需透传
  env -i \
    HOME="$USER_HOME" \
    PATH="$MIN_PATH" \
    HTTP_PROXY="${HTTP_PROXY:-${http_proxy:-}}" \
    HTTPS_PROXY="${HTTPS_PROXY:-${https_proxy:-}}" \
    NO_PROXY="${NO_PROXY:-${no_proxy:-}}" \
    GIT_CONFIG_GLOBAL="$USER_HOME/gitconfig" \
    GIT_CONFIG_SYSTEM=/dev/null \
    GIT_TERMINAL_PROMPT=0 \
    GIT_ASKPASS="$USER_HOME/askpass.sh" \
    bash -c "
      set -e
      git clone --depth 1 '$REPO_URL' '$WORKTREE'
      cd '$WORKTREE'
      git checkout -b spike-$USER_ID-$RUN_TS
      echo \"spike marker for $USER_ID at $RUN_TS\" > spike-marker-$USER_ID.txt
      git add spike-marker-$USER_ID.txt
      git commit -m 'spike: $USER_ID isolation test'
      git push origin HEAD:spike-$USER_ID-$RUN_TS
    "

  # 立即销毁 askpass
  shred -u "$USER_HOME/askpass.sh" 2>/dev/null || rm -f "$USER_HOME/askpass.sh"
}

echo "[spike01] running A and B concurrently..."
run_as_user "user-a" "$REPO_A_URL" "$PAT_A" &
PID_A=$!
run_as_user "user-b" "$REPO_B_URL" "$PAT_B" &
PID_B=$!
wait $PID_A
wait $PID_B

set +e   # 验证阶段不要因 grep 没找到而终止

PASS=0
FAIL=0

# 期望条件成立（exit code 0）= PASS
expect_zero() {
  local name=$1
  local result=$2
  if [ "$result" = "0" ]; then
    echo "  [PASS] $name"
    PASS=$((PASS+1))
  else
    echo "  [FAIL] $name (exit=$result)"
    FAIL=$((FAIL+1))
  fi
}

# 期望条件不成立（exit code != 0）= PASS（用于"不包含"语义）
expect_nonzero() {
  local name=$1
  local result=$2
  if [ "$result" != "0" ]; then
    echo "  [PASS] $name"
    PASS=$((PASS+1))
  else
    echo "  [FAIL] $name (unexpected match found)"
    FAIL=$((FAIL+1))
  fi
}

echo
echo "=== 验证 ==="

grep -rq "$PAT_B" "$ROOT/user-a" 2>/dev/null
expect_nonzero "A home 不含 B 的 PAT" $?

grep -rq "$PAT_A" "$ROOT/user-b" 2>/dev/null
expect_nonzero "B home 不含 A 的 PAT" $?

A_AUTHOR=$(cd "$ROOT/user-a/repo" && git log -1 --format='%ae' 2>/dev/null || echo "")
[ "$A_AUTHOR" = "user-a@spike.local" ]
expect_zero "A 提交 author=user-a@spike.local (实际=$A_AUTHOR)" $?

B_AUTHOR=$(cd "$ROOT/user-b/repo" && git log -1 --format='%ae' 2>/dev/null || echo "")
[ "$B_AUTHOR" = "user-b@spike.local" ]
expect_zero "B 提交 author=user-b@spike.local (实际=$B_AUTHOR)" $?

# 验证清理后 spike 自己的临时根目录不存在（更精确，避免扫描整个 TEMP）
SPIKE_ROOT="$ROOT"
rm -rf "$ROOT"
trap - EXIT

[ ! -d "$SPIKE_ROOT" ]
expect_zero "$SPIKE_ROOT 已被销毁" $?

# 同名前缀目录也不应残留（防止意外保留 askpass）
SCAN_TMP_DIR="${TMPDIR:-/tmp}"
[ -d "$SCAN_TMP_DIR" ] || SCAN_TMP_DIR="/tmp"
LEFTOVER=$(find "$SCAN_TMP_DIR" -maxdepth 1 -name 'sillyspec-spike-01-*' -type d 2>/dev/null | head -n 5)
[ -z "$LEFTOVER" ]
expect_zero "$SCAN_TMP_DIR 无 sillyspec-spike-01-* 残留" $?

echo
echo "=== 结果：PASS=$PASS FAIL=$FAIL ==="
[ $FAIL -eq 0 ] && echo "[spike01] SPIKE PASSED" || { echo "[spike01] SPIKE FAILED"; exit 1; }
