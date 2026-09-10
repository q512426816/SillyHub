---
id: task-04
title: 'Wave 4 开关端点：DTO + PATCH /sessions/{id}/auto-resume + config merge'
title_zh: 'Wave 4 开关端点：DTO + PATCH /sessions/{id}/auto-resume + config merge'
author: 'qinyi'
created_at: 2026-09-10 09:30:00
priority: P1
depends_on: ['task-01']
blocks: ['task-05']
requirement_ids: ['FR-06']
decision_ids: ['D-004@v1','D-010@v2']
allowed_paths:
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/router/session_crud.py
  - backend/app/modules/daemon/session/service/session_lifecycle.py
target_files:
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/router/session_crud.py
  - backend/app/modules/daemon/session/service/session_lifecycle.py
goal: >
  schema.py 加 SessionAutoResumeUpdateRequest{enabled: bool}（照 SessionCtxWindowUpdateRequest :334 先例）；router PATCH /sessions/{id}/auto-resume 204（owner 校验归 service、404 不泄露存在性，照 ctx-window :713-724）；service 层 session.config dict 复制 merge 整体赋值（照 daemon/session/service/control.py:574-583 先例——daemon 下另有 control_commands.py/agent/control.py 勿混，保留他键），写 auto_resume_interrupted=enabled。依赖 W1 属保守串行（本任务只写 config JSON 键，功能上不依赖两列 migration）。
implementation: >
  schema.py 加 SessionAutoResumeUpdateRequest{enabled: bool}（照 SessionCtxWindowUpdateRequest :334 先例）；router PATCH /sessions/{id}/auto-resume 204（owner 校验归 service、404 不泄露存在性，照 ctx-window :713-724）；service 层 session.config dict 复制 merge 整体赋值（照 daemon/session/service/control.py:574-583 先例——daemon 下另有 control_commands.py/agent/control.py 勿混，保留他键），写 auto_resume_interrupted=enabled。依赖 W1 属保守串行（本任务只写 config JSON 键，功能上不依赖两列 migration）。
acceptance: >
  owner 204 成功 + 非 owner 404 + config merge 保留他键（既有键不丢）+ 幂等重复设置；OpenAPI schema 更新（供 task-05 gen:types）；既有测试零回归。
constraints: >
  见 design.md 对应决策与 NFR；禁止越 allowed_paths 改文件；先例引用以行号锚定；既有测试零回归（NFR-01）。
verify: '验收标准见 acceptance 字段'
---


## 验收标准

owner 204 成功 + 非 owner 404 + config merge 保留他键（既有键不丢）+ 幂等重复设置；OpenAPI schema 更新（供 task-05 gen:types）；既有测试零回归。
