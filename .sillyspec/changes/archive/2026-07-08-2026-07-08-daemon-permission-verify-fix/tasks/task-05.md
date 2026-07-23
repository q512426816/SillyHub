---
author: qinyi
created_at: 2026-07-08T21:55:21
id: task-05
title: complete_lease 补 stage 回写（从 agent_runs 推导）
priority: P0
estimated_hours: 2
depends_on: []
blocks: []
allowed_paths:
  - backend/app/modules/daemon/lease/service.py
goal: complete_lease 中从 agent_run.status 推导并回写 stages.last_dispatch.status，独立路径保证 lease 完成后 stage 状态必推进。
implementation: |
  1. DaemonLeaseService 新增私有异步方法 _sync_stage_status_from_run(self, agent_run: AgentRun) -> None，复用 complete_lease line 308 已加载的 agent_run。
  2. 仅当 agent_run.change_id is not None（stage dispatch，非 scan）执行；scan 跳过。
  3. 从 agent_run.status 推导 last_dispatch.status：completed→completed、failed/killed→failed、cancelled→failed、其他不回写 warn。
  4. 加载 Change，dict copy 后仅覆盖 last_dispatch.status（保留 stage/user_id/at/config/run_id），写回 change.stages，复用 complete_lease 末尾 commit。
  5. complete_lease 中 agent_run 终态写入后、commit 前调用，try/except 失败只 warn 不阻塞 lease 完成。
  6. 与现有 _trigger_stage_completion_callback 并存，前者保证 last_dispatch.status 必推进，后者负责 auto_dispatch 下一阶段。
  7. 禁止读 sillyspec.db，禁止调 dispatch_svc.sync_stage_status。
acceptance: |
  - complete_lease result.status=completed 后 changes.stages.last_dispatch.status 从 running 推进为 completed。
  - run failed 时推进为 failed。
  - scan run（change_id=None）不触发该方法。
  - 不读 sillyspec.db（grep 新方法体无 sillyspec.db / sqlite3 / sync_stage_status）。
  - 方法失败（Change 不存在）不阻塞 lease 完成（只 warn）。
  - 单测覆盖：complete_lease 后查 change.stages["last_dispatch"]["status"] == "completed"/"failed"。
verify: pytest backend/app/modules/daemon/lease/tests/
constraints: 禁止读 sillyspec.db 禁止调 sync_stage_status（独立路径 D-003）；last_dispatch 可能不存在需 stages.get 兜底 warn 跳过不造空键；只推进 last_dispatch.status 展示用，sillyspec.db 真实状态归 spec-sync-fix 不在此修。
covers: [FR-004, D-003]
---
# task-05: complete_lease 补 stage 回写（从 agent_runs 推导）

## 文件
修改 backend/app/modules/daemon/lease/service.py
新增 backend/app/modules/daemon/lease/service.py（同文件内新增私有方法 `_sync_stage_status_from_run`）

## 操作步骤
1. 在 `DaemonLeaseService` 中新增私有异步方法 `_sync_stage_status_from_run(self, agent_run: AgentRun) -> None`：
   - 入参为已加载的 `AgentRun`（complete_lease 已在 line 308 `self._session.get(AgentRun, lease.agent_run_id)` 拿到，直接复用，不重复查询）。
   - 仅当 `agent_run.change_id is not None`（stage dispatch，非 scan）才执行；scan（change_id=None）跳过。
   - 从 `agent_run.status` 推导 `stages.last_dispatch.status`：`completed→completed`、`failed/killed→failed`、`cancelled→failed`、其他（running/pending）→ 不回写（lease 已 complete，理论不会出现，warn 记录）。
   - 加载 `Change`（按 `agent_run.change_id`），读 `change.stages` JSON，`dict()` copy 后更新 `last_dispatch.status` 字段（保留 `last_dispatch` 现有的 stage/user_id/at/config/run_id 不动，仅覆盖 `status`）。
   - 写回 `change.stages = stages`，`session.add(change)`。不单独 commit（复用 complete_lease 末尾的 `await self._session.commit()`，line 449）；若调用点在 commit 之后则自行 commit 一次。
   - **禁止读 sillyspec.db**，禁止调用 `dispatch_svc.sync_stage_status`（后者读 sillyspec.db，依赖 spec 同步，归 2026-06-28-daemon-client-spec-sync-strategy；本变更独立路径，D-003）。
2. 在 `complete_lease`（line 279 起）中调用该方法：位置在 agent_run 终态写入之后（line 405 `self._session.add(agent_run)` 之后）、`await self._session.commit()`（line 449）之前。用 try/except 包裹，失败只 `log.warning("sync_stage_status_from_run_failed", ...)` 不阻塞 lease 完成（与现有 `_trigger_stage_completion_callback` 容错风格一致，line 528-534）。
3. 与现有 `_trigger_stage_completion_callback`（line 521-534，走 sync_stage_status 读 db）**并存**：前者保证 `last_dispatch.status` 必推进（独立路径），后者负责 auto_dispatch 下一阶段（依赖 spec 同步，失败容错）。两者失败互不影响。
4. 日志：成功记 `log.info("stage_status_synced_from_run", change_id=..., run_id=..., status=...)`。

## 验收标准
- complete_lease 完成（result.status=completed）后，`changes.stages.last_dispatch.status` 从 `running` 推进为 `completed`。
- run failed 时推进为 `failed`。
- scan run（change_id=None）不触发该方法（无 stage 回写）。
- 不读 sillyspec.db（grep 新方法体无 `sillyspec.db` / `sqlite3` / `sync_stage_status` 调用）。
- 方法失败（如 Change 不存在）不阻塞 lease 完成（只 warn）。
- 单测覆盖：complete_lease 后查 `change.stages["last_dispatch"]["status"]` == "completed"/"failed"。

## 依赖
无（Wave 3 独立，可与 task-01/02 并行）。task-09 测试本 task。

## 风险
- R-03：从 agent_runs 推导可能和 sillyspec.db 真实状态不一致（design §10）。本 task 只推进 `last_dispatch.status` 展示用，sillyspec.db 同步归 spec-sync-fix，不在此修。
- last_dispatch 可能不存在（change.stages 为空或无 last_dispatch 键）：方法内 `stages.get("last_dispatch", {})` 兜底，若无 last_dispatch 则 warn 跳过不写（避免造空 last_dispatch 误导前端）。
