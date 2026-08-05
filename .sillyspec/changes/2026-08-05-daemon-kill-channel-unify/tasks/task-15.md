---
id: task-15
title: Windows 强制验收（R-04 mcpServers 孙进程残留检查）
title_zh: Windows 强制验收
author: qinyi
created_at: 2026-08-05 19:24:02
priority: P0
depends_on: [task-01, task-03]
blocks: [task-14]
requirement_ids: [FR-06]
decision_ids: [D-004]
allowed_paths:
  - sillyhub-daemon/tests/
  - sillyhub-daemon/src/interactive/claude-sdk-driver.ts
goal: >
  强制验收 Windows 下注入 mcpServers 场景 kill 后 claude.exe 及 MCP 孙进程清理（R-04 升级项），确认无 taskkill。
implementation:
  - Windows 平台对 interactive session 注入 mcpServers 场景 kill 后检查 claude.exe 和 MCP 孙进程残留
  - grep sillyhub-daemon 源码确认无 taskkill /IM（守 D-004）
  - 若发现孙进程残留记录 QUICKLOG 并补显式清理方案
acceptance:
  - Windows kill 后 claude.exe 被终止无残留
  - MCP 孙进程被 SDK close 清理或已记录残留
  - grep sillyhub-daemon/src 无 taskkill
verify:
  - Windows 平台实机或脚本验证 kill 后进程树
  - grep sillyhub-daemon/src 无 taskkill
constraints:
  - 不自己 taskkill 全靠 SDK close（守 D-004）
  - 残留则记录 QUICKLOG 不阻塞 plan 完成
  - 跨平台兼容 Windows 和 Linux 和 macOS
---
