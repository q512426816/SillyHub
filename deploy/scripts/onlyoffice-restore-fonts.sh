#!/usr/bin/env bash
# onlyoffice-restore-fonts.sh — 把中文字体恢复进 bsp-onlyoffice 容器（ql-20260826-010）。
#
# 背景：DS 容器原生只有 5 个中文字体（思源系），Word 公文常用字体（方正小标宋/仿宋/
# 黑体/楷体、宋体/仿宋/楷体/黑体/微软雅黑）全部缺失 → 渲染时字体替换 → 行高漂移。
# 本脚本把宿主机备份的字体装回容器并重建字体索引。容器重建（镜像更新/重新 create）后
# docker cp 进去的字体会丢，需要重跑本脚本。
#
# 用法（Git Bash）：
#   ./deploy/scripts/onlyoffice-restore-fonts.sh [字体备份目录] [容器名]
# 默认：备份目录 ~/onlyoffice-fonts-backup，容器 bsp-onlyoffice
#
# 字体版权说明（不入 Git 仓库的原因）：
# - office-cn/：宋体/仿宋/楷体/黑体/微软雅黑——Windows 系统字体，微软许可，只可本机容器内使用
# - founder/：方正小标宋_GBK 等 8 个——从用户 docx 的内嵌字体子集（word/fonts/*.odttf，
#   ODTTF 前 32 字节异或 fontKey GUID 解混淆）提取，方正商用许可随原文档传递
# 备份目录结构：
#   ~/onlyoffice-fonts-backup/founder/*.ttf
#   ~/onlyoffice-fonts-backup/office-cn/*.{ttf,ttc}
# 若备份丢失：office-cn 可从 C:/Windows/Fonts 重新收集；founder 需从带内嵌字体的
# 原始 docx 重新提取（参考 quicklog ql-20260826-010 的解混淆方法）。

set -euo pipefail

FONT_DIR="${1:-$HOME/onlyoffice-fonts-backup}"
CONTAINER="${2:-bsp-onlyoffice}"

if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "错误：容器 $CONTAINER 不存在" >&2
  exit 1
fi

for sub in founder office-cn; do
  if [ ! -d "$FONT_DIR/$sub" ] || [ -z "$(ls -A "$FONT_DIR/$sub" 2>/dev/null)" ]; then
    echo "错误：$FONT_DIR/$sub 不存在或为空" >&2
    exit 1
  fi
done

echo "==> 安装字体到 $CONTAINER ..."
MSYS_NO_PATHCONV=1 docker exec -u root "$CONTAINER" mkdir -p \
  /usr/share/fonts/truetype/founder /usr/share/fonts/truetype/office-cn
tar -C "$FONT_DIR/founder" -cf - . |
  docker exec -i "$CONTAINER" tar -C /usr/share/fonts/truetype/founder -xf -
tar -C "$FONT_DIR/office-cn" -cf - . |
  docker exec -i "$CONTAINER" tar -C /usr/share/fonts/truetype/office-cn -xf -

echo "==> 重建 fontconfig 缓存 ..."
MSYS_NO_PATHCONV=1 docker exec -u root "$CONTAINER" fc-cache -f >/dev/null 2>&1

echo "==> 重启 DS（重建 AllFonts.js 字体索引）..."
docker restart "$CONTAINER" >/dev/null

for i in $(seq 1 30); do
  sleep 5
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:8080/healthcheck" 2>/dev/null || true)
  [ "$code" = "200" ] && break
done
if [ "$code" = "200" ]; then
  echo "==> 完成：DS 已恢复健康，字体索引已重建"
else
  echo "警告：DS 健康检查超时（code=$code），请手动确认 http://127.0.0.1:8080/healthcheck" >&2
  exit 1
fi
