---
id: task-04
title: worktree GC 判据改造 + acquire 回填 + 守护测试
title_zh: worktree GC 判据改造（关联 agent_run 非终态保留/终态含 cancelled 回收/孤儿 expires_at）+ acquire 可选 agent_run_id + _try_acquire_lease 回填 + 守护测试
author: qinyi
created_at: 2026-07-14 11:12:00
priority: P0
depends_on: [task-01, task-02]
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-003@v2]
expects_from:
  task-01:
    - contract: WorktreeLease
      needs: [agent_run_id]
  task-02:
    - contract: LeaseReaperService
      needs: [_run_worktree_gc job]
allowed_paths:
  - backend/app/modules/worktree/service.py
  - backend/app/modules/agent/service.py
  - backend/app/modules/worktree/tests/
---

# task-04 — worktree GC 判据改造 + acquire 回填 + 守护测试

## goal
把 `gc_expired_leases`（worktree/service.py:209）从"纯 expires_at 过期即回收"改造为"关联 agent_run 存活才保留"：关联 run 非终态(pending/running)即使 expires_at 过期也不回收 / 关联终态(completed/failed/killed/cancelled) AND expires_at 过期→回收 / 孤儿(agent_run_id NULL)→原 expires_at 判据；并接通 acquire↔run 的关联链（acquire 加可选 agent_run_id + `_try_acquire_lease` 建表后回填 lease.agent_run_id=run.id），彻底消除长任务目录被误删（D-003@v2，design §7.5 worktree GC 行 / §8.1 回填方案）。

## provides
```yaml
contract: WorktreeService.gc_expired_leases
behavior: 关联 agent_run 非终态→保留 / 终态集{completed,failed,killed,cancelled}+expires_at<now→回收 / agent_run_id NULL→原 expires_at 判据
```

## implementation
1. **acquire 加可选参数**（worktree/service.py:45）：签名加 `agent_run_id: uuid.UUID | None = None`；建 lease 时透传 `agent_run_id=agent_run_id`（line 84-98 的 WorktreeLease(...)）；HTTP 手动 acquire（worktree/router.py:43 不传）走 None=孤儿判据（Grill P2-3）。
2. **_try_acquire_lease 回填**（agent/service.py:1200，acquire 调用在 :1239）：因 acquire 时 AgentRun 尚未创建（run 在 :1120 才建），顺序=① acquire lease（agent_run_id 暂空）；② 建 AgentRun（:1120）；③ commit 前同事务回填 `lease.agent_run_id = run.id`。把 :1239 的 lease 返回值提到 start_stage_dispatch 外层（:1028 `lease` 变量已有），在 :1130 `self._session.add(run)` 后、`await self._session.commit()`(:1131) 前插入 `if lease: lease.agent_run_id = run.id; self._session.add(lease)`，让 run.id 与 lease.agent_run_id 同一次 commit 落库（双向回填，避免鸡生蛋，design §8.1）。
3. **gc_expired_leases 改判据**（worktree/service.py:209）：查 locked lease 时 LEFT JOIN agent_runs（按 lease.agent_run_id）；分三类处置——
   - `agent_run_id IS NULL`（孤儿/HTTP 手动）→ 原 `expires_at < now` 判据回收；
   - `agent_run_id IS NOT NULL AND run.status IN (pending, running)`（非终态=活着）→ **跳过不回收**（即使 expires_at 过期，这是消除误杀的核心）；
   - `agent_run_id IS NOT NULL AND run.status IN (completed, failed, killed, cancelled)`（终态）→ 仅当 `expires_at < now` 才回收（回收前清理文件系统同现状）。
   终态集常量定义在方法顶部 `_TERMINAL = {"completed", "failed", "killed", "cancelled"}`，**必含 cancelled**（否则 cancel 任务的 worktree 永久泄漏，Grill P0-2 / lease_service.py:339 cancel_lease 产 cancelled）。
4. **守护测试**（worktree/tests/，新增或扩 test_service.py）：覆盖 acceptance 全部分支（见下）。
5. 文件系统清理逻辑（:217-220 shred_askpass + cleanup + lease.status="expired"）保持不变，只改"哪些 lease 进入清理循环"的筛选条件。

## 验收标准
- **关联 run 非终态不回收**：建 lease 绑定 status=pending/running 的 AgentRun，即便 expires_at 设为过去，`gc_expired_leases` 返回 0 且 lease.status 仍 locked（守护测试钉死，对应 R-4）。
- **关联终态含 cancelled 回收**：lease 绑定 status=cancelled 的 run + expires_at 过期 → 被回收（status→expired）；同样对 completed/failed/killed 各覆盖一例。
- **孤儿按 expires_at**：agent_run_id=NULL 的 lease，expires_at 过期→回收 / 未过期→保留（零回归现状行为）。
- **acquire 可选**：`acquire(..., agent_run_id=None)` 成功建 lease（agent_run_id 列 NULL）；`acquire(..., agent_run_id=<run.id>)` 落库正确。
- **回填链通**：`_try_acquire_lease` 路径（start_stage_dispatch）建出的 lease.agent_run_id == run.id（同事务回填，非 NULL），且 run.lease_id == lease.id（双向）。
- **零回归**：现有 worktree/tests/ 单测全绿（acquire/release/extend/gc 既有行为不变，仅 gc 筛选条件加严 + acquire 多一可选参数）。

## verify
- `cd backend && pytest app/modules/worktree/tests/ -q`（含新增守护测试，零回归）
- `cd backend && pytest app/modules/agent/tests/ -q -k "stage_dispatch or acquire_lease"`（回填链不破坏现有 stage dispatch 测试）
- `cd backend && ruff check app/modules/worktree/service.py app/modules/agent/service.py`
- `cd backend && mypy app/modules/worktree/service.py app/modules/agent/service.py`
- 手动核对：grep 确认 `cancelled` 出现在 gc_expired_leases 的终态集常量里（防漏导致 cancel 泄漏）。

## constraints
- **终态集必含 cancelled**（design §7.5 / §8.1 Grill P0-2）：lease/service.py:768 现有终态判断 `(completed,failed,killed)` 不含 cancelled，worktree GC 不能照抄，必须自补 cancelled，否则 cancel 任务的 worktree 目录永久泄漏。
- **acquire 参数可选**（design §6 / §8.1 Grill P2-3）：HTTP 手动 acquire（worktree/router.py:43）不传 agent_run_id，默认 None 走孤儿判据；不可强制必填（会破坏 HTTP 路径）。
- **回填因时序倒置**（design §8.1 Grill P0-1）：acquire 在 agent/service.py:1239、AgentRun 建表在 :1120，无法前置传 run.id；必须建 run 后同事务回填，不能改为"先建 run 再 acquire"（会破坏现有 start_stage_dispatch 的 lease→work_dir→prompt→run 流程顺序）。
- **不引入绝对时长超时**（design §2 / 非目标 §3）：GC 只看 agent_run 存活 + expires_at，绝不开"任务跑多久自动过期"，长任务（推理模型长 turn）即便 expires_at 过期只要 run 非终态就保留（核心哲学，interactive-idle-timeout-fix D-003 + knowledge）。
- **LEFT JOIN 防 NULL 歧义**：agent_run_id NULL 的孤儿 lease 不能因 JOIN 丢行，用 LEFT JOIN + `run.status IS NULL OR run.status IN _TERMINAL` 正确归类。
- 消费 task-01 的 `WorktreeLease.agent_run_id` 字段 + task-02 的 `LeaseReaperService._run_worktree_gc` job 调用方（本任务不改 reaper，只让 gc_expired_leases 的新判据就绪供 task-02 的 job 调用）。
---
