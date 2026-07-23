---
author: qinyi
created_at: 2026-07-10T14:25:00+08:00
---

# 任务清单（Tasks）

> 基于 design.md 文件变更清单 + Wave 分组。plan 阶段（`sillyspec run plan`）细化每 task 的实现步骤、测试、验收。

## Wave 0：前置（开工先做）
- **T0.1** sillyspec `npm version patch + publish`（解锁 gate；本机已 link，生产部署需发版）
- **T0.2** 切 main + `alembic heads` 确认目标 head，定 migration down_revision（main 当前 14 head 碎片化）

## Wave 1：task-00 + gate 任务骨架（backend run_sync）
- **T1.1** RunSyncService 加 `_fire_background_task` + `_background_tasks: set` + `_on_bg_task_done`（H4，抄 `agent/service.py:358-375`）
- **T1.2** `close_interactive_run:684` 改：删 v4 R2；commit（:876）后 `_fire_background_task` enqueue；`gate_status='pending'` 在 :784 区随 commit（M2）
- **T1.3** `_run_gate_decision_task`（新 method）：H1 `get_session_factory()()` 独立 session + R3 cas gate_status pending→running + 跑 gate + 存 gate_result/decided + H2 内联 sync+auto_dispatch（不调 callback）+ 异常 failed/exit 2
- **T1.4** `reconcile_pending_gate_decisions`（新）挂 `main.py:73-81` lifespan startup（M3；启动扫 completed + gate_status in(pending,running) 全重置 pending + 重 enqueue）

## Wave 2：HostFsDelegate run_command（跨域 backend↔daemon）
- **T2.1** `delegate.py:131` 加第 9 方法 `run_command`（破 §5.1 锁死 `:13-15`，更新契约表）+ 命令白名单安全层（只允 sillyspec gate 模板）
- **T2.2** `_WsRpcLike.send_rpc` 协议（`delegate.py:117-125`）加 `timeout: float | None = None`（M5）
- **T2.3** `host-fs-handler.ts:282` 加 `run_command` handler（命令白名单 + execFile）
- **T2.4** `daemon.ts:_registerHostFsRpcHandler` 注册 run_command

## Wave 3：决策 + 数据模型（backend change）
- **T3.1** `agent/model.py` AgentRun 加 `gate_result` JSON + `gate_status` str 列 + migration（down_revision=T0.2 确认的 head）
- **T3.2** `_run_gate_via_delegate`（新；含 Z1 启动探测 gate 子命令）+ `_read_gate_result`
- **T3.3** `auto_dispatch_next_step:197` 读 gate_result 三态决策；verify（:221-222）gate 替代 read_verify_result（强制，无 flag）
- **T3.4** `change.stages last_dispatch` 加 `gate_retry_count`（exit 1 +1，>=3 升级 exit 2）+ `gate_last_errors`（exit 1 写摘要，跨 run）
- **T3.5** gate 任务完成发 Redis `gate_status_changed` SSE（FR-9，复用 agent_run SSE channel）

## Wave 4：前端
- **T4.1** change detail 页 gate_status 展示（"客观核验中"徽标 + 失败摘要 gate_last_errors + SSE 实时更新）

## Wave 5：验收
- **T5.1** verify 试点测试：AC-1~AC-9（多 turn verify + 三态 + 重启恢复 + double-fire 防护 + 命令白名单注入 + 前端 SSE 更新）

## 依赖
- Wave 0 → 所有（前置）
- Wave 1（gate 任务骨架）→ Wave 3（决策读 gate_result）
- Wave 2（HostFsDelegate run_command）→ Wave 1 的 T1.3（gate 任务调 run_command 跑 gate）
- Wave 3 → Wave 4（前端读 gate_status）
- 全部 → Wave 5（验收）

> 建议实现顺序：Wave 0 → Wave 2（HostFsDelegate 先通，gate 能跑）→ Wave 1（gate 任务骨架）→ Wave 3（决策+数据模型）→ Wave 4（前端）→ Wave 5（验收）。或 Wave 1→2→3 按 backend→daemon→决策。
