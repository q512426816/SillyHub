#!/usr/bin/env bash
# 发布记录生成器：取号/锚点推导/frontmatter 组装/落盘前自检/历史校验。
#
# 背景（2026-10-28 两起 /deploy-records 不可见事故同源）：手拼 frontmatter 漏闭合
# `---` 被平台判 invalid 沉底；取号/锚点手工多源拼接易错。本脚本产出即合规，
# 并在输出末尾附「防漏三指引」（提交 pathspec/镜像同步/backup tag）。
#
# 用法：
#   生成：bash deploy/scripts/gen-release-record.sh --summary "<一句概括>" \
#           [--status success|failed] [--commit-from <sha|null>] [--agent <id>] \
#           [--dir <目标目录>] [--dry-run]
#   校验：bash deploy/scripts/gen-release-record.sh --validate [--dir <目标目录>]
#
# 兼容：Git Bash (Windows) / Linux / macOS（LF 换行，bash）。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_ROOT"

RELEASES_DIR="docs/releases"
SEQ_SCRIPT="deploy/scripts/next-release-seq.sh"
MODE="generate"
STATUS="success"
AGENT="zcode-agent"
SUMMARY=""
COMMIT_FROM_OVERRIDE=""
TARGET_DIR="$RELEASES_DIR"
DRY_RUN=0

usage() { grep '^# 用法' -A 7 "$0" | sed 's/^# \{0,2\}//'; exit 2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --validate) MODE="validate" ;;
    --summary) SUMMARY="${2:-}"; shift ;;
    --status) STATUS="${2:-}"; shift ;;
    --commit-from) COMMIT_FROM_OVERRIDE="${2:-}"; shift ;;
    --agent) AGENT="${2:-}"; shift ;;
    --dir) TARGET_DIR="${2:-}"; shift ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage ;;
    *) echo "未知参数: $1（--summary 含空格须引号）" >&2; usage ;;
  esac
  shift
done

# ── 校验模式：逐文件查 frontmatter 成对 --- 与 8 必填字段 ──────────────
if [ "$MODE" = "validate" ]; then
  [ -d "$TARGET_DIR" ] || { echo "目录不存在: $TARGET_DIR" >&2; exit 1; }
  bad=0; total=0
  for f in "$TARGET_DIR"/*.md; do
    [ -f "$f" ] || continue
    total=$((total + 1))
    marker_count="$(grep -c '^---[[:space:]]*$' "$f" || true)"
    reasons=""
    [ "$marker_count" -eq 2 ] || reasons="--- 标记数=$marker_count(须为 2);"
    for field in seq: deployed_at: status: commit_from: commit_to: summary: agent: commits:; do
      grep -q "^${field}" "$f" || reasons="${reasons}缺 ${field%:};"
    done
    if [ -n "$reasons" ]; then
      echo "❌ 坏件: $f —— $reasons"
      bad=$((bad + 1))
    fi
  done
  echo "校验完成: 共 $total 件, 坏件 $bad"
  [ "$bad" -eq 0 ] || exit 1
  exit 0
fi

# ── 生成模式 ───────────────────────────────────────────────────────────
[ -n "$SUMMARY" ] || { echo "缺 --summary \"<一句概括>\"" >&2; usage; }
case "$STATUS" in success|failed) ;; *) echo "--status 仅 success|failed" >&2; exit 2 ;; esac

HEAD_SHA="$(git rev-parse --short=12 HEAD)"
SEQ="$(bash "$SEQ_SCRIPT")"
TODAY="$(date +%Y-%m-%d)"
DEPLOYED_AT="$(date '+%Y-%m-%d %H:%M:%S')"

# 当天序号 NNN：目标目录同日期前缀文件最大值 +1（三位补零）；无则 001。
NNN_MAX=0
for f in "$TARGET_DIR"/"${TODAY}"-*.md; do
  [ -f "$f" ] || continue
  n="$(basename "$f" | cut -d- -f4)"
  case "$n" in ''|*[!0-9]*) continue ;; esac
  n=$((10#$n))
  [ "$n" -gt "$NNN_MAX" ] && NNN_MAX=$n
done
NNN="$(printf '%03d' $((NNN_MAX + 1)))"
OUT_FILE="$TARGET_DIR/${TODAY}-${NNN}-${HEAD_SHA}.md"

# 锚点：本地 docs/releases（全局 seq 语义固定随仓）seq 最大记录的 commit_to。
ANCHOR="null"
max_seq=0
for f in "$RELEASES_DIR"/*.md; do
  [ -f "$f" ] || continue
  s="$(grep -m1 '^seq:' "$f" | grep -oE '[0-9]+' || true)"
  [ -n "$s" ] || continue
  s=$((10#$s))
  if [ "$s" -gt "$max_seq" ]; then
    max_seq=$s
    c="$(grep -m1 '^commit_to:' "$f" | sed 's/^commit_to:[[:space:]]*//' | tr -d '"' | tr -d '[:space:]')"
    [ -n "$c" ] && ANCHOR="$c"
  fi
done
if [ -n "$COMMIT_FROM_OVERRIDE" ]; then ANCHOR="$COMMIT_FROM_OVERRIDE"; fi

# commits 列表：锚点..HEAD（无锚则最近 20 条）；message 转义 \ 与 "。
COMMITS_BLOCK=""
if [ "$ANCHOR" != "null" ] && git rev-parse --verify "$ANCHOR" >/dev/null 2>&1; then
  RANGE="$ANCHOR..HEAD"
else
  RANGE="HEAD~20..HEAD"
  [ "$ANCHOR" = "null" ] && RANGE="-20"
fi
while IFS='|' read -r sha author msg; do
  [ -n "${sha:-}" ] || continue
  msg_escaped="$(printf '%s' "$msg" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
  COMMITS_BLOCK+="  - sha: ${sha}"$'\n'"    message: \"${msg_escaped}\""$'\n'"    author: ${author}"$'\n'
done < <(git log $RANGE --pretty=format:'%h|%an|%s' 2>/dev/null || true)
# 空 commits 区间（如锚点==HEAD 的同 commit 重部署）必须写行内流序列
# `commits: []`——`commits:\n[]` 顶格 [] 是非法 YAML 块值，平台解析判 invalid
# （2026-10-28 评审 P2 实证）。
if [ -n "$COMMITS_BLOCK" ]; then
  COMMITS_SECTION="commits:
${COMMITS_BLOCK}"
else
  COMMITS_SECTION="commits: []"
fi

SUMMARY_ESCAPED="$(printf '%s' "$SUMMARY" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"

CONTENT="---
seq: ${SEQ}
deployed_at: \"${DEPLOYED_AT}\"
status: ${STATUS}
commit_from: ${ANCHOR}
commit_to: ${HEAD_SHA}
summary: \"${SUMMARY_ESCAPED}\"
agent: ${AGENT}
${COMMITS_SECTION}
---

## 🆕 新增

- （待补）

## 🔧 修复

- （待补）

## ⚡ 优化

- （待补）

## 📝 部署验证

- （待补）
"

# ── 自检：--- 恰 2 个 + 8 字段在场；失败即中止（不落半成品） ────────────
check_content() {
  local file="$1"
  local c="$(grep -c '^---[[:space:]]*$' "$file" || true)"
  [ "$c" -eq 2 ] || { echo "自检失败: --- 标记数=$c(须为 2)" >&2; return 1; }
  for field in seq: deployed_at: status: commit_from: commit_to: summary: agent: commits:; do
    grep -q "^${field}" "$file" || { echo "自检失败: 缺 ${field%:}" >&2; return 1; }
  done
  return 0
}

if [ "$DRY_RUN" -eq 1 ]; then
  echo "==> dry-run 预览（不落盘）：$OUT_FILE"
  printf '%s\n' "$CONTENT"
else
  mkdir -p "$TARGET_DIR"
  TMP_FILE="$(mktemp "$TARGET_DIR/.gen-release.XXXXXX")"
  printf '%s' "$CONTENT" > "$TMP_FILE"
  if ! check_content "$TMP_FILE"; then
    rm -f "$TMP_FILE"
    exit 1
  fi
  mv "$TMP_FILE" "$OUT_FILE"
  echo "✅ 已生成: $OUT_FILE（seq=$SEQ NNN=$NNN 锚点 commit_from=$ANCHOR commit_to=$HEAD_SHA）"
fi

echo ""
echo "防漏三指引："
echo "  1) 提交（显式 pathspec，勿目录级 add）："
echo "     git add -- $OUT_FILE && git commit -m \"docs(release): ...\" -- $OUT_FILE"
echo "  2) 同步生产镜像目录（漏同步 = 服务器 /deploy-records 看不到本次部署）："
echo "     scp -i ~/.ssh/tencent_deploy $OUT_FILE ubuntu@124.222.127.242:/opt/sillyhub/repos/multi-agent-platform/docs/releases/"
echo "  3) 部署上生产时守 backup tag 惯例（见 deploy-to-server skill「回滚」节）"
echo "  终检：bash deploy/scripts/gen-release-record.sh --validate"
