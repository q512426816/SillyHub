---
author: WhaleFall
created_at: 2026-08-12T13:20:00
task: task-02
title: transition_with_dispatch 加参数
---

# task-02: transition_with_dispatch 加参数

- **allowed_paths**: `backend/app/modules/change/service.py`
- **改动**：`transition_with_dispatch`（:722）签名加 `agent_profile_id: uuid.UUID | None = None`；透传给 `dispatch()`（:783）。
- **完成标准**：参数透传到 dispatch 调用；None 默认零回归。
- **依赖**：task-01（schema 先行才有字段概念）。
