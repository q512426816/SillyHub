---
id: task-03
title: SSE done 事件与结构化日志扩展
title_zh: converged_files / converged_dirs 事件字段 + 日志
author: qinyi
created_at: 2026-08-19T22:40:00
priority: P1
depends_on: [task-01]
blocks: [task-05]
requirement_ids: [FR-01]
decision_ids: []
provides:
  - contract: SSE done 事件新增字段 converged_files / converged_dirs
    fields: [converged_files, converged_dirs]
allowed_paths:
  - backend/app/modules/spec_workspace/service.py
goal: >
  对账统计透传：_write_spec_root 返回值扩展，SSE done 事件（import_from_repo_sse
  478-483）加 converged_files/converged_dirs 字段，apply_sync/SSE 记结构化日志
implementation:
  - _write_spec_root 返回值携带对账结果（或调用方从 helper 拿）
  - 适配三个调用点：SSE 452、apply_sync 959 起、import_from_repo
  - 结构化日志 spec_workspace.converged（两字段）；护栏跳过/中止也记日志
acceptance:
  - SSE done 事件含两字段；日志含两字段与护栏记录
constraints: >
  对齐 design Non-Goals：不动 apply_ops / daemon / CLI / 前端 / api-types；不做后台任务、UI 入口、migration。
verify:
  - pytest 回归

---
