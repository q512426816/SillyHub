---
id: task-06
title: 端到端验证（batch + interactive + 回归 + 兼容）
author: WhaleFall
created_at: 2026-06-26T13:07:31
priority: P0
depends_on: [task-02, task-03, task-04, task-05]
blocks: []
allowed_paths: []
change: 2026-06-26-daemon-root-path-translation
---

# task-06

> goal: 端到端验证 root_path 翻译修复在 batch/interactive/daemon-client/裸机/backend-scanner 全场景正确。

## implementation
- 触发变更中心 batch lease agent 执行 → 查 daemon terminal.log `cwd=项目根` + CC `find scan-docs/page.tsx` 命中 + run 正常完成
- 触发 interactive session → 同样验证 cwd
- daemon-client workspace → root_path 原样透传，行为不回归
- 裸机（未配 HOST_PATH_PREFIX）→ 改写原样返回
- backend scanner（scan_docs/knowledge/task）→ 仍走容器路径，post_scan 读 lease.metadata 不变

## acceptance
- plan.md §全局验收 8 条全过

## verify
- 手动触发变更中心 agent 执行 + 看 daemon terminal.log
- `cd backend && uv run pytest`
- `cd sillyhub-daemon && pnpm test`

## constraints
- 不改代码（纯验证 task）
- 旧 daemon（未升级 task-05）不兼容——需 daemon 同步升级 + 分发物 rebuild（兼容性条款）
- backend scanner 不回归是硬约束
