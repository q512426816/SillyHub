---
author: qinyi
created_at: 2026-09-30 11:00:12
---
# 任务清单（Tasks）

- [x] task-01: platform_agent_logs 机器身份两列 + alembic 迁移（模型+迁移+单测）
- [x] task-02: daemon 心跳 machine_id 上报与落 metadata（daemon.ts/hub-client.ts/heartbeat.py+测试）
- [x] task-03: 上报协议 v2 machine 块接收落库 + config_snapshot 聚合 + 协议文档（depends_on: task-01）
- [x] task-04: takeover 服务核心：四级匹配 + fork 分叉落库 + native resume + DTO/端点（depends_on: task-03）
- [x] task-05: handoff 档：交接文档 + RPC 读 + 引擎/档案重选 + 降级（depends_on: task-04）
- [x] task-06: 懒激活退役 + reset-tool-report 端点（depends_on: task-04）
- [x] task-07: 前端衔接状态全量 + gen:types（depends_on: task-04, task-05, task-06）
