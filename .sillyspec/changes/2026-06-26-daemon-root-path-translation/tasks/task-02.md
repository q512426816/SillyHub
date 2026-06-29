---
id: task-02
title: daemon/lease/context.py lease claim payload root_path 改写
author: WhaleFall
created_at: 2026-06-26T13:07:31
priority: P0
depends_on: [task-01]
blocks: [task-06]
allowed_paths:
  - backend/app/modules/daemon/lease/context.py
change: 2026-06-26-daemon-root-path-translation
---

# task-02

> goal: lease claim payload 的 root_path 在 backend→daemon 边界改写成宿主机路径（batch + interactive）。

## implementation
- `context.py:240-241`（batch，rootPath/root_path 双写）改调 `resolve_root_path_for_daemon`
- `context.py:72`（interactive，root_path=cwd or root_path）同改
- 在该函数上下文取 `path_source`（必要时从 lease/workspace 补查）

## acceptance
- batch claim payload rootPath/root_path 为宿主机路径
- interactive claim payload root_path 为宿主机路径
- daemon-client workspace 原样透传

## verify
- `cd backend && uv run pytest app/modules/daemon/lease/`
- 手动：触发 lease claim，daemon 收到的 payload root_path 为宿主机路径

## constraints
- **不改** `agent/placement.py:258/484`（lease.metadata 保持容器路径，被 backend `run_sync:766` 读）
- 不改 spec_root/specRoot 透传逻辑
- D-003：batch + interactive 都覆盖
