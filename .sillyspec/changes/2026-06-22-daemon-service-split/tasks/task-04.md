---
id: task-04
title: run_sync 方法（AgentRun 状态同步）迁入 run_sync/service.py（RunSyncService），facade 改委托
priority: P0
depends_on: [task-01]
blocks: [task-07]
requirement_ids: [FR-02, FR-04]
decision_ids: []
author: qinyi
created_at: 2026-06-22T10:21:00+08:00
---

# task-04

> 变更：`2026-06-22-daemon-service-split`
> Wave：W4（依赖 W1 安全网 task-01；阻塞收尾 task-07）
> 依据：design §5.1 归位判据 / §6 文件变更清单 / §7.1 facade 接口 / §7.5 AgentRun 状态同步契约表 / §10 R6 `_publish_run_event` 归属；plan.md task-04；requirements.md FR-02、FR-04。
> 约束：纯结构重构，**行为不变**。方法体整体搬移不改逻辑；`router.py` 零改动；AgentRun 状态机 / 事件 / 字段定义不变（FR-04）。

---

## 修改文件

| 操作 | 文件路径 | 说明 |
|------|---------|------|
| 新增 | `backend/app/modules/daemon/run_sync/service.py` | `RunSyncService`：承接 6 个 run_sync 方法（3 public + 3 private helper） |
| 新增 | `backend/app/modules/daemon/run_sync/__init__.py` | 子包入口（空壳，task-01 已建，本 task 不动） |
| 修改 | `backend/app/modules/daemon/service.py` | facade `DaemonService` 中 6 个对应方法体删除，改为 `self._run.xxx(...)` 委托 |

> `__init__.py` 在 task-01 已建空壳，本 task 仅写 `run_sync/service.py`；如 `__init__.py` 需要导出 `RunSyncService`（供 facade 持有引用），按 task-01 既有约定补一行（若已存在则不动）。

---

## 覆盖来源(FR-02, FR-04)

| 需求 | 覆盖点 | 本 task 证据 |
|------|--------|------------|
| **FR-02**（51 方法按子域归位，5 子包分层） | 6 个 run_sync 方法从 `DaemonService` 迁入 `RunSyncService`；facade 同名方法改委托；无遗漏 | design §6 文件清单第 7 行、§7.1 facade 接口 run_sync 区段 |
| **FR-04**（生命周期契约不变） | AgentRun 状态同步生命周期（design §7.5 第 3 张表）4 个事件（sync / close / submit / post_scan）承载代码从 facade 迁至 `run_sync/service.py`，状态机/事件/字段定义零变更 | design §7.5 AgentRun 状态同步表 + §12 自审 |

---

## 实现要求

1. **方法整体迁出**：6 个方法的完整方法体（含 docstring、行内注释、ql-xxxx 修复注释）从 `service.py` 的 `DaemonService` 类体内**逐字**迁入 `run_sync/service.py` 的 `RunSyncService` 类体内；不做逻辑改写、不"顺手清理"注释、不合并/拆分语句。
2. **self._session 一致性**：迁入 `RunSyncService` 后，原方法体内所有 `self._session` 保持不变（`RunSyncService.__init__` 持有同名的 `self._session`）；所有 `self._get_lease_and_verify_token(...)` / `self._publish_session_event(...)` / `self._publish_run_event(...)` 调用方需改为跨子域调用（见"接口定义"伪代码）。
3. **import 保留**（来自 design §1 / §7.5）：
   - `from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession` —— **保留**（迁入 `run_sync/service.py` 顶部；`AgentSession` 虽仅 `_publish_session_event` 等方法间接用，但原 import 一并保留以免遗漏）。
   - `from app.modules.agent.post_scan_validator import PostScanValidator` —— **保留**（`_run_post_scan_validation` 内部 lazy import，位置不变）。
4. **lazy import 保留**：`_trigger_stage_completion_callback` 内的 `from app.modules.change.dispatch import SillySpecStageDispatchService, auto_dispatch_next_step` 与 `from app.modules.change.model import Change` 保持函数内 lazy import，不提升为模块级（避免循环引用风险）。
5. **大方法（200 行+）整体迁**：`submit_messages`（约 213 行，含 ql-20260617 / ql-20260616 多段修复注释 + 双 publish 分支）、`close_interactive_run`（约 197 行，含 SDK 透传字段 + 双 publish 分支）按原顺序原样搬移，**不改逻辑、不调缩进风格、不动参数默认值**。
6. **TERMINAL_TURN_STATUSES 常量**：`close_interactive_run` 引用的 `TERMINAL_TURN_STATUSES` frozenset 归 **session 子域**（见 tasks.md task-05 列表 + design §7.5 末段注解）；本 task 在 `run_sync/service.py` 内**不重复定义**该常量，通过 `from app.modules.daemon.session.service import TERMINAL_TURN_STATUSES`（或 task-05 已落位的位置）import；**若 task-05 尚未完成**（W4 串行早于 W5），先从 `from app.modules.daemon.service import TERMINAL_TURN_STATUSES`（facade re-export 或 service.py 既有位置）import，task-05 落位后该 import 路径随 task-05 / task-07 re-export 统一。
7. **facade 改委托**：`service.py` 的 `DaemonService` 中 6 个方法体替换为一行委托（签名保持完全一致，含 `*`、关键字-only、默认值 None 等）。
8. **跨子域辅助调用**（详见"接口定义"伪代码）：
   - `self._get_lease_and_verify_token(lease_id, claim_token)` —— lease 子域（task-06），改为 `await self._lease._get_lease_and_verify_token(...)` 或在 `RunSyncService.__init__` 持有 `LeaseService` 引用；**W4 串行早于 W6**，此时 `_get_lease_and_verify_token` 仍在 facade（`DaemonService`）上，采用"持有 facade / DaemonService 引用"或"函数内 lazy import + 临时实例化 LeaseService"任一可行策略——优先**在 `RunSyncService.__init__` 注入 `_get_lease_and_verify_token` 的可调用引用**（由 facade 在持有子 service 时反向传入），避免 W4/W6 顺序耦合。execute 时按当时 W6 状态选择最简洁路径并在此文档补记实际选择。
   - `self._publish_session_event(session_id, payload)` —— session 子域（task-05），同理处理。W4 早于 W5，采用相同的"注入引用"或"facade 反向委托"策略。
   - `self._publish_run_event(...)` —— 本 task 归 **run_sync**（主对象为 AgentRun，design §10 R6），随主方法一起迁入 `RunSyncService`，无跨域问题。但 `handle_lease_expiry`（lease 子域，task-06）会调用它 → 详见"边界处理"第 5 条。

---

## 接口定义

### RunSyncService（`run_sync/service.py`）

```python
"""Run-sync sub-service — owns the AgentRun state machine (sync / close / messages / post-scan).

Migrated verbatim from DaemonService in change 2026-06-22-daemon-service-split (W4).
Behavior unchanged; see design §7.5 AgentRun status-sync lifecycle table.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.core.redis import get_redis
from app.core.logging import get_logger
from app.modules.agent.model import AgentRun, AgentRunLog  # AgentRunLog 用于 submit_messages
from app.modules.daemon.model import DaemonTaskLease

# 依赖跨子域的常量与辅助 —— import 策略见“实现要求”第 6/8 条，execute 按当时落位状态选择路径：
#   TERMINAL_TURN_STATUSES：session 子域（task-05）
#   _get_lease_and_verify_token：lease 子域（task-06）
#   _publish_session_event：session 子域（task-05）
# task-05/task-06 未落位时，从 facade（app.modules.daemon.service）import；落位后随 re-export 统一。

log = get_logger(__name__)


class RunSyncService:
    """AgentRun 状态同步子 service。构造接 AsyncSession。"""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        # 跨子域辅助注入点 —— 见“实现要求”第 8 条与 design §7.2：
        # execute 时选择“持有对方 service 引用”或“lazy import + 局部实例化”之一，
        # 避免 W4↔W5/W6 顺序耦合与模块级循环 import。
        # self._lease = ...        # for _get_lease_and_verify_token
        # self._session_svc = ...  # for _publish_session_event

    # ── public ────────────────────────────────────────────────────────────

    async def submit_messages(
        self,
        lease_id: uuid.UUID,
        claim_token: str,
        agent_run_id: uuid.UUID,
        messages: list[dict],
    ) -> int:
        """（方法体从 DaemonService.submit_messages 逐字迁入，~213 行不改逻辑）"""
        ...

    async def sync_agent_run_status(
        self,
        lease_id: uuid.UUID,
        claim_token: str,
        status: str,
        *,
        error: str | None = None,
    ) -> AgentRun | None:
        """（方法体从 DaemonService.sync_agent_run_status 逐字迁入）"""
        ...

    async def close_interactive_run(
        self,
        lease_id: uuid.UUID,
        run_id: uuid.UUID,
        claim_token: str,
        *,
        status: str,
        is_error: bool,
        subtype: str | None = None,
        result_summary: str | None = None,
        total_cost_usd: float | None = None,
        num_turns: int | None = None,
        duration_ms: int | None = None,
        duration_api_ms: int | None = None,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
    ) -> AgentRun:
        """（方法体从 DaemonService.close_interactive_run 逐字迁入，~197 行不改逻辑）"""
        ...

    # ── private helpers（随主方法归位，design §6 / §10 R6） ───────────────

    async def _trigger_stage_completion_callback(self, agent_run_id: uuid.UUID) -> None:
        """A2: stage dispatch 的 AgentRun 完成后同步 sillyspec.db 并推进下一阶段。
        （方法体逐字迁入，含 dispatch.py / change.model 的 lazy import）"""
        ...

    async def _run_post_scan_validation(self, lease: DaemonTaskLease) -> None:
        """C: scan 完成后跑平台侧结构化校验（PostScanValidator）。
        （方法体逐字迁入，含 agent.post_scan_validator lazy import）"""
        ...

    async def _publish_run_event(
        self,
        agent_run_id: UUID,
        *,
        event: str,
        status: str,
        **extra: object,
    ) -> None:
        """Publish a Redis event for an AgentRun status change.
        （方法体逐字迁入 —— design §10 R6：run 事件归 run_sync 子域）"""
        ...
```

### facade 委托伪代码（`service.py` 中 `DaemonService`）

```python
class DaemonService:
    def __init__(self, session: AsyncSession) -> None:
        ...
        self._run = RunSyncService(session)
        # 若 W4 采用“注入跨子域辅助”策略，在此把 _lease / _session_svc 引用回填给 self._run
        # （见“实现要求”第 8 条；若用 lazy import 则无需回填）
        ...

    # ── run_sync（委托，签名不变）─────────────────────────────────────────
    async def submit_messages(
        self,
        lease_id: uuid.UUID,
        claim_token: str,
        agent_run_id: uuid.UUID,
        messages: list[dict],
    ) -> int:
        return await self._run.submit_messages(lease_id, claim_token, agent_run_id, messages)

    async def sync_agent_run_status(
        self,
        lease_id: uuid.UUID,
        claim_token: str,
        status: str,
        *,
        error: str | None = None,
    ) -> AgentRun | None:
        return await self._run.sync_agent_run_status(lease_id, claim_token, status, error=error)

    async def close_interactive_run(
        self,
        lease_id: uuid.UUID,
        run_id: uuid.UUID,
        claim_token: str,
        *,
        status: str,
        is_error: bool,
        subtype: str | None = None,
        result_summary: str | None = None,
        total_cost_usd: float | None = None,
        num_turns: int | None = None,
        duration_ms: int | None = None,
        duration_api_ms: int | None = None,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
    ) -> AgentRun:
        return await self._run.close_interactive_run(
            lease_id,
            run_id,
            claim_token,
            status=status,
            is_error=is_error,
            subtype=subtype,
            result_summary=result_summary,
            total_cost_usd=total_cost_usd,
            num_turns=num_turns,
            duration_ms=duration_ms,
            duration_api_ms=duration_api_ms,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )

    async def _trigger_stage_completion_callback(self, agent_run_id: uuid.UUID) -> None:
        return await self._run._trigger_stage_completion_callback(agent_run_id)

    async def _run_post_scan_validation(self, lease: DaemonTaskLease) -> None:
        return await self._run._run_post_scan_validation(lease)

    async def _publish_run_event(
        self,
        agent_run_id: UUID,
        *,
        event: str,
        status: str,
        **extra: object,
    ) -> None:
        return await self._run._publish_run_event(agent_run_id, event=event, status=status, **extra)
```

> `_trigger_stage_completion_callback` / `_run_post_scan_validation` / `_publish_run_event` 在 facade 上**保留同名委托**：`complete_lease`（lease 子域，task-06）与 `handle_lease_expiry`（lease 子域，task-06）会通过 `self._trigger_stage_completion_callback(...)` / `self._run_post_scan_validation(...)` / `self._publish_run_event(...)` 调用——此时它们在 facade（`DaemonService`）上同名委托到 `RunSyncService`，task-06 迁移 `complete_lease`/`handle_lease_expiry` 时再按 lease 子域的跨域策略处理。

---

## 边界处理

1. **AgentRun 状态机不变**（FR-04 / design §7.5 第 3 张表）：`sync_agent_run_status` 的 pending→running、completed/failed/killed 终态翻转、started_at/finished_at/exit_code/output_redacted 字段写回逻辑；`close_interactive_run` 的 status→AgentRun.status 终态映射（success→completed、error_during_execution→failed+interactive_interrupted、其他 is_error→failed+interactive_failed、unknown→failed+interactive_unknown_status）、幂等（TERMINAL_TURN_STATUSES no-op）、SDK 透传字段（total_cost_usd/num_turns/duration_*/input/output_tokens）；`submit_messages` 的 pending→running 首条消息激活、token "仅增不减" 覆盖、session_id 首次填入、双 publish（agent_run channel + agent_session channel）——**全部逐字迁入，逻辑零变更**。
2. **agent.model import 保留**：`from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession` 整行迁入 `run_sync/service.py` 顶部（design §1 / §7.5，N5 不解耦 agent 模块）；即使 `AgentSession` 仅被 `_publish_session_event`（session 子域）使用，仍保留 import 以免遗漏跨域依赖追溯。
3. **agent.post_scan_validator 依赖保留**：`_run_post_scan_validation` 内部的 `from app.modules.agent.post_scan_validator import PostScanValidator`（lazy，函数内）位置不动；`PostScanValidator(source_root, spec_root, runtime_root, agent_run_id)` 构造与 `validate(output_redacted, exit_code)` 调用不改；`lease.metadata_` 写回 + `flag_modified(lease, "metadata_")` + `commit()` 顺序不动。
4. **大方法整体迁不改逻辑**：`submit_messages`（~213 行，含 `_extract_sdk_messages` 展开、`_channel_from_event_type` 映射、token "max 防御乱序" 写回、agent_run:{run_id} 与 agent_session:{session_id} 双 channel publish 的独立 try/except）、`close_interactive_run`（~197 行，含 `redact_output` 失败回退 `[:4000]`、双 channel publish）——**整体迁入，禁止拆分/合并/清理注释**。模块级辅助函数 `_extract_sdk_messages` / `_channel_from_event_type` 当前定义在 `service.py` 模块底部（属 `submit_messages` 私有辅助）→ 随 `submit_messages` 一起迁入 `run_sync/service.py` 模块底部（design §10 R2 私有辅助随主方法归位）。
5. **`_publish_run_event` 归属 = run_sync**（design §10 R6：run 事件归 run_sync 子域）：随本 task 迁入 `RunSyncService`，**不**抽共享 `events.py`（暂无 session 侧对称需求，task-05 的 `_publish_session_event` 归 session 子域，两者 payload/channel 不同，不共享）。**跨域消费者**：`DaemonService.handle_lease_expiry`（lease 子域，task-06 迁）当前调用 `await self._publish_run_event(...)` —— W4 完成后该方法在 facade 上仍是同名委托（见接口定义伪代码），task-06 迁 `handle_lease_expiry` 时按 lease 子域跨域策略再处理，本 task 不动 `handle_lease_expiry`。
6. **跨子域辅助（`_get_lease_and_verify_token` / `_publish_session_event`）**：两者操作的主对象分别是 `DaemonTaskLease`（lease）与 `AgentSession`（session），**不随本 task 迁入** run_sync；采用"持有对方 service 引用"（design §7.2）或"W4 早于 W5/W6 时从 facade 反向注入可调用引用 / lazy import + 局部实例化"策略，避免循环 import。execute 时择一并在本文件"实现要求"第 8 条补记实际选择。
7. **TERMINAL_TURN_STATUSES 常量归属 = session 子域**（tasks.md task-05 列表）：本 task 不在 `run_sync/service.py` 重复定义；从 task-05 落位处或 facade（task-05 未落位时）import。
8. **异常类**：`sync_agent_run_status` 抛 `DaemonAgentRunNotFound`，`_run_post_scan_validation` 无显式抛（外层 try/except 吞异常）—— `DaemonAgentRunNotFound` 类定义的迁移与 re-export 属 **task-07**（异常类归位 + facade re-export），本 task 仅在 `run_sync/service.py` 顶部 `from app.modules.daemon.service import DaemonAgentRunNotFound`（facade 仍有定义，W4 时点），task-07 统一调整。

---

## 非目标

- **不动 session 子域方法**：`create_session` / `inject_session` / `interrupt_session` / `end_session` / `recover_*` / `reopen_session` / `list/get/delete_agent_session` / `get_agent_session_logs` / `_get_owned_session_for_update` / `_get_current_run` / `_converge_*` / `_assert_no_other_active_run` / `_end_session_for_delete` / `_publish_session_event` / `ACTIVE_SESSION_STATUSES` / `ACTIVE_TURN_STATUSES` / `TERMINAL_TURN_STATUSES` 归 task-05。
- **不动 lease 子域方法**：`create_lease` / `claim_lease` / `start_lease` / `lease_heartbeat` / `complete_lease` / `get_lease` / `list_leases` / `expire_leases` / `handle_lease_expiry` / `_get_lease_and_verify_token` / `_build_claim_payload` 归 task-06。注意 `complete_lease`（line 939/954 调 `_trigger_stage_completion_callback` / `_run_post_scan_validation`）与 `handle_lease_expiry`（line 1683/1723 调 `_publish_run_event`）的**方法体**本 task 不迁，仅它们调用的目标方法本 task 迁到 `RunSyncService` + facade 保留同名委托。
- **不动异常类 re-export**：`DaemonAgentRunNotFound` / `DaemonSessionNotActive` 等定义迁子包 + facade re-export 属 task-07；本 task 仅 import 使用。
- **不动 `_apply_patch_to_worktree` / `_run_git_apply`**：归 task-03（patch 子域）。
- **不改 `router.py`**（N3 / FR-01）：`router.py` git diff 必须为空。
- **不改 AgentRun 状态机**（FR-04）：状态转移 / 字段写回 / Redis 事件 payload / 终态幂等判据全部不变。
- **不抽 `events.py` 共享模块**（design §10 R6）：`_publish_run_event` 与 `_publish_session_event` 各归其主对象子域，不共享。
- **不动 `model.py` / `schema.py` / `protocol.py` / `lease_service.py` / `permission_service.py` / `ws_hub.py`**（design §6 "不动" 行）。

---

## 参考

- design.md §5.1 归位判据（`AgentRun` → run_sync）
- design.md §6 文件变更清单第 7 行（`run_sync/service.py` 6 方法清单）
- design.md §7.1 facade 接口（run_sync 区段 3 方法委托）
- design.md §7.2 子 service 构造约定（跨子域调用：持有引用 / lazy import）
- design.md §7.5 AgentRun 状态同步生命周期表（FR-04 契约不变自审基准）
- design.md §10 R2（私有辅助随主方法归位）、R6（`_publish_run_event` 归属）
- requirements.md FR-02（方法归位）/ FR-04（生命周期契约不变）
- plan.md task-04（W4 / P0 / depends task-01 / blocks task-07 / 覆盖 FR-02 FR-04）
- tasks.md W4 task-04（6 方法清单）

---

## TDD 步骤

1. **迁前基线**（在 task-01 facade 安全网已就位的基础上）：
   - `make backend-test`（daemon 全测）跑通并记录用例数，作为迁后对比基准。
   - 重点关注 `test_run_input_service`（覆盖 `submit_messages` 的 token/session_id/双 publish）、`test_session_recovery`（16 用例，间接走 `sync_agent_run_status` / `close_interactive_run` 路径）、`test_lease_service`（间接覆盖 `complete_lease` → `_trigger_stage_completion_callback` / `_run_post_scan_validation` 调用链）。
2. **迁入**：
   - 新建 `run_sync/service.py`，按"接口定义"落地 `RunSyncService` + 6 方法 + 模块级辅助 `_extract_sdk_messages` / `_channel_from_event_type`。
   - 跨子域辅助（`_get_lease_and_verify_token` / `_publish_session_event`）与 `TERMINAL_TURN_STATUSES` 按"实现要求"第 6/8 条与"边界处理"第 6/7 条选 import 策略。
   - `service.py` 的 `DaemonService` 中 6 方法体替换为委托（含 `_trigger_stage_completion_callback` / `_run_post_scan_validation` / `_publish_run_event` 的 facade 同名委托，供 `complete_lease` / `handle_lease_expiry` 继续 call）。
3. **迁后验证**：
   - `make backend-test`：daemon 全测通过（**重点** `test_run_input_service` 全用例 + `test_session_recovery` 16 用例 + `test_lease_service`，对比迁前基线用例数一致、无 fail）。
   - `make backend-lint`：`ruff check` + `ruff format --check` + `mypy` 全过。
   - `git diff backend/app/modules/daemon/router.py`：**为空**（FR-01 铁证）。
   - 手工 grep：`grep -n "def submit_messages\|def sync_agent_run_status\|def close_interactive_run\|def _trigger_stage_completion_callback\|def _run_post_scan_validation\|def _publish_run_event" backend/app/modules/daemon/service.py` → 6 方法均为 facade 一行委托（方法体无原逻辑）。
   - 手工 grep：`grep -n "def submit_messages\|def sync_agent_run_status\|def close_interactive_run\|def _trigger_stage_completion_callback\|def _run_post_scan_validation\|def _publish_run_event" backend/app/modules/daemon/run_sync/service.py` → 6 方法 + 模块级 `_extract_sdk_messages` / `_channel_from_event_type` 均在新文件。

---

## 验收标准

| AC# | 标准 | 验证方式 |
|-----|------|---------|
| AC-01 | `run_sync/service.py` 存在并定义 `class RunSyncService`，构造签名为 `__init__(self, session: AsyncSession) -> None` | `grep "class RunSyncService" run_sync/service.py` 命中 |
| AC-02 | 6 方法（`submit_messages` / `sync_agent_run_status` / `close_interactive_run` / `_trigger_stage_completion_callback` / `_run_post_scan_validation` / `_publish_run_event`）在 `run_sync/service.py` 内完整定义，签名与原 `DaemonService` 同名方法逐位一致（含 `*` / 关键字-only / 默认值） | 人工 diff 签名行 |
| AC-03 | 模块级辅助 `_extract_sdk_messages` / `_channel_from_event_type` 随 `submit_messages` 一并迁入 `run_sync/service.py`（design §10 R2） | `grep -n "_extract_sdk_messages\|_channel_from_event_type" run_sync/service.py` 命中定义 |
| AC-04 | `service.py` 的 `DaemonService` 中 6 方法体替换为 `return await self._run.xxx(...)` 委托一行（含 `_publish_run_event` / `_run_post_scan_validation` / `_trigger_stage_completion_callback` 三个 private 的同名委托，供 lease 子域继续 call） | `grep -A1 "def submit_messages" service.py` 等确认委托体 |
| AC-05 | `from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession` 在 `run_sync/service.py` 顶部保留 | `grep "from app.modules.agent.model import" run_sync/service.py` 命中 |
| AC-06 | `from app.modules.agent.post_scan_validator import PostScanValidator` 在 `_run_post_scan_validation` 内部保留为 lazy import | `grep "post_scan_validator" run_sync/service.py` 命中且位于方法体内 |
| AC-07 | AgentRun 状态机逻辑零变更：`sync_agent_run_status`（pending→running、终态翻转、started_at/finished_at/exit_code 写回）、`close_interactive_run`（终态映射、TERMINAL 幂等、SDK 透传字段）、`submit_messages`（首条激活、token 仅增不减、双 channel publish）逐字迁入 | `test_run_input_service` + `test_session_recovery` 全用例通过 |
| AC-08 | `make backend-test` 通过（含 `test_run_input_service` / `test_session_recovery` 16 用例 / `test_lease_service`，对比迁前基线无 fail 无 skip 增量） | CI / 本地 make 输出 |
| AC-09 | `make backend-lint` 通过（ruff check + ruff format --check + mypy） | CI / 本地 make 输出 |
| AC-10 | `git diff backend/app/modules/daemon/router.py` 为空（FR-01 铁证） | `git diff --stat router.py` 无输出 |
| AC-11 | 跨子域调用链不破：`complete_lease`（task-06 迁前仍在 facade）经 facade 同名委托仍能调到 `_trigger_stage_completion_callback` / `_run_post_scan_validation`；`handle_lease_expiry` 经 facade 同名委托仍能调到 `_publish_run_event` | `test_lease_service` 全用例通过（覆盖 complete_lease 路径） |
| AC-12 | 无循环 import：`python -c "from app.modules.daemon.run_sync.service import RunSyncService"` 可 import；`python -c "from app.modules.daemon.service import DaemonService"` 可 import | 本地命令行验证 |
