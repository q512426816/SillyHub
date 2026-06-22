---
id: task-06
title: DaemonService.lease_* 迁入 lease/service.py（LeaseService）+ _build_claim_payload 迁入 lease/context.py；lease_service.py（DaemonLeaseService）原位不动
priority: P0
depends_on: [task-01]
blocks: [task-07]
requirement_ids: [FR-02, FR-03]
decision_ids: [D-003@v1]
author: qinyi
created_at: 2026-06-22T10:21:00+08:00
---

# task-06

> Wave 6（依赖 W1 facade 安全网）。本 task 把 `DaemonService` 中 lease 正向生命周期的 8 个方法 + `_build_claim_payload` + `_get_lease_and_verify_token` 迁入新 `lease/` 子包。
> **D-003@v1 铁律**：`lease_service.py`（`DaemonLeaseService`）原位不动，`agent/service.py:545` 的 `from app.modules.daemon.lease_service import DaemonLeaseService` 路径不变。
> 变更来源：design.md §1（lease 并存说明）/ §3 N2 / §5.2 目录 / §5.3 W6 / §6 文件清单 / §7.5 lease 契约表 + decisions.md D-003@v1。

## 修改文件

| 操作 | 文件路径 | 说明 |
|------|---------|------|
| 新增 | `backend/app/modules/daemon/lease/__init__.py` | 导出 `LeaseService`（**不** re-export `DaemonLeaseService`，它在隔壁 `lease_service.py`，agent 直接从那 import） |
| 新增 | `backend/app/modules/daemon/lease/service.py` | `LeaseService`：承接 `DaemonService.lease_*` 8 方法 + `_get_lease_and_verify_token` |
| 新增 | `backend/app/modules/daemon/lease/context.py` | `_build_claim_payload`（~123 行，模块级函数，接受 session 与 lease 参数） |
| 修改 | `backend/app/modules/daemon/service.py` | facade：删除已迁出的 8 方法 + `_build_claim_payload` + `_get_lease_and_verify_token` 的方法体，改为 8 个 `lease_*` / lease 正向方法的委托调用；lease 异常类**暂留** service.py（task-07 再迁） |
| **不动** | `backend/app/modules/daemon/lease_service.py` | `DaemonLeaseService` 原位保留（D-003@v1 铁律） |

## 覆盖来源（FR-02, FR-03, D-003@v1）

- **FR-02**：`DaemonService` 的 lease_* 8 方法 + `_build_claim_payload` + `_get_lease_and_verify_token` 归位到 `lease/service.py` 与 `lease/context.py`，facade 退化为委托。
- **FR-03**：`DaemonLeaseService`（`lease_service.py`）原位不动，`agent/service.py:545` 的 import 路径与 `cancel_lease` 行为零变更，活契约保持。
- **D-003@v1**：本次仅迁 `DaemonService.lease_*`；`DaemonLeaseService` 不并入、不 re-export、不移动。`lease/__init__.py` 仅导出 `LeaseService`。两者方法集（claim/heartbeat/expire）部分重叠是否统一留独立评估。

## 实现要求

1. **新建 `lease/service.py` → `LeaseService`**：接收 `session: AsyncSession` 构造（与 `DaemonService` 一致，`self._session = session`）。把以下 8 个方法 + 1 个内部辅助方法**逐字搬入**（含 docstring、gap/ql 注释、终态优先级护栏等全部业务逻辑），仅 `self._session` 指向不变、对 `_build_claim_payload` 的调用改指向 `lease.context`：

   - `create_lease(self, runtime_id, *, agent_run_id=None, ttl_seconds=3600) -> DaemonTaskLease`（service.py:502）
   - `claim_lease(self, lease_id, runtime_id) -> tuple[DaemonTaskLease, dict]`（service.py:535）— 内部 `await self._build_claim_payload(lease)` 改为 `await build_claim_payload(self._session, lease)`（从 `lease.context` import）
   - `start_lease(self, lease_id, claim_token) -> DaemonTaskLease`（service.py:726）
   - `lease_heartbeat(self, lease_id, claim_token) -> DaemonTaskLease`（service.py:784）
   - `complete_lease(self, lease_id, claim_token, result) -> DaemonTaskLease`（service.py:796）— 内部跨域调用（`_apply_patch_to_worktree` / `_run_post_scan_validation` / `_trigger_stage_completion_callback`）通过**构造期持有引用**或 **lazy import** 调用 `PatchService` / `RunSyncService`（避免模块级循环 import，遵循 design §7.2 约定）
   - `get_lease(self, lease_id) -> DaemonTaskLease | None`（service.py:1301）
   - `list_leases(self, runtime_id) -> list[DaemonTaskLease]`（service.py:1305）
   - `expire_leases(self) -> list[DaemonTaskLease]`（service.py:1314）
   - `_get_lease_and_verify_token(self, lease_id, claim_token) -> DaemonTaskLease`（service.py:3301，私有辅助，随主方法归位）

2. **新建 `lease/context.py` → `build_claim_payload`**：把 service.py:602 的 `_build_claim_payload(self, lease)` 完整逻辑（~123 行，含 interactive 分支、batch 分支、runtime capabilities 提取、redact 等）改为**模块级函数** `async def build_claim_payload(session: AsyncSession, lease: DaemonTaskLease) -> dict`。原方法体内所有 `self._session` → `session`。保持 payload 字段、camelCase/snake_case 双写、interactive 提前 return 等全部行为不变。

3. **lease 异常类暂留 `service.py`**：`DaemonLeaseNotFound` / `DaemonLeaseNotPending` / `DaemonLeaseNotClaimed` / `DaemonInvalidClaimToken` / `DaemonAgentRunNotFound` / `DaemonLeaseNoAgentRun`（service.py:48-83）**本 task 不迁**，留在 `service.py` 顶部。`lease/service.py` 通过 `from app.modules.daemon.service import DaemonLeaseNotFound, DaemonLeaseNotPending, DaemonLeaseNotClaimed, DaemonInvalidClaimToken, DaemonAgentRunNotFound, DaemonLeaseNoAgentRun, DaemonRuntimeNotFound, PatchConflictError, PatchApplyError` import。task-07 统一处理异常类迁移与 facade re-export。

4. **facade 改委托**：`DaemonService.__init__` 已在 task-01 持有 `self._lease = LeaseService(session)`；本 task 把 facade 上 8 个 lease 方法体从原逻辑替换为单行委托（如 `return await self._lease.create_lease(runtime_id, agent_run_id=agent_run_id, ttl_seconds=ttl_seconds)`），并**删除** facade 上的 `_build_claim_payload` / `_get_lease_and_verify_token` 方法（它们只被 lease_* 内部调用，迁出后 facade 不再需要）。`_apply_patch_to_worktree` / `_run_post_scan_validation` / `_trigger_stage_completion_callback` 不在本 task 迁移范围（分别归 patch / run_sync 子域，由 task-03 / task-04 处理；本 task 在 facade 上保留它们的同名委托或原逻辑不动）。

5. **`lease/__init__.py`**：仅 `from app.modules.daemon.lease.service import LeaseService` + `__all__ = ["LeaseService"]`。**不** import / re-export `DaemonLeaseService`（它在 `lease_service.py`，agent 直接从那 import，design §6 / decisions D-003@v1 明确）。

6. **行为零变更**：纯文件移动 + import 整理，**不动**任何业务逻辑、状态机、字段定义、日志 key、异常类型、Redis pub/sub channel。§7.5 lease 契约表每行事件的承载位置从 `service.py` → `lease/service.py`，契约本身不变。

## 接口定义

### `LeaseService`（`lease/service.py`）

```python
class LeaseService:
    """Daemon lease 正向生命周期管理（create/claim/start/heartbeat/complete/get/list/expire）。

    由 DaemonService.lease_* 迁入（2026-06-22-daemon-service-split task-06）。
    与 lease_service.py 的 DaemonLeaseService 并存（分管不同操作，见 D-003@v1）。
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create_lease(
        self,
        runtime_id: uuid.UUID,
        *,
        agent_run_id: uuid.UUID | None = None,
        ttl_seconds: int = 3600,
    ) -> DaemonTaskLease: ...

    async def claim_lease(
        self,
        lease_id: uuid.UUID,
        runtime_id: uuid.UUID,
    ) -> tuple[DaemonTaskLease, dict]:
        # 内部: payload = await build_claim_payload(self._session, lease)
        ...

    async def start_lease(
        self, lease_id: uuid.UUID, claim_token: str
    ) -> DaemonTaskLease: ...

    async def lease_heartbeat(
        self, lease_id: uuid.UUID, claim_token: str
    ) -> DaemonTaskLease: ...

    async def complete_lease(
        self,
        lease_id: uuid.UUID,
        claim_token: str,
        result: dict,
    ) -> DaemonTaskLease: ...
        # 跨域调用（lazy import / 持有引用，避免循环）：
        #   - PatchService.apply_patch_to_worktree （patch 子域，task-03 迁后）
        #   - RunSyncService._run_post_scan_validation / _trigger_stage_completion_callback
        #     （run_sync 子域，task-04 迁后）
        # task-06 阶段 facade 上这些方法仍在，可暂走 `DaemonService(self._session)._apply_patch_to_worktree(...)`
        # 或 lazy import；task-03/04 完成后改为直调子 service。

    async def get_lease(self, lease_id: uuid.UUID) -> DaemonTaskLease | None: ...

    async def list_leases(self, runtime_id: uuid.UUID) -> list[DaemonTaskLease]: ...

    async def expire_leases(self) -> list[DaemonTaskLease]: ...

    async def _get_lease_and_verify_token(
        self, lease_id: uuid.UUID, claim_token: str
    ) -> DaemonTaskLease: ...
```

### `_build_claim_payload` → `build_claim_payload`（`lease/context.py`，模块级函数）

```python
async def build_claim_payload(session: AsyncSession, lease: DaemonTaskLease) -> dict:
    """Build execution context payload for a claimed lease.

    原 DaemonService._build_claim_payload（service.py:602，~123 行），迁为模块级函数。
    行为零变更：interactive 分支提前 return；batch 分支 agent_run_id NULL 校验
    （DaemonLeaseNoAgentRun）、AgentRun 字段提取、workspace_id、lease metadata 透传
    （prompt/provider/model/repo_url/branch/tool_config/workspace_*/root_path 等）、
    runtime capabilities（cmd_path/protocol）。
    """
    # 方法体内 self._session → session；其余逐字搬入
    ...
```

### `lease/__init__.py`

```python
"""daemon lease 子包 —— lease 正向生命周期（create/claim/start/heartbeat/complete/get/list/expire）。

注意：DaemonLeaseService（cancel_lease 等）在隔壁 lease_service.py，agent 跨模块
import 它（D-003@v1，原位不动），本 __init__ 不 re-export。
"""

from app.modules.daemon.lease.service import LeaseService

__all__ = ["LeaseService"]
```

### facade 委托伪代码（`service.py`）

```python
class DaemonService:
    def __init__(self, session: AsyncSession) -> None:
        ...
        self._lease = LeaseService(session)
        ...

    # ── Lease operations（委托 LeaseService） ─────────────────────────────
    async def create_lease(self, runtime_id, *, agent_run_id=None, ttl_seconds=3600):
        return await self._lease.create_lease(
            runtime_id, agent_run_id=agent_run_id, ttl_seconds=ttl_seconds
        )

    async def claim_lease(self, lease_id, runtime_id):
        return await self._lease.claim_lease(lease_id, runtime_id)

    async def start_lease(self, lease_id, claim_token):
        return await self._lease.start_lease(lease_id, claim_token)

    async def lease_heartbeat(self, lease_id, claim_token):
        return await self._lease.lease_heartbeat(lease_id, claim_token)

    async def complete_lease(self, lease_id, claim_token, result):
        return await self._lease.complete_lease(lease_id, claim_token, result)

    async def get_lease(self, lease_id):
        return await self._lease.get_lease(lease_id)

    async def list_leases(self, runtime_id):
        return await self._lease.list_leases(runtime_id)

    async def expire_leases(self):
        return await self._lease.expire_leases()

    # 原 _build_claim_payload / _get_lease_and_verify_token 从 facade 删除
    # （它们仅被 lease_* 内部调用，已随方法迁入 lease/）
```

## 边界处理

1. **DaemonLeaseService 原位不动是铁律（D-003@v1）**：`lease_service.py` 文件不新增 / 不删除 / 不修改一字。`DaemonLeaseService` 及其异常类（`LeaseConflict` / `LeaseNotFound` / `LeaseTokenMismatch` / `LeaseNotClaimable`）保持原样。本 task 不 read / 不 write 这个文件。
2. **agent import 路径不变（FR-03）**：`agent/service.py:545` 的 `from app.modules.daemon.lease_service import DaemonLeaseService` 与 `cancel_lease` 调用零变更。验收时必须 import 成功 + `cancel_lease` 行为不变。
3. **`_build_claim_payload` 归属 `lease/context.py`（非 `lease/service.py`）**：遵循 design §5.2 目录结构与 §6 文件清单。作为模块级函数 `build_claim_payload(session, lease)`，由 `LeaseService.claim_lease` 调用。保持 ~123 行逻辑、所有 gap-5 / ql 注释、camelCase + snake_case 双写字段名不变。
4. **lease 异常类暂留 `service.py`（task-07 迁）**：`DaemonLeaseNotFound` 等 6 个 lease 相关异常 + `DaemonRuntimeNotFound` + `PatchConflictError` / `PatchApplyError` **本 task 不迁**，留在 facade `service.py` 顶部，`lease/service.py` 从 `service` 反向 import。task-07 统一迁入子包 + facade re-export，保持 `router.py:55` 的 9 异常类 import 路径兼容。
5. **LeaseService 与 DaemonLeaseService 并存非合并**：两者分管 lease 不同操作（`LeaseService` = 正向生命周期，被 daemon/router 调用；`DaemonLeaseService` = cancel 能力 + 部分重叠方法，被 agent 跨模块调用）。方法集部分重叠（claim/heartbeat/expire）的统一评估留独立变更（design §10 R5、decisions D-003@v1 理由 2）。本 task 不做任何合并尝试。
6. **跨子域调用避免循环 import**：`LeaseService.complete_lease` 调用 patch / run_sync 的方法时，用 **lazy import**（函数内 import）或 **构造期持有对方引用**（design §7.2）。task-06 阶段 patch / run_sync 子 service 可能尚未就位（取决于执行顺序），允许暂走 `DaemonService(self._session)._apply_patch_to_worktree(...)` 的兼容路径；task-03 / task-04 完成后改直调子 service，本 task 写注释标记 TODO。
7. **facade 删除纯内部辅助**：`_build_claim_payload` / `_get_lease_and_verify_token` 是 lease_* 的私有辅助，迁出后 facade 不再需要同名委托。若 facade 上其他子域（session/run_sync）历史上直接调过 `_get_lease_and_verify_token`，改走 `self._lease._get_lease_and_verify_token(...)` 或保留 facade 同名委托（执行时 grep `service.py` 内部调用点确认；design §7.1 注：原私有方法在 facade 保留同名委托的规则适用于被外部/其他子域引用的情况）。

## 非目标

- **不合并两套 lease**：`LeaseService` 与 `DaemonLeaseService` 保持并存（D-003@v1），统一评估留独立变更。
- **不动 `lease_service.py`**：文件原位、零修改（包括其异常类 `LeaseConflict` 等）。
- **不动异常 re-export**：lease 异常类暂留 facade `service.py`，task-07 统一迁子包 + re-export。本 task 不动 `router.py:55` 的任何 import 路径。
- **不改 lease 状态机 / 字段 / 日志 key / Redis channel**：§7.5 lease 契约表零变更，仅承载代码位置变。
- **不迁跨域辅助**：`_apply_patch_to_worktree`（→ patch，task-03）、`_run_post_scan_validation` / `_trigger_stage_completion_callback`（→ run_sync，task-04）不在本 task 范围；complete_lease 对它们的调用改走子 service 引用即可。

## 参考

- `decisions.md` D-003@v1（lease 处理：DaemonLeaseService 原位保留，仅迁 DaemonService.lease_*）
- `design.md` §1（lease 并存说明：两 service 分管不同操作，各有活调用方）、§3 N2（不合并/不迁移 DaemonLeaseService）、§5.2（lease/ 目录结构：service.py + context.py + __init__.py）、§5.3 W6（迁移范围）、§6（文件清单：lease/* 三个新增 + service.py 修改 + lease_service.py 不动）、§7.5 lease 契约表（create/claim/start/heartbeat/complete/expire 状态转移 + 并存说明）
- `plan.md` task-06 行（W6，覆盖 FR-02/FR-03/D-003）
- 源代码：
  - `backend/app/modules/daemon/service.py:502-967`（create_lease / claim_lease / _build_claim_payload / start_lease / lease_heartbeat / complete_lease）
  - `backend/app/modules/daemon/service.py:1301-1332`（get_lease / list_leases / expire_leases）
  - `backend/app/modules/daemon/service.py:3301-3321`（_get_lease_and_verify_token）
  - `backend/app/modules/daemon/service.py:48-83`（lease 异常类，暂留）
  - `backend/app/modules/daemon/lease_service.py`（DaemonLeaseService 全貌，原位不动）
  - `backend/app/modules/agent/service.py:545-547`（from app.modules.daemon.lease_service import DaemonLeaseService + cancel_lease 调用，活契约证据）

## TDD 步骤

1. **先读全量源**：读 `service.py:502-967, 1301-1332, 3301-3321` + `lease_service.py` + `agent/service.py:540-550`，确认迁出清单与契约。
2. **新建 `lease/context.py`**：把 `_build_claim_payload` 改为 `build_claim_payload(session, lease)` 模块级函数，逐字搬运（self._session → session）。跑 `python -c "from app.modules.daemon.lease.context import build_claim_payload"` 确认 import 可用。
3. **新建 `lease/service.py`**：`LeaseService` 类 + 8 方法 + `_get_lease_and_verify_token`，异常类从 `service` 反向 import，`claim_lease` 内部调 `build_claim_payload`，`complete_lease` 跨域调用走 lazy import / 持有引用。跑 `python -c "from app.modules.daemon.lease.service import LeaseService"` 确认。
4. **新建 `lease/__init__.py`**：仅导出 `LeaseService`。
5. **改 facade `service.py`**：8 个 lease_* 方法体改委托，删除 `_build_claim_payload` / `_get_lease_and_verify_token`（grep 确认无 facade 其他子域引用后再删，有则保留同名委托）。
6. **跑测试**（关键）：
   - `pytest backend/app/modules/daemon/tests/test_lease_service.py -v`（lease 正向生命周期全用例必须通过，行为零变更）
   - `pytest backend/app/modules/daemon/tests/test_lease_kind_model.py -v`（lease kind 模型相关）
   - `pytest backend/app/modules/agent/tests/ -k "kill or cancel or lease" -v`（**验证 agent/service.py:545 的 cancel_lease 调用仍可用**，FR-03 活契约保持）
   - `make backend-test`（daemon 全测 + agent 全测通过，确保无回归）
   - `make backend-lint`（ruff + mypy 通过）
7. **D-003@v1 活契约验证**：在 Python REPL 跑 `from app.modules.daemon.lease_service import DaemonLeaseService`，确认 import 成功 + 类位置不变；跑 `from app.modules.daemon.lease import LeaseService` 确认新子包导出正常。

## 验收标准

| AC # | 条目 | 验证方式 |
|------|------|---------|
| AC-01 | `lease/service.py` 定义 `LeaseService`，含 8 方法（create_lease/claim_lease/start_lease/lease_heartbeat/complete_lease/get_lease/list_leases/expire_leases）+ `_get_lease_and_verify_token`，方法签名与原 `DaemonService` 同名方法**逐位一致** | grep + diff 迁移前后签名 |
| AC-02 | `lease/context.py` 定义模块级 `async def build_claim_payload(session, lease) -> dict`，逻辑逐字等价于原 `_build_claim_payload`（~123 行，含 interactive/batch 分支、双写字段、capabilities 提取） | 代码 review + test_lease_service 通过 |
| AC-03 | `lease/__init__.py` 仅 `__all__ = ["LeaseService"]`，**不** import / re-export `DaemonLeaseService` | grep `DaemonLeaseService` 在 `lease/__init__.py` 应无命中 |
| AC-04 | facade `DaemonService` 上 8 个 lease_* 方法改为单行委托 `self._lease.*`，无业务逻辑残留；`_build_claim_payload` / `_get_lease_and_verify_token` 从 facade 删除（或保留同名委托如有外部引用） | grep `class DaemonService` + 审视方法体 |
| AC-05 | `lease_service.py` **零修改**（`git diff backend/app/modules/daemon/lease_service.py` 为空）— D-003@v1 铁律 | `git diff --stat` 该文件无行 |
| AC-06 | `from app.modules.daemon.lease_service import DaemonLeaseService` 在 agent 与新 lease 子包均可 import 成功，`agent/service.py:545` 的 `cancel_lease` 调用行为不变 | python REPL + agent kill 测试通过 |
| AC-07 | lease 异常类（`DaemonLeaseNotFound` 等 6 个 + `DaemonRuntimeNotFound`）仍定义在 `service.py` 顶部，`lease/service.py` 从 `service` import；`router.py:55` 的 9 异常类 import 路径不变 | grep + `router.py` git diff 为空 |
| AC-08 | `pytest backend/app/modules/daemon/tests/test_lease_service.py` 全部通过（lease 正向生命周期行为零变更） | 测试报告 |
| AC-09 | `pytest backend/app/modules/agent/tests/ -k "kill or cancel"` 通过（FR-03 活契约保持） | 测试报告 |
| AC-10 | `make backend-test` + `make backend-lint`（ruff + mypy）全部通过，无回归 | CI/本地全绿 |
| AC-11 | `git diff backend/app/modules/daemon/router.py` 为空（facade 兼容，router 零改动 — design §6） | git diff |
| AC-12 | `LeaseService` 与 `DaemonLeaseService` 并存（非合并），两者方法集部分重叠的统一评估留独立变更（本 task 不处理） | 代码 review 确认无合并尝试 |
