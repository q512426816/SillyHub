---
id: task-07
author: qinyi
created_at: 2026-08-27 09:36:00
priority: P1
title: 空 prompt inject 422（SessionEmptyPrompt + 中文文案）
title_zh: 空 prompt inject 422（SessionEmptyPrompt + 中文文案）
depends_on: []
blocks: [task-08]
allowed_paths:
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/schema.py
provides: []
expects_from: []
goal: |
  空 prompt 注入被服务端拒绝，不再产生 50ms 空轮（FR-08 / D-004@v1；生产实证 run c78044c8）。
implementation: |
  1. schema.py：inject 请求 DTO 的 prompt 字段加 min_length=1（strip 后非空由 service 校验，DTO 层挡纯空串）。
  2. session/service.py：inject_session（:2177）入口对 (prompt or "").strip() 判空 → raise SessionEmptyPrompt（AppError 子类，http_status=422，code="SESSION_EMPTY_PROMPT"，中文文案"消息内容不能为空"）。
  3. 在忙轮入队（queue_when_busy）之前校验（空消息不进队列）。
acceptance: |
  POST /inject prompt="" 或全空白 → 422 + 中文 detail；不创建 AgentRun、不写 user_input 日志行；非空 prompt 行为不变（含 queued 路径）。
verify: |
  单测在 task-08（含 l10n AST 守护自动覆盖）；本任务冒烟 uv run pytest app/modules/daemon/tests/ -k inject。
constraints: |
  领域错误按事件命名（IncidentNotFound 惯例 → SessionEmptyPrompt）；文案必须含 CJK（test_error_message_l10n 会卡）；schema.py 与 task-05 同文件不同段，允许并行后合并（无逻辑冲突）。
---
