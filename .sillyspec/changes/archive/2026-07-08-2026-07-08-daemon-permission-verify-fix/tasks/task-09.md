---
author: qinyi
created_at: 2026-07-08T21:55:21
id: task-09
title: 测试 stage 回写（complete_lease 后 last_dispatch.status 推进）
priority: P0
estimated_hours: 2
depends_on: []
blocks: []
allowed_paths:
  - backend/tests/modules/daemon/lease/test_complete_lease_stage_writeback.py
goal: 验证 complete_lease 后 change.stages.last_dispatch.status 正确推进（completed/failed），且不读 sillyspec.db
implementation: 新建 test_complete_lease_stage_writeback.py 6 用例：completed/failed 推进、scan run 跳过、回写失败不阻塞 lease、不读 sillyspec.db（D-003 守护）、last_dispatch 其他字段保留
acceptance: 6 用例全绿；complete_lease 推进 last_dispatch.status；scan run 早返回不触碰 change.stages；回写失败不阻塞 lease（log.warning）；不依赖 sillyspec.db 文件；现有 e2e/dispatch 测试不回归
verify: pytest backend/tests/modules/daemon/lease/test_complete_lease_stage_writeback.py -v 全绿
constraints: mock _facade._trigger_stage_completion_callback 为 no-op 隔离新方法；change.stages JSON 读回用 session.refresh 或重新 session.get 避开 identity map 缓存
covers: [FR-004]
---
# task-09: 测试 stage 回写（complete_lease 后 last_dispatch.status 推进）

## 文件
新增 backend/tests/modules/daemon/lease/test_complete_lease_stage_writeback.py

## 操作步骤
1. 新建 `backend/tests/modules/daemon/lease/test_complete_lease_stage_writeback.py`，pytest + asyncio 风格，参考 `backend/tests/modules/change/test_e2e_stage_dispatch.py` 的 fixture（real DB + `_create_workspace` / `_create_change` helper，mock daemon 侧）。
2. fixture：建 workspace + change（current_stage=verify）+ AgentRun（change_id 非空，status 初始 running）+ DaemonTaskLease（kind='interactive' 或 'batch'，agent_run_id 关联，metadata 含 stage=verify）+ lease.claim_token。`change.stages["last_dispatch"]` 预置 `{"stage":"verify","run_id":str(run.id),"status":"running","config":{...}}`。
3. 用例 1 `test_complete_lease_promotes_last_dispatch_to_completed`：
   - 调 `DaemonLeaseService.complete_lease(lease_id, claim_token, result={"status":"completed","output":"..."})`（lease/service.py:279）。
   - 重新查 Change，断言 `change.stages["last_dispatch"]["status"] == "completed"`（从 running 推进）。
   - 断言 `agent_run.status == "completed"` + `finished_at` 非空（现有逻辑）。
4. 用例 2 `test_complete_lease_promotes_last_dispatch_to_failed_on_run_failure`：
   - `result={"status":"failed","error":"..."}`。
   - 断言 `change.stages["last_dispatch"]["status"] == "failed"`。
   - 断言 `agent_run.status == "failed"`。
5. 用例 3 `test_complete_lease_skips_stage_writeback_for_scan_run`：
   - AgentRun.change_id=None（scan run）。
   - complete_lease 后 `change.stages` 不被该方法触碰（scan 无 change，或 change.stages 无 last_dispatch 写入）。断言方法早返回（`agent_run.change_id is None` 分支）。
6. 用例 4 `test_complete_lease_stage_writeback_failure_does_not_block_lease`：
   - mock `_sync_stage_status_from_run` 抛异常（如 Change 不存在）。
   - 断言 lease 仍 `status=completed`（complete_lease 不被回写失败阻塞），`log.warning` 记录。
7. 用例 5 `test_complete_lease_does_not_read_sillyspec_db`（D-003 守护）：
   - mock `dispatch_svc.sync_stage_status`，断言未被调用（或仅 `_trigger_stage_completion_callback` 调，新方法独立）。
   - 断言 `_sync_stage_status_from_run` 不触达 sillyspec.db（无 sqlite3 连接 / 无 sillyspec.db 文件读取）。
8. 用例 6 `test_complete_lease_preserves_last_dispatch_other_fields`：
   - 回写后 `last_dispatch` 的 stage/user_id/at/config/run_id 保持原值，仅 status 变更。

## 验收标准
- 6 用例全绿：completed/failed 推进、scan 跳过、失败容错、不读 db、字段保留。
- `pytest backend/tests/modules/daemon/lease/test_complete_lease_stage_writeback.py -v` 全绿。
- 不依赖 sillyspec.db 文件（测试不创建 sillyspec.db，证明独立路径）。
- 现有 `test_e2e_stage_dispatch.py` / `test_dispatch_chain.py` 不回归（last_dispatch.status 推进是新字段，旧测试只断言 stage/run_id）。

## 验证
- pytest backend/tests/modules/daemon/lease/test_complete_lease_stage_writeback.py
- complete_lease 后 last_dispatch.status 推进断言通过
- 不读 sillyspec.db 断言通过

## 依赖
task-05（`_sync_stage_status_from_run` 实现）。本 task 是 task-05 的验收测试。

## 风险
- complete_lease 现有逻辑会调 `_trigger_stage_completion_callback`（走 sync_stage_status 读 sillyspec.db），测试需 mock 该 facade 方法或预置 sillyspec.db，避免它干扰新方法断言。建议 mock `self._facade._trigger_stage_completion_callback` 为 no-op，隔离新方法行为。
- `change.stages` JSON in-place mutation 不持久化的坑（dispatch.py:605/638 注释）：测试读回时用 `session.refresh(change)` 或重新 `session.get` 拿最新值，别用 identity map 缓存。
