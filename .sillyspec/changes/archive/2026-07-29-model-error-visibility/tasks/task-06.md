---
id: task-06
title: backend InteractiveRunResultRequest 加 error + close_interactive_run 写入
title_zh: 后端接收并存储模型错误详情
author: qinyi
created_at: 2026-07-29 10:34:02
priority: P0
depends_on: [task-01, task-05]
blocks: [task-07]
requirement_ids: [FR-02]
decision_ids: [D-009@v1]
allowed_paths:
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/run_sync/service.py
  - backend/app/modules/daemon/service.py
provides:
  - contract: CloseInteractiveRunWrite
    fields: [error_detail]
expects_from:
  task-01:
    - contract: ModelErrorDTO
      needs: [type, code, message, retryable, hint, raw]
  task-05:
    - contract: AgentRunErrorDetail
      needs: [error_detail]
goal: >
  InteractiveRunResultRequest 加 error 字段，close_interactive_run（facade + 实体 + 路由）接收并写入 AgentRun.error_detail。
implementation:
  - router.py InteractiveRunResultRequest（:1084）加 error（ModelErrorDTO 或 None）
  - router.py:1118 路由透传 error 形参到 service
  - service.py:508 DaemonService facade close_interactive_run 透传 error
  - run_sync/service.py:735 真实实现接收 error，写入 AgentRun.error_detail，run status=failed
acceptance:
  - InteractiveRunResultRequest 含 error 字段（可选）
  - close_interactive_run 写入 error_detail 且 run 转 failed
  - facade（service.py:508）与实体（run_sync/service.py:735）签名同步
verify:
  - cd backend && uv run pytest tests/modules/daemon -q --no-cov
  - cd backend && uv run mypy app/modules/daemon
constraints:
  - facade 签名必须与 RunSyncService 同步（service.py:528-531 已警告）
  - error_code（系统错误）与 error_detail（模型错误）正交不互覆（D-009）
  - error 字段可选，旧 daemon 不传时 error_detail=None
---
