---
author: WhaleFall
created_at: 2026-08-12T13:20:00
task: task-07
title: team_worker_preset 支持 profile_id（先于 task-08）
---

# task-07: team_worker_preset 支持 profile_id（先于 task-08）

- **allowed_paths**: `backend/app/modules/change/schema.py`
- **改动**：`worker_preset`（schema.py:224）注释明确每条支持 `{profile_id, objective, role}`（向后兼容 `{agent_type, model, ...}` 旧形态）；后端消费方（OrchestratorService / execution.py）按 profile_id 优先解析。（前端 `lib/changes.ts` 的 worker 类型变更归 task-09，不在本 task。）
- **完成标准**：schema loose dict 接受 profile_id；旧 preset 不破坏。
- **依赖**：task-01。
