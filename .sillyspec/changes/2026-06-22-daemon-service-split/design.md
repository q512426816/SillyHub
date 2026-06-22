---
author: qinyi
created_at: 2026-06-22T09:47:00+08:00
---

# 设计：daemon 模块 service 巨石拆分（方向 A，P0 止血）

> 变更名：`2026-06-22-daemon-service-split`
> 来源：架构探索（explore）结论 + brainstorm 确认
> 子项目：backend（`app/modules/daemon/**`）

---

## 1. 背景

`backend/app/modules/daemon/service.py` 的 `DaemonService` 是一个 **277→3324 行的单类（约 3000 行类体、51 个方法）上帝类**，单一类承担了 daemon 模块几乎全部业务逻辑。

更关键的是，daemon 模块是 **"拆了一半的半成品"**：

- `lease` 逻辑由**两个并存 service 分管不同操作**（Design Grill 修正：非"双写"）：`DaemonService` 管 lease 正向生命周期（create/claim/start/heartbeat/complete/expire，被 daemon/router 调用）；`DaemonLeaseService`（`lease_service.py`，455 行）提供 lease 取消能力，其 `cancel_lease` 被 **agent 模块跨模块调用**（`agent/service.py:545`，kill run 时 flip lease）。两者各有活调用方、方法集部分重叠，是历史演进的并存，**非纯粹待清理的重复**。
- `permission_service.py`（696 行，`DaemonPermissionService`）和 `ws_hub.py`（452 行）**已经成功独立拆出**，证明拆分方向可行且团队已有经验。
- 但 `runtime / lease / run_sync / session / patch` 五个生命周期的逻辑仍堆在 `DaemonService` 内。
- `router.py`（1238 行）每个端点都以 `svc = DaemonService(session)` 实例化并直接调用方法，强耦合于该类的方法集。

对照同仓库 `ppm` 模块（`problem/plan/project/task/kanban` 子域分层）已示范的子包分层最佳实践，daemon 应照此拆分。

`_module-map.yaml` 中 daemon 的 `main_symbols` 同时列出 `DaemonService` 与 `DaemonLeaseService`，`daemon.md` 模块文档变更记录仅至 `2026-06-19-runtimes-layout`，未记录 `lease_service` 拆分 —— 文档已滞后，本变更顺带补齐。

## 2. 设计目标

1. 把 `DaemonService` 按生命周期拆成 5 个子域子包：`runtime / lease / run_sync / session / patch`。
2. `service.py` 退化为**薄 facade**：`DaemonService` 保留全部 51 个方法签名不变，内部委托各子 service。
3. **`router.py` 零改动**（facade 完全兼容）—— 所有调用方零感知。
4. **运行时行为不变** —— 纯文件移动 + import 整理，无逻辑变更。
5. 每个子域可独立提交、独立验证、独立回滚（Wave 化）。
6. 消除"单类 3000 行"的可维护性瓶颈，让每个子域 < 1500 行。

## 3. 非目标（明确排除，防止 scope creep）

| # | 不做 | 理由 / 留待 |
|---|------|-----------|
| N1 | 不抽顶层 `session/` 模块（方向 B） | model 归属迁移（`AgentSession` 从 agent 迁出）工作量大、风险高，且与 `delegate_task` spike 同根；留独立 P2 变更 |
| N2 | 不合并/不迁移 `DaemonLeaseService` | 它是独立活 service（`cancel_lease` 被 agent 跨模块调用，见 §1），与 `permission_service` 同等地位，**原位保留不动**；本次仅迁 `DaemonService.lease_*` 入新 `lease/service.py`。两者方法集部分重叠的统一留待独立评估 |
| N3 | 不改 `router.py` | facade 完全兼容策略已定 |
| N4 | 不改运行时行为 / 不动数据库表 | 纯结构重构 |
| N5 | 不重构 `agent`/`workspace` 耦合 | `import AgentSession/AgentRun/AgentRunLog/Workspace` 现状保留，方向 B 才解 |
| N6 | 不拆 `permission_service.py`/`ws_hub.py` | 已独立拆对，保持 |
| N7 | 不动 `agent` 模块（P1 子域分层） | 独立变更 |

## 4. 拆分判断（为什么不走批量模式 / 多变更）

- **不批量**：5 个子域各有不同结构，非"模板 × 数据"重复，不满足批量模式条件。
- **不拆成 5 个独立 SillySpec 变更（不生成 MASTER.md）**：5 子域共享同一套拆分原则（facade 兼容、归位判据、import 规范）、同一份文件变更清单，且有执行顺序依赖（先建 facade 安全网，再逐域迁移）。拆成多变更会有大量重复设计内容。
- **采用单变更 + Wave 分组**：一份 design 统一原则，`plan.md` 分 6 个 Wave 依次推进。

## 5. 总体方案

### 5.1 归位判据（按操作的主对象）

| 操作对象 | 归属子域 |
|---------|---------|
| `DaemonRuntime`（注册/心跳/启停） | runtime |
| `DaemonTaskLease`（创建/认领/完成/过期） | lease |
| `AgentRun`（状态同步/关闭/消息/后处理） | run_sync |
| `AgentSession`（创建/注入/中断/结束/恢复/查询） | session |
| worktree patch 应用 | patch |

> 关键判据：`close_interactive_run` / `sync_agent_run_status` / `submit_messages` 操作的是 **`AgentRun` 状态机** → 归 `run_sync`；`create_session` / `end_session` / `recover_*` 操作的是 **`AgentSession` 状态机** → 归 `session`。两个状态机分离是本拆分的核心价值。

### 5.2 目标目录结构

```
daemon/
├── runtime/
│   ├── __init__.py
│   └── service.py          RuntimeService   ~215 行
├── lease/
│   ├── __init__.py         导出 LeaseService
│   ├── service.py          LeaseService     (DaemonService.lease_* 迁入)
│   └── context.py          _build_claim_payload  ~123 行
├── run_sync/
│   ├── __init__.py
│   └── service.py          RunSyncService   ~800 行
├── session/
│   ├── __init__.py
│   └── service.py          SessionService   ~1547 行(最大,不再细分;含 3 frozenset+9 异常/结果类+20 方法,略超 §5.2 ≤1500 目标因异常类 docstring 体积,execute task-05 确认接受——facade 已从 3324 瘦身至 1251,止血目标达成)
├── patch/
│   ├── __init__.py
│   └── service.py          PatchService     ~100 行
├── permission_service.py   ✓ 不动
├── ws_hub.py               ✓ 不动
├── lease_service.py        ✓ 不动(独立活service: cancel_lease 被 agent 跨模块调用)
├── protocol.py             ✓ 不动
├── model.py                ✓ 不动
├── schema.py               ✓ 不动
├── router.py               ✓ 不动(facade 兼容)
└── service.py              DaemonService → 薄 facade
```

### 5.3 Wave 分解

| Wave | 内容 | 安全网 |
|------|------|--------|
| W1 | 建 5 子包骨架（空 service + `__init__`）；`DaemonService` 改为持有 5 子 service 引用，方法体改为委托 | 跑 daemon 全测，确认行为不变（**关键安全网**：此时逻辑仍在 facade 内，子包为空壳） |
| W2 | 迁移 `runtime`（最小、最独立） | 全测 + mypy + ruff |
| W3 | 迁移 `patch`（小） | 同上 |
| W4 | 迁移 `run_sync` | 同上 |
| W5 | 迁移 `session`（最大，单独 Wave 便于回滚） | 同上 |
| W6 | 迁移 `lease`（`DaemonService.lease_*` 迁入 `LeaseService`；`DaemonLeaseService` 原位不动，与本次迁移无交集） | 同上 |

> W1 是关键：facade 委托骨架先就位并跑通全测，后续每个 Wave 的迁移都是在已验证的委托结构上"把方法体从 facade 搬到子 service"，任何 Wave 出问题都可独立回滚而不破坏 facade 契约。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|------|---------|------|
| 新增 | `app/modules/daemon/runtime/__init__.py` | 子包入口 |
| 新增 | `app/modules/daemon/runtime/service.py` | `RuntimeService`：register/heartbeat/get/list/mark_offline/enable/disable/delete/cleanup_stale + `_get_owned_runtime`/`_is_recent_heartbeat` |
| 新增 | `app/modules/daemon/lease/__init__.py` | 导出 `LeaseService`（`DaemonLeaseService` 留在隔壁 `lease_service.py`，agent 直接从那 import，无需 re-export） |
| 新增 | `app/modules/daemon/lease/service.py` | `LeaseService`：create/claim/start/heartbeat/complete/get/list/expire + `_get_lease_and_verify_token`（自 `DaemonService.lease_*` 迁入） |
| 新增 | `app/modules/daemon/lease/context.py` | `_build_claim_payload`（~123 行） |
| 新增 | `app/modules/daemon/run_sync/__init__.py` | 子包入口 |
| 新增 | `app/modules/daemon/run_sync/service.py` | `RunSyncService`：sync_agent_run_status/close_interactive_run/submit_messages + `_run_post_scan_validation`/`_trigger_stage_completion_callback`/`_publish_run_event` |
| 新增 | `app/modules/daemon/session/__init__.py` | 子包入口 |
| 新增 | `app/modules/daemon/session/service.py` | `SessionService`：create/inject/interrupt/end/recover_after_daemon_restart/confirm_reconnected/mark_recovery_failed/reopen/list/get/delete/get_logs + `_get_owned_session_for_update`/`_get_current_run`/`_converge_*`/`_assert_no_other_active_run`/`_end_session_for_delete`/`_publish_session_event` |
| 新增 | `app/modules/daemon/patch/__init__.py` | 子包入口 |
| 新增 | `app/modules/daemon/patch/service.py` | `PatchService`：`_apply_patch_to_worktree`/`_run_git_apply` |
| 修改 | `app/modules/daemon/service.py` | `DaemonService` 退化为 facade：持有 5 子 service 引用，51 方法改为委托；删除已迁出的方法体（异常类迁入子包 + facade re-export，见 §7.3） |
| 不动 | `app/modules/daemon/router.py` | facade 兼容，零改动（验收时 `git diff` 应为空） |
| 不动 | `app/modules/daemon/lease_service.py` | `DaemonLeaseService` 独立活 service（`cancel_lease` 被 agent 跨模块调用），原位保留 |
| 不动 | `app/modules/daemon/permission_service.py` / `ws_hub.py` / `protocol.py` / `model.py` / `schema.py` | 保持 |
| 文档 | `.sillyspec/docs/backend/modules/daemon.md` | 补充本变更的变更记录、契约摘要（注明 facade 化） |

## 7. 接口定义

### 7.1 Facade（`DaemonService`，签名不变）

```python
class DaemonService:
    """Facade —— 保留全部历史方法签名，内部委托子 service。
    存在意义：router.py 与所有调用方零感知（兼容策略 N3）。"""

    def __init__(self, session: AsyncSession) -> None:
        self._rt    = RuntimeService(session)
        self._lease = LeaseService(session)
        self._run   = RunSyncService(session)
        self._sess  = SessionService(session)
        self._patch = PatchService(session)

    # runtime
    async def register_runtime(self, ...):       return await self._rt.register_runtime(...)
    async def heartbeat(self, runtime_id):       return await self._rt.heartbeat(runtime_id)
    # ... get_runtime / list_runtimes / mark_offline / enable/disable_runtime / delete_runtime / cleanup_stale_runtimes

    # lease
    async def create_lease(self, ...):           return await self._lease.create_lease(...)
    async def claim_lease(self, ...):            return await self._lease.claim_lease(...)
    # ... start_lease / lease_heartbeat / complete_lease / get_lease / list_leases / expire_leases

    # run_sync
    async def sync_agent_run_status(self, ...):  return await self._run.sync_agent_run_status(...)
    async def close_interactive_run(self, ...):  return await self._run.close_interactive_run(...)
    async def submit_messages(self, ...):        return await self._run.submit_messages(...)

    # session
    async def create_session(self, ...):         return await self._sess.create_session(...)
    async def inject_session(self, ...):         return await self._sess.inject_session(...)
    # ... interrupt_session / end_session / recover_session_after_daemon_restart /
    #     confirm_session_reconnected / mark_session_recovery_failed / reopen_session /
    #     list_agent_sessions / get_agent_session / delete_agent_session / get_agent_session_logs

    # patch
    async def _apply_patch_to_worktree(self, ...): return await self._patch.apply_patch_to_worktree(...)
```

> 方法签名、返回值、异常类型**完全不变**。`_apply_patch_to_worktree` 等原私有方法在 facade 上保留同名委托（因 facade 内部其他方法或外部可能直接引用，迁移时逐一核对调用点）。

### 7.2 子 Service 构造约定

所有子 service 接受 `session: AsyncSession`（与 `DaemonService` 一致），需要跨子域调用时（如 `SessionService.create_session` 内部要建 lease）通过**持有对方引用**或**函数级 lazy import**（项目已有此模式，见 `router.py:624` 注释），避免模块级循环 import。

> **facade → 子 service 的 import 策略**（D-005，execute W2 修正）：facade `service.py` **不在顶部模块级 import 5 个子 service 类**，而是在 `DaemonService.__init__` 内**函数级 lazy import**（`router.py:624` 同款模式）。原因：子 service 顶层需 import facade 定义的异常类（`DaemonRuntimeNotFound` 等，task-07 前仍留在 `service.py`），若 facade 同时顶部模块级 import 子 service，则构成 `service.py ↔ 子包` 双向模块级循环 import（实测 `ImportError`）。facade 用 `__init__` 内 lazy import 后，依赖单向（子 → facade 异常类），循环解除。task-01 最初误用顶部模块级 import，W2 已修正。

### 7.3 异常类归属

`service.py` 顶部定义的异常类（`DaemonRuntimeNotFound` / `DaemonLeaseNotFound` / `DaemonSessionNotFound` / `PatchApplyError` / `DaemonRpc*` 等）按归属子域迁入对应子包，或在 facade `service.py` 集中 re-export 以保持 `from app.modules.daemon.service import XxxError` 的 import 路径不变。**决策**：集中 re-export（迁入子包定义 + facade re-export），既满足按域归属又不破坏现有 import。

## 7.5 生命周期契约表（必填 — 涉及 session/lease/agent_run/daemon/lifecycle/claim/heartbeat）

> **本变更为纯结构重构，不改变以下任何生命周期的状态机、事件、字段定义。** 下表用于自审确认重构未破坏现有契约。承载代码位置变更，契约本身不变。

### Runtime 生命周期（`DaemonRuntime`）

| 事件 | 触发 | 状态转移 | 关键字段 | 承载代码（变更后） |
|------|------|---------|---------|------------------|
| register | daemon 首次连接 | → online | runtime_id, user_id, last_heartbeat | runtime/service.py |
| heartbeat | 周期心跳 | online→online（刷新） | last_heartbeat | runtime/service.py |
| mark_offline | 心跳超时 / disable | online→offline | status | runtime/service.py |
| enable / disable | 用户操作 | offline↔online(disabled) | status, placement_enabled | runtime/service.py |
| delete | 用户删除物理 runtime | → (删除) | — | runtime/service.py |

### Lease 生命周期（`DaemonTaskLease`）

| 事件 | 状态转移 | 关键字段 | 承载（变更后） |
|------|---------|---------|---------------|
| create_lease | → pending | lease_id, runtime_id, agent_run_id, claim_token | lease/service.py |
| claim_lease | pending→claimed | claim_token, claimed_at | lease/service.py |
| start_lease | claimed→started | started_at | lease/service.py |
| lease_heartbeat | started→started（续约） | lease_expires_at | lease/service.py |
| complete_lease | started→completed | result, completed_at | lease/service.py |
| expire_leases | *→expired | lease_expires_at | lease/service.py |

> 并存说明（Grill 修正）：`DaemonLeaseService`（`lease_service.py`）的 `cancel_lease` 被 agent 跨模块调用（`agent/service.py:545`），与上表 `LeaseService`（承接 `DaemonService.lease_*`）分管 lease 不同操作，原位保留。两者方法集（claim/heartbeat/expire 等）部分重叠、契约一致；是否统一为单一 lease API 留待独立评估，本变更不处理。

### AgentRun 状态同步（run_sync，操作 `AgentRun`）

| 事件 | 状态转移 | 承载（变更后） |
|------|---------|---------------|
| sync_agent_run_status | daemon 侧 → AgentRun.status | run_sync/service.py |
| close_interactive_run | running→completed/failed（交互式 run 关闭） | run_sync/service.py |
| submit_messages | （向 lease 提交对话消息，驱动 run） | run_sync/service.py |
| post_scan_validation | scan 完成后结构化校验 | run_sync/service.py |

### Session 生命周期（`AgentSession`）— 最大子域

| 事件 | 状态转移 | 关键字段 | 承载（变更后） |
|------|---------|---------|---------------|
| create_session | → pending→active | session_id, user_id, status | session/service.py |
| inject_session | active→active（新 turn） | current AgentRun | session/service.py |
| interrupt_session | active run→interrupted | turn 级中断 | session/service.py |
| end_session | active→ended | status | session/service.py |
| recover_session_after_daemon_restart | active→reconnecting→active/failed | status, recovery 状态 | session/service.py |
| confirm_session_reconnected | reconnecting→active | status | session/service.py |
| mark_session_recovery_failed | reconnecting→failed | status | session/service.py |
| reopen_session | ended→（SDK resume） | claude_session_id | session/service.py |
| delete_agent_session | 仅终态可删；活动返回 409 | — | session/service.py |

> 活动态定义不变：`pending/active/reconnecting`（`ACTIVE_SESSION_STATUSES`，`ACTIVE_TURN_STATUSES`，`TERMINAL_TURN_STATUSES` 三个 frozenset 随 session 子域迁移）。

**自审结论**：上表所有事件在重构后均有明确承载位置，状态机与字段定义零变更。`fix-interactive-lifecycle` W4 即将接通的 `recover/confirm-reconnected/mark-recovery-failed` 三个 HTTP 端点，对应的事件已在上表（recover/confirm/mark 三行）—— 本拆分不删除这些方法，仅迁移位置，W4 在新位置接通即可（见 §10 R3）。

## 8. 数据模型

**无表结构 / 字段变更**。本变更不涉及 Alembic 迁移。`DaemonRuntime` / `DaemonTaskLease` / `AgentSession` / `AgentRun` / `AgentRunLog` 表定义保持不变（`model.py` 不动）。

## 9. 兼容策略（brownfield 必填）

| 维度 | 策略 |
|------|------|
| 对外 API（`/api/daemon/*`） | 零变更（router 不动） |
| `DaemonService` 方法签名 | 全部保留（facade 委托） |
| 异常类 import 路径 | facade re-export 保持 `from ...service import XxxError` 不变 |
| `DaemonLeaseService` | 原位保留（独立活 service，`cancel_lease` 被 agent 调用，import 路径不变） |
| 子 service 之间的调用 | lazy import / 持有引用，避免循环 |
| 回滚 | 每个 Wave 独立提交；任意 Wave 可 `git revert` 而不影响 facade 契约（W1 之后 facade 始终有效） |

## 10. 风险登记

| ID | 风险 | 影响 | 缓解 |
|----|------|------|------|
| R1 | 子包循环引用（session↔lease↔run_sync） | import 失败 | lazy import / 构造期持有引用；W1 验证 |
| R2 | 私有辅助方法归属歧义 | 迁移遗漏 | 随主方法归位；§6 清单已列全；execute 逐一核对调用点 |
| R3 | 与 `2026-06-19-fix-interactive-daemon-lifecycle` W4 文件冲突 | W4 改 `router.py`(+3 端点) + `service.py`(+2 方法) 与本拆分动同一区域 | **执行顺序：先做本拆分**。W4 重头在 sillyhub-daemon 侧(cli.ts)，backend 增量小；拆分后 session 方法在固定位置，W4 重新定位简单。反之在巨石上加完再移动 diff 更大。W4 plan 需更新方法定位（`recover_session_after_daemon_restart` 等 → `session/service.py`） |
| R4 | facade 委托引入一层间接，调试栈变深 | 调试体验略降 | 可接受（换可维护性）；子 service 方法名与 facade 一致，栈可读 |
| R5 | lease 双写过渡期，两套并存可能被误用 | 行为不一致风险 | `lease/__init__` 明确导出规范 + 双写清理独立变更紧随；过渡期短 |
| R6 | `_publish_run_event`/`_publish_session_event` 跨域共享 | 重复或归属不清 | 按主对象：run 事件归 run_sync，session 事件归 session；如确有共享抽 `events.py` |

## 11. 决策追踪

详见 `decisions.md`。本 design 覆盖：

| 决策 | 内容 | 覆盖章节 |
|------|------|---------|
| D-001@v1 | 方向 A（就地拆子包）而非方向 B（抽顶层 session） | §3 N1, §5 |
| D-002@v1 | facade 完全兼容，router 零改动 | §2.3, §7.1, §9 |
| D-003@v1 | lease 先拆后清（双写暂留） | §3 N2, §5.3 W6, §7.5 |
| D-004@v1 | 方案 A 5 子域标准粒度（session 不细分） | §5.2 |

## 12. 自审

- [x] 53 方法全部归位（§6 清单 + §7.5 契约表交叉核对，无遗漏）
- [x] 生命周期契约表完整（runtime/lease/run_sync/session 四对象全覆盖，每事件有承载位置）
- [x] 关键词命中（session/lease/agent_run/daemon/lifecycle/claim/heartbeat）→ 契约表已生成
- [x] brownfield 兼容策略明确（§9）
- [x] 非目标边界清晰（§3，7 条）
- [x] 文件变更清单含操作类型（新增/修改/不动）
- [x] Wave 化、每 Wave 可独立验证回滚（§5.3）
- [x] W4 冲突有明确协调方案（§10 R3）
- [x] 无数据库变更（§8）
- [x] 异常类 import 兼容（§7.3 re-export）
- [x] 决策可追溯（§11 + decisions.md）

**自审结论**：通过。design 自洽，边界清晰，契约不�