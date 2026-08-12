---
author: WhaleFall
created_at: 2026-08-12T13:20:00
task: task-01
title: TransitionRequest schema 加 agent_profile_id
---

# task-01: TransitionRequest schema 加 agent_profile_id

- **allowed_paths**: `backend/app/modules/change/schema.py`
- **改动**：`TransitionRequest`（:202）加 `agent_profile_id: UUID | None = None`。`worker_preset`（:224 注释）每条结构从 `{agent_type, model, objective, role}` 更新注释为支持 `profile_id`（schema 本身是 `list[dict]` loose，类型不动；task-07 细化）。
- **完成标准**：`TransitionRequest` 含新字段；ruff/mypy 过；不破坏既有字段。
- **依赖**：无（链头）。
