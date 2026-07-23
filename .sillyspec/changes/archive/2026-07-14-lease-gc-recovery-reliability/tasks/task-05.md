---
id: task-05
title: DaemonLeaseService 死代码清理
title_zh: DaemonLeaseService 死代码清理（删 expire_overdue_leases + 残留正向方法）
author: qinyi
created_at: 2026-07-14 11:01:53
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/daemon/lease_service.py
  - backend/app/modules/daemon/tests/test_lease_service.py
---

# TaskCard — task-05

## goal
清理 `DaemonLeaseService`（lease_service.py）上的死代码：删 `expire_overdue_leases`（docstring 谎报"每分钟执行"）+ 残留正向 claim/heartbeat 方法（零生产引用，仅 test 调用），统一 lease service 表面。保留 `cancel_lease` / `_send_interactive_cancel`（cancel 链路活）。

## implementation
1. 删 `DaemonLeaseService.expire_overdue_leases`（lease_service.py:239-277，docstring 谎报"定时任务每分钟执行"，全仓库零生产调用，仅 test_lease_service.py:333/343/363 调用）。
2. 删 `DaemonLeaseService` 上残留的正向生命周期方法（`claim_task`:74 + `heartbeat_lease`:198 + 依赖的内部 `_validate_claim_token`/`validate_claim_token` 若仅服务于上述则一并清理）：零生产引用（DaemonService facade `self._lease = LeaseService(session)`，正向方法委托 `lease/service.py::LeaseService` 而非本类）。生产实例化点 control.py:96/102 + agent/service.py:585/587 仅调 `cancel_lease`/kill。
3. 保留 `cancel_lease`（lease_service.py:281）+ `_mark_agent_run_killed_if_pending`（:368）+ `_send_interactive_cancel`（:461）：cancel/kill 链路活，被 control.py + agent/service.py 调用。
4. 删对应死方法测试：`TestExpireOverdueLeases`（test_lease_service.py:301-364 整个 class）+ `TestClaimTask`（:143-225）+ `TestHeartbeatLease`（:228-298）；保留 `TestCancelLease`/`TestValidateClaimToken`（若 validate_claim_token 仅服务于删掉的 heartbeat 则连测带删，保留的就留）。
5. 保留 domain error 类（`LeaseConflict`/`LeaseNotFound`/`LeaseTokenMismatch`/`LeaseNotClaimable`）若仍被保留方法引用则留，否则随用随删。

## 验收标准
- [ ] `lease_service.py` 不再含 `expire_overdue_leases`/`claim_task`/`heartbeat_lease` 定义（grep 零命中）。
- [ ] `lease_service.py` 仍含 `cancel_lease` / `_send_interactive_cancel`（cancel 链路完整）。
- [ ] `lease/service.py:706 expire_leases` 原样保留（活代码，被 `handle_expired_leases_batch`:861 调用，是 lease GC 入口，未触碰）。
- [ ] `test_lease_service.py` 删除的 class 不再出现，剩余 cancel/validate 测试通过。

## verify
- [ ] `cd backend && pytest app/modules/daemon/tests/test_lease_service.py -q` 全绿（删测后剩余用例通过）。
- [ ] `cd backend && ruff check app/modules/daemon/lease_service.py app/modules/daemon/tests/test_lease_service.py` 无 lint 报错（删方法后 import 清理）。
- [ ] `cd backend && mypy app/modules/daemon/lease_service.py` 无类型报错。
- [ ] `grep -rn "expire_overdue_leases\|claim_task\|heartbeat_lease" backend/app/modules/daemon/lease_service.py` 零命中。
- [ ] `grep -rn "expire_leases" backend/app/modules/daemon/lease/service.py` 命中 :706（确认未误删）。

## constraints
- 只改 `lease_service.py` + `test_lease_service.py`（allowed_paths），不碰 lease/service.py。
- 保留 `cancel_lease`（:281）+ `_send_interactive_cancel`（:461）：cancel 链路活（D-001@v1），control.py + agent/service.py 依赖。
- 保留 `lease/service.py:706 expire_leases`（活代码，被 `handle_expired_leases_batch`:861 调用，是 lease GC 入口，勿误删；Grill P1-2 澄清 D-002 只删 lease_service.py:239 那个）。
- 只删 `lease_service.py:239 expire_overdue_leases` + 残留正向 claim/heartbeat 方法；删方法后同步删 test 对应 class 与失效 import。
- validate_claim_token：若仅服务于删掉的 heartbeat_lease 则连方法带测试删；若 cancel 链路仍需则保留。
- 测试逻辑本身有误才禁改；本任务是删死方法对应测试（测试删而非改逻辑过）。
