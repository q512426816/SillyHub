---
id: task-06
title: start_init_dispatch + bootstrapSpecWorkspace 自动化（D-002/D-009）
author: qinyi
created_at: 2026-07-02 11:00:00
priority: P0
depends_on: [task-01, task-09]
blocks: [task-07, task-08, task-15]
allowed_paths:
  - backend/app/modules/agent/service.py
  - backend/app/modules/spec_workspace/service.py
  - backend/app/modules/workspace/router.py
---

## 目标
「初始化」触发 init lease dispatch（带 platform_config + latest_spec_version + root_path）；`bootstrapSpecWorkspace` 建容器作为前置自动步骤（D-002/D-009）。

## 实现步骤
- 新增 `AgentService.start_init_dispatch(workspace_id, actor_user_id)`（仿 start_scan_dispatch）：先 `_ensure_spec_workspace`（建容器，bootstrapSpecWorkspace 逻辑并入）→ 建 init-mode interactive lease，payload = {workspace_id, actor, runtime_id, root_path（取 member binding）, platform_config{server_origin,strategy}, latest_spec_version}。
- workspace/router.py 新增 `POST /workspaces/{id}/init` 端点调 start_init_dispatch。

## 验收标准
- POST init → 建 spec_workspace 容器（若未建）+ 建 init lease（payload 含 platform_config/latest_spec_version/root_path）。

## 验证方式
`cd backend && uv run pytest app/modules/agent/tests/test_start_init_dispatch.py -q`。

## 约束
- root_path 取自 task-01 的 member binding 解析。
- latest_spec_version 取 SpecWorkspace.spec_version（task-09）。
- 不改 scan lease 通道，init lease 独立 mode。
