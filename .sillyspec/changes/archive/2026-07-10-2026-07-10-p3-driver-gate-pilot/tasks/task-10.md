---
id: task-10
title: dispatch.py 新增 reconcile_pending_gate_decisions 挂 main.py:73-81 lifespan startup（扫孤儿 gate 任务重置 pending + 重 enqueue）
title_zh: 重启 reconcile 兜底
author: qinyi
created_at: 2026-07-10 14:49:30
priority: P0
depends_on: [task-07]
blocks: [task-13]
requirement_ids: [FR-7]
decision_ids: []
allowed_paths:
  - backend/app/modules/change/dispatch.py
  - backend/app/main.py
---

# task-10 — reconcile 挂 lifespan 兜底

## 契约

**provides**
- `reconcile_pending_gate_decisions(session)` → `{orphan_count, reset_to_pending, reenqueue}`：扫 `agent_runs` WHERE `status='completed'` AND `change_id IS NOT NULL` AND `gate_status IN ('pending','running')`，全部 UPDATE `gate_status='pending'`（running 重置——重启后 running 是孤儿），逐个 `_fire_background_task(_run_gate_decision_task(agent_run_id, workspace_id, change_id))`。

**expects_from**
- task-07 `_run_gate_decision_task`（needs: `agent_run_id, workspace_id, change_id`）
- task-04 `AgentRun.gate_fields`（needs: `gate_status`）

## 依据
- design §5.5（reconcile 重启恢复，挂 lifespan startup 非 per-dispatch；孤儿无超时阈值——pending 是过渡态 fire 即 cas 成 running）
- design §10 R1（backend 重启丢 in-flight gate 任务 → reconcile 重置孤儿 running→pending 重 enqueue）/ R10（double-fire 由 R3 cas 兜底）/ M3（挂 lifespan startup）
- 生命周期契约表「reconcile（重启）」行
- plan.md task-10 行 + FR-7 → AC-6

## 实现要点
1. **新方法** `reconcile_pending_gate_decisions(self, session)`（dispatch.py，与 task-07 协程并列）：
   - `SELECT agent_runs WHERE status='completed' AND change_id IS NOT NULL AND gate_status IN ('pending','running')`
   - 全部 `UPDATE gate_status='pending'`（含 running——重启后 running 是孤儿，必须重置才能被 cas 抢）
   - `commit` 后逐个 `_fire_background_task(_run_gate_decision_task(agent_run_id, workspace_id, change_id))`（用 AgentService helper 或 RunSyncService，确保 `_background_tasks` set 强引用防 GC——对齐 H4 范式）
   - 返回 `{orphan_count, reset_to_pending, reenqueue}` 三值相等
2. **挂 main.py lifespan**（yield 前，与 :76-81 cleanup_stale_runs 并列，独立 factory() session）：
   ```python
   async with factory() as session:
       # 现有 bootstrap_admin_and_seed_rbac + cleanup_stale_runs ...
       try:
           result = await SillySpecStageDispatchService(session).reconcile_pending_gate_decisions(session)
           if result["orphan_count"]:
               log.warning("gate.reconcile_reenqueued", **result)
       except Exception:
           log.exception("gate.reconcile_failed")
   ```
   - **M3**：挂 startup（lifespan yield 前），非 per-dispatch（区别 `reconcile_stale_runs` :553）
   - try/except + log.exception 容错，异常不阻断启动（对齐 :76-81 cleanup_stale_runs 模式）
3. **无超时阈值**：pending/running 都视为孤儿，全重置（design §5.5——pending 是过渡态，fire 即 cas 成 running）
4. **reenqueue 幂等**：double-fire 由 task-07 R3 cas（`gate_status` pending→running rowcount==0 return）兜底

## acceptance
- [ ] 重启扫到孤儿（pending+running）全 `reset_to_pending` + `reenqueue`
- [ ] 无孤儿时 no-op（orphan_count=0）
- [ ] lifespan reconcile 异常不阻断启动（try/except log.exception）
- [ ] double-fire（reconcile + 原任务）由 task-07 R3 cas 兜底

## verify
```bash
cd backend && uv run pytest -k reconcile && uv run ruff check && uv run mypy app
```

## constraints
- 挂 startup 非 per-dispatch（区别 `reconcile_stale_runs` :553 同步路径）
- 无超时阈值（孤儿即重置）
- reenqueue 幂等（R3 cas 防双发 R10）
