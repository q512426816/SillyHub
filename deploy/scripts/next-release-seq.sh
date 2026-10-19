#!/usr/bin/env bash
# 发布记录 frontmatter seq 取号器：全局最大 seq + 1（单一取号源，2026-10-18 修 seq 经常错）。
#
# 背景：frontmatter `seq` 是全局部署序号（前端徽标 #NNN、跨天单调递增）；
# 文件名里的 NNN 是「当天第几次」（跨天重置），两者是不同的数——历史上
# agent 按文件名/天内序号取号，导致 4 个部署都叫 #001（2026-10-18 全量
# 重排为 1..19 后固化本脚本）。写新记录前跑本脚本拿 seq，勿手算。
#
# 用法：bash deploy/scripts/next-release-seq.sh   # 输出下一个 seq（int）
# 兼容：Git Bash (Windows) / Linux / macOS（LF 换行，bash）。
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PROJECT_ROOT"

# 逐文件取首个 '^seq:' 行（-m1 按文件计），抽数字，取全局最大；无记录（首次）= 0。
MAX_SEQ="$(grep -h -m1 '^seq:' docs/releases/*.md 2>/dev/null | grep -oE '[0-9]+' | sort -n | tail -1 || true)"
NEXT=$(( ${MAX_SEQ:-0} + 1 ))
echo "$NEXT"
