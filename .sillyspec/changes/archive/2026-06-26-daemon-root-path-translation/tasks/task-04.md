---
id: task-04
title: context_builder --dir + build_scan_bundle root_path 入参核对/改写
author: WhaleFall
created_at: 2026-06-26T13:07:31
priority: P1
depends_on: [task-01]
blocks: [task-06]
allowed_paths:
  - backend/app/modules/agent/context_builder.py
  - backend/app/modules/agent/service.py
change: 2026-06-26-daemon-root-path-translation
---

# task-04

> goal: scan/init 命令的 `--dir` root_path 入参，在命令于 daemon 执行时改写成宿主机路径。

## implementation
- 核对 `context_builder.py:569/572/579`（--dir）+ `service.py:1333/1399`（build_scan_bundle 调用）root_path 入参来源
- 判定命令执行环境：daemon 执行 → 入参改写；容器内执行 → 不改
- 改写处调 `resolve_root_path_for_daemon`，需 path_source

## acceptance
- scan 命令在 daemon 执行时 --dir 为宿主机路径
- 容器内执行的 scan 路径不变（不破坏 backend 自身 scan）

## verify
- `cd backend && uv run pytest app/modules/agent/ -k scan_bundle`

## constraints
- 不破坏容器内执行的 scan 路径（backend 自身 scanner 仍用容器路径）
- 先确认执行环境再决定改写点（execute 阶段查证 design §10 X-003）
- D-001 覆盖
