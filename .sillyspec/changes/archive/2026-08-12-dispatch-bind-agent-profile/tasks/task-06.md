---
author: WhaleFall
created_at: 2026-08-12T13:20:00
task: task-06
title: MCP advance_change_stage tool 加参数（可与 W1 并行）
---

# task-06: MCP advance_change_stage tool 加参数（可与 W1 并行）

- **allowed_paths**: `backend/app/modules/mcp_gateway/tools.py`
- **改动**：`advance_change_stage`（:966）加 `agent_profile_id` 参数，透传给 `transition_with_dispatch`（与 HTTP 入口共用 service 方法，R-双入口一致）。
- **完成标准**：MCP tool 带 agent_profile_id 生效，与 HTTP 一致；MCP tool 测试更新。
- **依赖**：task-02（service 方法先有参数）。**可与 task-03/04 并行**。
