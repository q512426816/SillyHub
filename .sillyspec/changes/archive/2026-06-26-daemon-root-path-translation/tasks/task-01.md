---
id: task-01
title: 新增 resolve_root_path_for_daemon 改写函数 + 单测
author: WhaleFall
created_at: 2026-06-26T13:07:31
priority: P0
depends_on: []
blocks: [task-02, task-03, task-04]
allowed_paths:
  - backend/app/modules/workspace/service.py
  - backend/app/modules/workspace/tests/
change: 2026-06-26-daemon-root-path-translation
---

# task-01

> goal: 新增 container→host 路径改写函数（逆现有 `_rewrite_path`），供 backend→daemon 下发 root_path 用。

## implementation
- 在 `workspace/service.py` 新增 `resolve_root_path_for_daemon(root_path, path_source)`
- `daemon-client` → 原样返回；否则按 `container_path_prefix`→`host_path_prefix` 前缀替换
- 未配前缀（裸机）→ 原样返回；路径 `\`→`/` 规范化沿用 `_rewrite_path`
- 单测覆盖：server-local 改写 / daemon-client 原样 / 裸机原样 / Windows 反斜杠

## acceptance
- server-local `/host-projects/X` + `HOST_PATH_PREFIX=F:/` → `F:/X`
- daemon-client 原样透传
- 未配前缀原样返回
- Windows `C:\` 盘符不被截断

## verify
- `cd backend && uv run pytest app/modules/workspace/tests/ -k root_path_for_daemon`

## constraints
- 不改 `_rewrite_path` / `resolve_root_path_for_server`
- 复用 `get_settings()`，不新增 env
- 跨平台（Windows/Linux/macOS）
