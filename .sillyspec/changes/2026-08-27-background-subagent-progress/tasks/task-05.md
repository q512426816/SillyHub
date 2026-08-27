---
id: task-05
author: qinyi
created_at: 2026-08-27 09:36:00
priority: P0
title: backend schema 扩展 + notify 端点透传 + Redis publish
title_zh: backend schema 扩展 + notify 端点透传 + Redis publish
depends_on: []
blocks: [task-06, task-08, task-09]
allowed_paths:
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/run_sync/service.py
provides:
  - contract: api_schema
    fields: [AgentTaskStatusEvent(status 四值/task_id/task_name/tool_use_id/summary/last_tool_name/elapsed_ms/total_tokens/tool_uses/async_ alias async), notify_agent_task_status 端点透传, openapi.json 再导出]
expects_from: []
goal: |
  扩展 backend AgentTaskStatusEvent DTO 与 notify_agent_task_status 端点、Redis 发布链路，透传全部新字段（FR-04）。
implementation: |
  1. schema.py：AgentTaskStatusEvent（:968 起）status Literal 扩为 running/completed/failed/stopped；新增可选字段 task_id 已有则保留、tool_use_id/summary/last_tool_name/elapsed_ms/total_tokens/tool_uses；async 用字段名 async_ + Field(alias="async")，model_config populate_by_name。
  2. router.py：notify_agent_task_status（:1555）请求模型与转发透传新字段。
  3. run_sync/service.py：agent_session:{id} 频道 publish 的 payload 构造（与 plan/bash 事件同路径）透传新字段。
  4. openapi.json 的重导出与提交统一归 task-09（本任务不改该文件，避免越权）。
acceptance: |
  三个透传层字段集合一致；旧载荷（仅 task_id/task_name/status=running）解析不报错（回归兼容）；openapi.json 含 async 字段名（alias 生效）。
verify: |
  cd backend && uv run pytest app/modules/daemon/tests/test_session_plan_bash_events.py -k agent_task_status（既有测试回归绿）；uv run python -c "from app.modules.daemon.schema import AgentTaskStatusEvent; ..." 冒烟新字段默认值。
constraints: |
  服务内实例化（svc = DaemonService(session) 模式不变）；中文注释；不加 DB 列（N6）；不改 _extract_sdk_messages（system 丢弃行为的替代在 daemon 侧）。
---
