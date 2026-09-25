#!/usr/bin/env bash
# git-safe.sh — 并行会话 git 竞态防护（2026-09-26-deploy-eng-hardening）。
#
# 背景：多会话共享主仓时 git index.lock 竞态真实发生（本轮实证：并行会话同时
# commit 直接 "Unable to create .git/index.lock: File exists"）。git 本身无等待
# 语义；本脚本把「等锁释放再重试」包成一行命令。
#
# 用法：scripts/git-safe.sh <任意 git 命令...>
#   scripts/git-safe.sh commit -m "..."     # 等价 git commit，锁占用时自动等待重试
#   scripts/git-safe.sh add -A
# 环境变量：GIT_SAFE_TIMEOUT_SEC（默认 30，超时放弃非零退出）。
set -euo pipefail

TIMEOUT="${GIT_SAFE_TIMEOUT_SEC:-30}"
[ "$#" -ge 1 ] || { echo "用法: $0 <git 命令...>" >&2; exit 2; }

deadline=$(( $(date +%s) + TIMEOUT ))
attempt=0
while :; do
  if out=$(git "$@" 2>&1); then
    printf '%s\n' "$out"
    exit 0
  fi
  if ! printf '%s' "$out" | grep -q "index.lock"; then
    printf '%s\n' "$out" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  now=$(date +%s)
  if [ "$now" -ge "$deadline" ]; then
    echo "git-safe: 等待 index.lock 超时（${TIMEOUT}s，重试 ${attempt} 次）——另一 git 进程仍持有锁。" >&2
    printf '%s\n' "$out" >&2
    exit 1
  fi
  echo "git-safe: index.lock 被占用（第 ${attempt} 次重试，剩余 $((deadline - now))s）……" >&2
  sleep 2
done
