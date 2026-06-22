---
author: qinyi
created_at: 2026-06-22T10:08:00+08:00
---

# Proposal

## 动机

`backend/app/modules/daemon/service.py` 的 `DaemonService` 是一个 **277→3324 行的单类（约 3000 行类体、51 个方法）上帝类**，单一类承担了 daemon 模块几乎全部业务逻辑（runtime/lease/run_sync/session/patch 五个生命周期）。这是整个 backend 最大的可维护性瓶颈，且仍在加速膨胀（最近 `daemon-api-key`、`menu-driven-permissions` 持续往里加）。

对照同仓库 `ppm` 模块（`problem/plan/project/task/kanban` 子域分层）已示范的子包分层最佳实践，daemon 应照此拆分，把单类巨石拆成按生命周期组织的子域子包，让每个子域独立可读、可测、可演进。

## 关键问题（为什么现有方案不够）

1. **单类 3000 行、51 方法，认知与导航成本极高**。任何 daemon 相关改动都要在巨型类里定位，回归风险大；新成员难以建立心智模型。`permission_service.py`（696 行）和 `ws_hub.py`（452 行）已成功独立拆出，证明拆分可行，但主体仍堆在 `DaemonService`。

2. **职责边界模糊，违反 SRP**。runtime（进程注册）、lease（任务租约）、run_sync（AgentRun 状态同步）、session（交互式会话，占 ~40%）、patch（diff 应用）五个不同关注点挤在一个类，方法间隐式耦合，难以独立测试和演进。尤其 `close_interactive_run`/`sync_agent_run_status`（操作 `AgentRun`）与 `create_session`/`end_session`（操作 `AgentSession`）两个状态机缠绕。

3. **`router.py`（1238 行）强耦合于 `DaemonService` 方法集**，每个端点 `svc = DaemonService(session)` 直接调方法。不拆分则 daemon 的任何结构改进都会牵动 router。

> 注：Design Grill 修正了"lease 双写"的初始判断 —— `DaemonLeaseService.cancel_lease` 被 agent 跨模块调用，是独立活 service（见 decisions D-003），非待清理的死代码。本变更不处理它。

## 变更范围

1. 把 `DaemonService` 按**操作的主对象**拆成 5 个子域子包：`runtime/`（DaemonRuntime）、`lease/`（DaemonTaskLease 正向生命周期）、`run_sync/`（AgentRun 状态同步）、`session/`（AgentSession，最大子域）、`patch/`（worktree diff 应用）。
2. `service.py` 的 `DaemonService` 退化为**薄 facade**：保留全部 51 个方法签名不变，内部委托 5 个子 service。
3. **`router.py` 零改动**（facade 完全兼容）—— 所有调用方零感知。
4. **运行时行为不变** —— 纯文件移动 + import 整理，无逻辑变更，无数据库变更。
5. 异常类迁入对应子包定义，facade `service.py` 集中 re-export，保持 `from app.modules.daemon.service import XxxError` 路径不变。
6. 按 6 个 Wave 推进（W1 建 facade 安全网 → W2-W6 逐域迁移），每 Wave 独立提交、独立验证、独立回滚。
7. 更新 `daemon.md` 模块文档（契约摘要 + 变更记录）。

## 不在范围内（显式清单）

- **不抽顶层 `session/` 模块**（方向 B）：model 归属迁移（`AgentSession` 从 agent 迁出）工作量大、与 `delegate_task` spike 同根，留独立 P2 变更（D-001）。
- **不合并 / 不迁移 `DaemonLeaseService`**：它是独立活 service（`cancel_lease` 被 agent 跨模块调用），原位保留，与 `permission_service` 同等（D-003）。
- **不改 `router.py`**：facade 完全兼容（D-002）。
- **不改运行时行为 / 不动数据库表**：纯结构重构。
- **不重构 `agent`/`workspace` 耦合**：`import AgentSession/AgentRun/AgentRunLog/Workspace` 现状保留，方向 B 才解。
- **不拆 `permission_service.py`/`ws_hub.py`/`lease_service.py`**：已独立或独立活，保持。
- **不动 `agent` 模块**（P1 子域分层）：独立变更。
- **不统一 `LeaseService` 与 `DaemonLeaseService` 的重叠方法**：留独立评估。

## 成功标准（可验证）

- ✅ `git diff backend/app/modules/daemon/router.py` **为空**（零改动铁证，D-002）。
- ✅ daemon 模块全量测试通过（含 `test_session_recovery` 16 用例、`test_lease_service`、`test_run_input_service` 等）。
- ✅ backend `mypy` + `ruff` 全过。
- ✅ `grep "class DaemonService" service.py` 确认 facade 化（类体内为委托，无业务逻辑）。
- ✅ `DaemonService` 51 个方法签名、返回值、异常类型**全部不变**（对照迁移前后）。
- ✅ 每个 Wave 后 `agent/service.py:545` 的 `from app.modules.daemon.lease_service import DaemonLeaseService` 仍可 import（D-003 兼容）。
- ✅ `router.py:55` import 的 9 个异常类 + `DaemonService` 仍可从 `service` import（re-export 兼容）。
- ✅ 迁移前后 runtime/lease/session/agent_run 生命周期状态流转对比一致（契约不变，FR-04）。
- ✅ service.py 拆分后，最大子域文件（session/service.py）≤ 1500 行。
