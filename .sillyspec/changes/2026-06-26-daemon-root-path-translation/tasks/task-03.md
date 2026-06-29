---
id: task-03
title: agent/router.py execution-context 响应 root_path 改写
author: WhaleFall
created_at: 2026-06-26T13:07:31
priority: P1
depends_on: [task-01]
blocks: [task-06]
allowed_paths:
  - backend/app/modules/agent/router.py
change: 2026-06-26-daemon-root-path-translation
---

# task-03

> goal: execution-context 端点响应的 root_path 改写成宿主机路径（daemon 领取 lease 后调用此端点拿 cwd）。

## implementation
- `router.py:268` `root_path=resolve_root_path_for_daemon(ws_row.root_path, ws_row.path_source)`
- path_source 已可取于 `router.py:242`，无需补查

## acceptance
- execution-context 响应 root_path 为宿主机路径（server-local）
- daemon-client workspace 原样透传
- 其他 ExecutionContextResponse 字段不变

## verify
- `cd backend && uv run pytest app/modules/agent/ -k execution_context`

## constraints
- 不改 lease.metadata（placement.py 写入，保持容器路径）
- 不动 ExecutionContextResponse 其他字段
- 仅改 root_path 取值
