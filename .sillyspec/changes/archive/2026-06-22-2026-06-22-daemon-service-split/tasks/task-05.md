---
id: task-05
title: session 方法（AgentSession 生命周期，最大子域 ~1380 行）迁入 session/service.py（SessionService），facade 改委托；通知 fix-interactive-lifecycle 更新 W4 方法定位
priority: P0
depends_on: [task-01]
blocks: [task-07]
requirement_ids: [FR-02, FR-04]
decision_ids: []
allowed_paths:
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/service.py
author: qinyi
created_at: 2026-06-22T10:21:00+08:00
---

# task-05

> Wave 5（最大子域，单独 Wave 便于回滚）。依赖 W1（task-01 facade 安全网就位）。
> 覆盖：FR-02（51 方法归位）+ FR-04（session 生命周期契约不变）。
> 依据文档：`design.md` §5.1 归位判据 / §5.2 目录结构 / §5.3 W5 / §6 文件清单 / §7.1 facade 契约 / §7.3 异常 re-export / §7.5 session 契约表 / §10 R3 W4 协调。

## 修改文件

| 操作 | 文件路径 | 说明 |
|------|---------|------|
| 新增 | `backend/app/modules/daemon/session/service.py` | `SessionService` 类，承载全部 session 方法的实现（从 `DaemonService` 原样搬入），~1380 行 |
| 修改 | `backend/app/modules/daemon/service.py` | 删除 20 个 session 方法体（1779-3156 行区段）+ 3 frozenset + 9 session 异常/结果 dataclass（160-271 行区段，异常类移到 session/service.py 顶部），facade `DaemonService` 改为持有 `self._sess = SessionService(session)`，20 个 session 方法改为 `return await self._sess.xxx(...)` 一行委托 |

> `session/__init__.py` 已由 task-01 建好；本 task 只新增 `session/service.py`。

## 覆盖来源

- **FR-02**：51 方法全部归位，本 task 承担其中 20 个 session 方法的物理迁移，facade 仍保留同名方法签名（搬砖照做，签名/返回/异常类型逐位一致）。
- **FR-04**：`AgentSession` 生命周期契约不变（design §7.5 session 契约表 8 个事件：create/inject/interrupt/end/recover/confirm_reconnected/mark_recovery_failed/reopen/delete/logs），活动态定义 `ACTIVE_SESSION_STATUSES = {pending, active, reconnecting}` 与 `ACTIVE_TURN_STATUSES`/`TERMINAL_TURN_STATUSES` 不变。

## 实现要求

1. **新建 `backend/app/modules/daemon/session/service.py`**，定义 `class SessionService`：
   - `__init__(self, session: AsyncSession) -> None: self._session = session`（与 facade 一致）。
   - 顶部原样迁入 3 个 frozenset：`ACTIVE_SESSION_STATUSES`、`ACTIVE_TURN_STATUSES`、`TERMINAL_TURN_STATUSES`。
   - 顶部原样迁入 9 个 session 域异常/结果类（见接口定义清单）。
   - 迁入 20 个方法实现，方法体**逐字节搬入**，内部对 `self._session` 的引用保持不变（子 service 同样持有 `_session`）。
   - 方法内对 `DaemonRuntimeOffline` / `DaemonSessionNotFound` 等跨域异常的 raise，从 facade re-export 路径 import（见接口定义的 import 约定）。
   - 对 `from app.modules.daemon.ws_hub import get_daemon_ws_hub`、`from app.modules.agent.placement import RunPlacementService` 等函数级 lazy import 保持函数级不变（避免模块级循环）。

2. **`create_session` 跨域调 lease/run 的 lazy import 保留**：`create_session` 内部已使用 `from app.modules.agent.placement import RunPlacementService`（函数级 lazy import），迁移后保持原样，不改为构造期持有引用（避免 session↔agent↔lease 循环 import）。**本项目 create_session 不直接 `LeaseService().create_lease(...)`**（实际建 lease 由 `RunPlacementService.prepare_interactive_dispatch` 完成），因此无需在本 task 引入跨子域持有引用。

3. **facade `service.py` 委托化**：
   - `DaemonService.__init__` 中 `self._sess = SessionService(session)`（task-01 已留位置）。
   - 20 个 session 方法的方法体替换为一行委托，例如：
     ```python
     async def create_session(self, user_id, *, provider, prompt, model=None,
                              manual_approval=False, ask_user_only=False):
         return await self._sess.create_session(
             user_id, provider=provider, prompt=prompt, model=model,
             manual_approval=manual_approval, ask_user_only=ask_user_only,
         )
     ```
   - 签名、关键字参数、默认值、返回类型、`*` 分隔位置**完全保留**。
   - 3 个 frozenset 与 9 个 session 异常/结果类**从 facade `service.py` 删除**（迁到 session/service.py）；但 facade 仍需 re-export 这些符号以满足现有 `from app.modules.daemon.service import DaemonSessionNotFound, SessionDispatchResult, ACTIVE_SESSION_STATUSES` 等 import —— **re-export 在 task-07 统一处理**，本 task 暂时在 facade `service.py` 顶部 `from app.modules.daemon.session.service import *`（或显式 re-import 这 12 个符号）以保持兼容。task-07 会改为按 §7.3 全量收集的显式 re-export 清单。
   - `_LIST_STATUSES`（list_agent_sessions 的私有类常量）随主方法迁入 SessionService 类体内。

4. **不动 router.py**：`git diff backend/app/modules/daemon/router.py` 必须为空。

5. **不动 run_sync 方法**：`_publish_run_event`、`sync_agent_run_status`、`close_interactive_run`、`submit_messages` 属于 task-04，不迁入 session。

## 接口定义

### SessionService 类签名

```python
# backend/app/modules/daemon/session/service.py
from __future__ import annotations

import json
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified
from sqlmodel import col

from app.core.errors import AppError
from app.core.logging import get_logger
from app.core.redis import get_redis
from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.daemon.model import DaemonTaskLease
from app.modules.daemon.protocol import (
    DAEMON_MSG_SESSION_END,
    DAEMON_MSG_SESSION_INJECT,
    DAEMON_MSG_SESSION_INTERRUPT,
    DAEMON_MSG_SESSION_RESUME,
)
from app.modules.daemon.schema import SessionReopenResponse

# 跨子域异常类（facade re-export 来源，仍从 facade 顶层 import 保持单一来源）
from app.modules.daemon.service import (
    DaemonRuntimeOffline,
)

log = get_logger(__name__)


# ── 3 frozenset（活动态/终态定义，随 session 子域迁入） ────────────────────
ACTIVE_SESSION_STATUSES = frozenset({"pending", "active", "reconnecting"})
ACTIVE_TURN_STATUSES = frozenset({"pending", "running", "pending_approval"})
TERMINAL_TURN_STATUSES = frozenset({"completed", "failed", "killed", "cancelled"})


# ── 9 个 session 域异常/结果类（从 facade 顶部迁入） ───────────────────────
class DaemonSessionNotFound(AppError):
    code = "HTTP_404_DAEMON_SESSION_NOT_FOUND"
    http_status = 404


class DaemonSessionNotActive(AppError):
    code = "HTTP_409_DAEMON_SESSION_NOT_ACTIVE"
    http_status = 409


class DaemonSessionTurnConflict(AppError):
    code = "HTTP_409_DAEMON_SESSION_TURN_CONFLICT"
    http_status = 409


class DaemonSessionNoCurrentRun(AppError):
    code = "HTTP_409_DAEMON_SESSION_NO_CURRENT_RUN"
    http_status = 409


class DaemonSessionInvariantViolation(AppError):
    code = "HTTP_409_DAEMON_SESSION_INVARIANT_VIOLATION"
    http_status = 409


class DaemonSessionResumeUnsupported(AppError):
    code = "HTTP_409_DAEMON_SESSION_RESUME_UNSUPPORTED"
    http_status = 409


class DaemonSessionNoAgentSession(AppError):
    code = "HTTP_409_DAEMON_SESSION_NO_AGENT_SESSION"
    http_status = 409


class DaemonOffline(AppError):
    code = "HTTP_409_DAEMON_OFFLINE"
    http_status = 409


@dataclass(frozen=True, slots=True)
class SessionDispatchResult:
    agent_session: AgentSession
    agent_run: AgentRun
    lease_id: uuid.UUID


@dataclass(frozen=True, slots=True)
class SessionControlResult:
    agent_session: AgentSession
    current_run_id: uuid.UUID | None


@dataclass(frozen=True, slots=True)
class SessionRecoveryResult:
    session_id: uuid.UUID
    lease_id: uuid.UUID | None
    status: Literal["active", "ended", "failed", "reconnecting", "rejected"]
    interrupted_run_status: Literal["failed"] | None = None


class SessionService:
    """AgentSession 生命周期子域 service（task-05 / design §5.2）。

    纯搬入：方法体与原 DaemonService 同名方法逐字节一致。facade
    DaemonService 保留 20 个同名方法做委托（design §7.1）。
    """

    _LIST_STATUSES = frozenset({"pending", "active", "reconnecting", "ended", "failed"})

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ── 辅助方法 ──────────────────────────────────────────────────────────
    async def _get_owned_session_for_update(self, session_id: uuid.UUID, user_id: uuid.UUID) -> AgentSession: ...
    async def _get_current_run(self, session_id: uuid.UUID) -> AgentRun | None: ...
    async def _publish_session_event(self, session_id: uuid.UUID, payload: dict[str, object]) -> None: ...
    async def _converge_failed_dispatch(self, *, session: AgentSession, run: AgentRun, lease_id: uuid.UUID, error: str) -> None: ...
    async def _converge_crashed_run(self, *, session_id: uuid.UUID, run_id: uuid.UUID) -> Literal["failed"] | None: ...
    async def _assert_no_other_active_run(self, *, session_id: uuid.UUID, excluded_run_id: uuid.UUID | None) -> None: ...
    async def _end_session_for_delete(self, session: AgentSession) -> None: ...

    # ── 主生命周期（design §7.5 session 契约表 8 事件） ─────────────────────
    async def create_session(
        self,
        user_id: uuid.UUID,
        *,
        provider: str,
        prompt: str,
        model: str | None = None,
        manual_approval: bool = False,
        ask_user_only: bool = False,
    ) -> SessionDispatchResult: ...

    async def inject_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        prompt: str,
    ) -> SessionDispatchResult: ...

    async def interrupt_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> SessionControlResult: ...

    async def end_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        reason: str = "manual",
    ) -> SessionControlResult: ...

    # ── daemon 重启恢复（W4 待接通，design §10 R3） ─────────────────────────
    async def recover_session_after_daemon_restart(
        self,
        session_id: uuid.UUID,
        *,
        runtime_id: uuid.UUID,
        lease_id: uuid.UUID,
        provider: str,
        agent_session_id: str,
        interrupted_run_id: uuid.UUID | None,
    ) -> SessionRecoveryResult: ...

    async def confirm_session_reconnected(
        self,
        session_id: uuid.UUID,
        *,
        runtime_id: uuid.UUID,
    ) -> Literal["active", "failed", "rejected"]: ...

    async def mark_session_recovery_failed(
        self,
        session_id: uuid.UUID,
        *,
        runtime_id: uuid.UUID,
        reason: str = "restore_failed",
    ) -> Literal["failed", "rejected"]: ...

    # ── 查询 + reopen + delete ─────────────────────────────────────────────
    async def list_agent_sessions(
        self,
        user_id: uuid.UUID,
        *,
        limit: int,
        offset: int,
        status_filter: str | None = None,
    ) -> tuple[list[AgentSession], int]: ...

    async def get_agent_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> AgentSession: ...

    async def reopen_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> SessionReopenResponse: ...

    async def delete_agent_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> None: ...

    async def get_agent_session_logs(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> list[AgentRunLog]: ...
```

### SessionService 方法签名完整清单（20 个）

| # | 方法 | 签名摘要 | 原 service.py 行号 |
|---|------|---------|-------------------|
| 1 | `_get_owned_session_for_update(session_id, user_id) -> AgentSession` | `with_for_update` 锁 + 404 | 1779 |
| 2 | `_get_current_run(session_id) -> AgentRun \| None` | 单活动 run 不变量 | 1808 |
| 3 | `_publish_session_event(session_id, payload) -> None` | Redis publish，best-effort | 1837 |
| 4 | `create_session(user_id, *, provider, prompt, model=None, manual_approval=False, ask_user_only=False) -> SessionDispatchResult` | 首次 dispatch（建 lease 经 RunPlacementService） | 1862 |
| 5 | `_converge_failed_dispatch(*, session, run, lease_id, error) -> None` | dispatch offline 收口 | 2022 |
| 6 | `inject_session(session_id, user_id, *, prompt) -> SessionDispatchResult` | 后续 turn，SESSION_INJECT | 2062 |
| 7 | `interrupt_session(session_id, user_id) -> SessionControlResult` | turn 级中断 | 2201 |
| 8 | `end_session(session_id, user_id, *, reason="manual") -> SessionControlResult` | 单事务收口 | 2264 |
| 9 | `recover_session_after_daemon_restart(session_id, *, runtime_id, lease_id, provider, agent_session_id, interrupted_run_id) -> SessionRecoveryResult` | W4 待接通 | 2374 |
| 10 | `_converge_crashed_run(*, session_id, run_id) -> Literal["failed"] \| None` | 单 crashed run 收口 | 2539 |
| 11 | `_assert_no_other_active_run(*, session_id, excluded_run_id) -> None` | 双崩不变量 | 2597 |
| 12 | `confirm_session_reconnected(session_id, *, runtime_id) -> Literal["active","failed","rejected"]` | W4 待接通 | 2621 |
| 13 | `mark_session_recovery_failed(session_id, *, runtime_id, reason="restore_failed") -> Literal["failed","rejected"]` | W4 待接通 | 2678 |
| 14 | `list_agent_sessions(user_id, *, limit, offset, status_filter=None) -> tuple[list[AgentSession], int]` | owner-scoped 分页 | 2741 |
| 15 | `get_agent_session(session_id, user_id) -> AgentSession` | 单读 404 隔离 | 2776 |
| 16 | `reopen_session(session_id, user_id) -> SessionReopenResponse` | ended → reconnecting，新建 lease + token rotate | 2803 |
| 17 | `delete_agent_session(session_id, user_id) -> None` | 活动会话内部 end + 硬删 | 2962 |
| 18 | `_end_session_for_delete(session) -> None` | delete 内部 end 收口 | 3017 |
| 19 | `get_agent_session_logs(session_id, user_id) -> list[AgentRunLog]` | 跨 run 聚合历史 | 3087 |
| 20 | （类常量 `_LIST_STATUSES`） | list_agent_sessions 用 | 2739 |

### `create_session` 跨域调 lease 的 lazy import 伪代码

```python
async def create_session(self, user_id, *, provider, prompt, model=None,
                         manual_approval=False, ask_user_only=False) -> SessionDispatchResult:
    # ... AgentSession + AgentRun ORM 创建 ...

    # 跨域调用：建 lease 经 agent.placement.RunPlacementService（不直接调 LeaseService）
    # 保留函数级 lazy import 避免模块级循环（design §7.2）
    from app.modules.agent.placement import RunPlacementService

    placement = RunPlacementService(self._session)
    dispatch = await placement.prepare_interactive_dispatch(
        agent_session_id=session.id,
        agent_run_id=run.id,
        user_id=user_id,
        provider=provider,
        prompt=prompt,
        model=model,
        manual_approval=manual_approval,
        ask_user_only=ask_user_only,
    )

    # ... backfill 三元绑定 + activate + commit ...

    # 跨域：daemon WS hub（也是函数级 lazy import，迁移后保持不变）
    from app.modules.daemon.ws_hub import get_daemon_ws_hub

    hub = get_daemon_ws_hub()
    await hub.send_session_control(dispatch.runtime_id, DAEMON_MSG_SESSION_INJECT, {...})
```

> **重要**：本项目 `create_session` **不直接 import LeaseService**，lease 创建由 `RunPlacementService.prepare_interactive_dispatch` 内部完成，因此 session↔lease 子域之间在本 task **不存在构造期引用**，只需保留现有的函数级 lazy import 即可（design §10 R1 循环引用风险在本 task 不触发）。

## 边界处理

1. **AgentSession 状态机不变**：`pending → active → reconnecting → active/failed → ended` 的所有转移条件、`FOR UPDATE` 行锁、ownership 校验、幂等返回分支（end 对已 ended 的 no-op、recover 对已 terminal 的不复活）**逐字节搬入**，不修一字。
2. **活动态/终态定义不变**：`ACTIVE_SESSION_STATUSES = {pending, active, reconnecting}`、`ACTIVE_TURN_STATUSES = {pending, running, pending_approval}`、`TERMINAL_TURN_STATUSES = {completed, failed, killed, cancelled}` 三个 frozenset 随 session 子域迁入（design §7.5 注脚），值不变；router 测试通过 facade re-export 访问仍可用。
3. **3 frozenset 随迁**：放在 session/service.py 顶部模块级（与原位置一致），不在 SessionService 类体内，便于其他子域（run_sync 的 `_publish_run_event`、recover 的 `_converge_crashed_run`）通过 `from app.modules.daemon.session.service import TERMINAL_TURN_STATUSES` 引用（或经 facade re-export）。
4. **跨域 lazy import 避循环**：`create_session` / `inject_session` / `interrupt_session` / `end_session` / `reopen_session` 内部对 `get_daemon_ws_hub` 和 `RunPlacementService` 的函数级 lazy import **全部保留**，不提升到模块级（design §7.2 / §10 R1）。对 `DaemonRuntimeOffline` 等跨域异常的 import 在 session/service.py 顶部从 facade `service` 模块 import（facade 已 re-export），避免 session ↔ runtime 子域直接耦合。
5. **W4 方法迁移后通知 fix-interactive-lifecycle**：`recover_session_after_daemon_restart` / `confirm_session_reconnected` / `mark_session_recovery_failed` 三个方法原 `service.py` 行号（2374 / 2621 / 2678）失效，新位置 = `session/service.py`（本 task 完成后写入"协调章节"并在 fix-interactive-lifecycle 的 tasks.md / design.md 标注）。design §10 R3 明确：本拆分先于 W4 执行，W4 重新定位简单。
6. **session 异常类迁移后 facade re-export 临时方案**：9 个 session 异常/结果类（DaemonSessionNotFound/NotActive/TurnConflict/NoCurrentRun/InvariantViolation/ResumeUnsupported/NoAgentSession/DaemonOffline + SessionDispatchResult/SessionControlResult/SessionRecoveryResult dataclass）从 facade 顶部删除，迁入 session/service.py。本 task 在 facade 顶部临时 `from app.modules.daemon.session.service import *`（或显式 re-import 这 12 个符号）保持现有 `from app.modules.daemon.service import DaemonSessionNotFound` 等 import 路径不变；**显式 re-export 清单由 task-07 统一按 `grep -rn "from app.modules.daemon.service import"` 全量收集并改写**。
7. **`_publish_session_event` vs `_publish_run_event` 归属**：design §10 R6 已裁定 —— session 事件归 session，run 事件归 run_sync（task-04）。两个 `_publish_*_event` 方法**独立、不共享、不抽 events.py**（当前实现差异大，强行抽象增加风险，留独立评估）。
8. **`reopen_session` 跨子域建 lease**：`reopen_session` 内部直接 `DaemonTaskLease(...)` ORM 构造（不调 LeaseService.create_lease），搬入 session/service.py 时**保持原样**（不重构为调 LeaseService），避免引入跨子域耦合。

## 非目标

| # | 不做 | 理由 / 留待 |
|---|------|-----------|
| N1 | 不再细分 session 子文件（如 `session/recovery.py`、`session/query.py`） | design §5.2 D-004@v1：方案 A 标准粒度，session/service.py ≤ 1500 行即可（~1380 行已满足） |
| N2 | 不动 run_sync 方法（`_publish_run_event` / `sync_agent_run_status` / `close_interactive_run` / `submit_messages` / `_run_post_scan_validation` / `_trigger_stage_completion_callback`） | 属 task-04 |
| N3 | 不动异常类 re-export 的最终清单 | task-07 统一全量收集 + 显式 re-export（design §7.3） |
| N4 | 不重构 `create_session` 改为调 `LeaseService.create_lease` | 现状经 `RunPlacementService.prepare_interactive_dispatch` 建 lease，行为不变优先 |
| N5 | 不抽 `_publish_*_event` 共享基类 / events.py | design §10 R6 留独立评估 |
| N6 | 不改 `AgentSession` / `AgentRun` / `AgentRunLog` model 归属（不迁到 daemon 模块） | design §3 N1 / N5，方向 B 留独立 P2 变更 |
| N7 | 不改 router.py、不改 daemon HTTP API 契约 | design §3 N3 / N4 |

## 参考

- `design.md` §5.1 归位判据（AgentSession 操作归 session）
- `design.md` §5.2 目录结构（`session/service.py` ~1380 行）
- `design.md` §5.3 W5（session 单独 Wave 便于回滚）
- `design.md` §6 文件清单（session/service.py 行 124-125）
- `design.md` §7.1 facade 委托（session 方法 11 个公共 + 私有辅助）
- `design.md` §7.2 子 service 构造约定（lazy import 避循环）
- `design.md` §7.3 异常 re-export（task-07 统一）
- **`design.md` §7.5 Session 生命周期契约表（FR-04 自审基准）**：8 事件 ×（状态转移 + 关键字段 + 承载位置 = session/service.py）
- `design.md` §10 R3（W4 方法定位协调）

## 协调章节：fix-interactive-lifecycle W4 方法新位置

> 本 task 完成后，需在 `2026-06-19-fix-interactive-daemon-lifecycle` 的 `tasks.md`（W4 task-06 段）与 `design.md`（§11）标注以下方法定位变更。

**变更前**（fix-interactive-lifecycle 当前文档）：
- `service.py` 加/接通 `recover_session_after_daemon_restart` / `confirm_session_reconnected` / `mark_session_recovery_failed`（原假设位置：`backend/app/modules/daemon/service.py` ~2374 / ~2621 / ~2678 行）

**变更后**（本 task 完成后）：
| 方法 | 新位置 | 备注 |
|------|--------|------|
| `recover_session_after_daemon_restart` | `backend/app/modules/daemon/session/service.py`（`SessionService.recover_session_after_daemon_restart`） | router 仍调 `DaemonService.recover_session_after_daemon_restart`（facade 委托），W4 router 改动零感知 |
| `confirm_session_reconnected` | `backend/app/modules/daemon/session/service.py`（`SessionService.confirm_session_reconnected`） | 同上 |
| `mark_session_recovery_failed` | `backend/app/modules/daemon/session/service.py`（`SessionService.mark_session_recovery_failed`） | 同上 |

**对 W4 的影响**：
- W4 task-06 在 router 加 3 个端点（POST `/sessions/{id}/recover` / `/confirm-reconnected` / `/mark-recovery-failed`），调用 `DaemonService.recover_*` —— **facade 完全兼容，W4 router 改动零调整**。
- W4 task-06 若需补 `confirm_reconnected` / `mark_recovery_failed` 方法实现 —— **已在 session/service.py 存在（本 task 搬入），W4 直接使用**。
- W4 重头在 daemon 侧（cli.ts / session-manager.ts / hub-client.ts），backend 增量小；本拆分让 session 方法定位固定，W4 不需要在巨石上定位方法（design §10 R3 缓解确认）。

**通知动作**（execute 阶段执行）：在本 task PR 合入后，去 `2026-06-19-fix-interactive-daemon-lifecycle/tasks.md` 的 W4 task-06 行追加注释：`# 注意：recover_*/confirm_reconnected/mark_recovery_failed 已迁至 backend/app/modules/daemon/session/service.py（SessionService），facade DaemonService 仍保留同名委托`。

## TDD 步骤

1. **迁移前基线**（确认现有测试全绿）：
   ```bash
   make backend-test
   ```
   重点确认 `tests/backend/test_session_recovery.py`（16 用例）、`tests/backend/test_daemon_service.py`、`tests/backend/test_session_lifecycle.py`（若存在）全绿。
2. **新建 `session/service.py`**，按"接口定义"逐字节搬入 20 个方法 + 3 frozenset + 9 异常/结果类。
3. **改 facade `service.py`**：
   - 删除原 1779-3156 行区段的 20 个方法体。
   - 删除原 160-271 行区段的 3 frozenset + 9 异常/结果类。
   - 顶部临时 `from app.modules.daemon.session.service import *`（或显式 re-import 12 符号）保持兼容。
   - `__init__` 中 `self._sess = SessionService(session)`（task-01 已留）。
   - 20 个 session 方法改为一行委托。
4. **跑迁移后测试**（核心安全网）：
   ```bash
   # session recovery 16 用例（覆盖 recover/confirm/mark 三方法 + 状态机不变量）
   pytest tests/backend/test_session_recovery.py -v

   # daemon 全测（确认 facade 委托无回归）
   make backend-test
   ```
5. **lint + typecheck**：
   ```bash
   make backend-lint   # ruff check + ruff format check + mypy
   ```
6. **行数自检**：
   ```bash
   wc -l backend/app/modules/daemon/session/service.py   # 应 ≤ 1500
   wc -l backend/app/modules/daemon/service.py           # facade 应大幅瘦身
   ```
7. **router diff 铁证**：
   ```bash
   git diff backend/app/modules/daemon/router.py         # 必须为空
   ```

## 验收标准

| AC # | 验收项 | 验证方法 | 通过判据 |
|------|--------|---------|---------|
| AC-1 | `session/service.py` 新建成功，定义 `SessionService` 类 + 20 方法 + 3 frozenset + 9 异常/结果类 | `grep "class SessionService" backend/app/modules/daemon/session/service.py` | 命中 1 处 |
| AC-2 | `session/service.py` 行数 ≤ 1500 | `wc -l` | ≤ 1500（预期 ~1380） |
| AC-3 | facade `DaemonService` 20 个 session 方法改为一行委托，签名/返回/异常类型逐位一致 | 人工 diff facade 方法签名 vs SessionService 方法签名 | 完全一致 |
| AC-4 | facade `service.py` 不再含 session 方法体（1779-3156 区段已删） | `grep -n "async def create_session\|async def end_session\|async def recover_session" backend/app/modules/daemon/service.py` | 命中的都是一行委托（`return await self._sess.xxx(...)`），无方法体 |
| AC-5 | 3 frozenset + 9 异常/结果类从 facade 顶部迁出（临时 re-import 保持兼容） | `grep -n "ACTIVE_SESSION_STATUSES\|class DaemonSessionNotFound" backend/app/modules/daemon/service.py` | 仅 re-import 行，无原始定义 |
| AC-6 | `test_session_recovery.py` 16 用例全绿 | `pytest tests/backend/test_session_recovery.py -v` | 16 passed |
| AC-7 | daemon 全测通过 | `make backend-test` | 全绿，无回归 |
| AC-8 | lint + typecheck 通过 | `make backend-lint` | ruff/mypy 全绿 |
| AC-9 | router.py 零改动（D-002 铁证） | `git diff backend/app/modules/daemon/router.py` | 输出为空 |
| AC-10 | FR-04 session 契约不变（design §7.5 8 事件状态转移） | 对照 §7.5 session 契约表 vs 迁移后代码 | 状态转移/关键字段/ownership 校验/幂等分支逐项一致 |
| AC-11 | W4 方法新位置已通知 fix-interactive-lifecycle | 检查 `2026-06-19-fix-interactive-daemon-lifecycle/tasks.md` W4 task-06 注释 | 注释已加，标注 3 方法新位置 |
| AC-12 | `from app.modules.daemon.service import DaemonSessionNotFound, SessionDispatchResult, ACTIVE_SESSION_STATUSES` 仍可用 | 临时跑 `python -c "from app.modules.daemon.service import DaemonSessionNotFound, SessionDispatchResult, SessionControlResult, SessionRecoveryResult, ACTIVE_SESSION_STATUSES, ACTIVE_TURN_STATUSES, TERMINAL_TURN_STATUSES"` | import 成功（facade re-export 生效） |
