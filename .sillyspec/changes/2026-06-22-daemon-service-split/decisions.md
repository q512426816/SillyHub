---
author: qinyi
created_at: 2026-06-22T09:47:00+08:00
---

# 决策记录 — daemon-service-split

> 本变更在 brainstorm 阶段（对话式探索 + 方案选择）产生的实现相关决策。design.md §11 引用。

---

## D-001@v1 — 拆分方向：就地拆子包（方向 A），不抽顶层 session 模块（方向 B）

**背景**：session 子域占 `service.py` ~40%（~1380 行），且其 model（`AgentSession/AgentRun/AgentRunLog`）定义在 `agent` 模块，daemon import 之 —— 这是 agent↔daemon 双向耦合（agent 被 import 145 次、daemon 116 次）的具象。

**选项**：
- 方向 A：在 `daemon/` 内拆 `session/` 子包，仍 import agent.model（耦合保留）
- 方向 B：抽顶层 `session/` 模块，model 从 agent 迁出，agent/daemon 双向依赖它（解开耦合）

**决策**：方向 A。

**理由**：
1. 方向 B 是 model 归属迁移，工作量大、风险高（动 agent 核心模型 + 双向改 import）。
2. 方向 B 与 memory 记录的 `delegate_task` spike 同根（远程多 Agent 执行），应作为独立 P2 变更整体设计，而非捎带在拆分里。
3. 当前急需解决的是"单类 3000 行"的可维护性（P0 止血），方向 A 已充分达成。
4. V1 未上线，方向 B 留待功能稳定后做代价更低。

**影响**：design §3 N1、§5。本变更 import `AgentSession` 等的现状保留。

---

## D-002@v1 — facade 完全兼容：`DaemonService` 保留全部方法签名内部委托，`router.py` 零改动

**背景**：`router.py`（1238 行）每个端点 `svc = DaemonService(session)` 后直接调方法，强耦合于 `DaemonService` 方法集。

**选项**：
- A：facade 完全兼容（保留签名 + 委托，router 零改动）
- B：router 渐进迁移到直接调子 service，最终移除 facade

**决策**：A。

**理由**：
1. "行为不变"是本变更的核心约束，A 风险最低。
2. B 要改 1238 行 router 的全部实例化点，回归风险大，收益（去掉 facade 间接层）不值得。
3. facade 间接层（R4）可接受，换可维护性。
4. router 零改动是可机器验证的验收铁证（`git diff router.py` 为空）。

**影响**：design §2.3、§7.1、§9。

---

## D-003@v1 — lease 处理：DaemonLeaseService 原位保留（独立活 service），仅迁 DaemonService.lease_*

> ⚠️ Design Grill 修正：本决策的前提从"双写待清理"更正为"两个 service 各有活调用方"。

**背景**（修正后）：原以为 lease "双写"。Grill 交叉审查发现 `DaemonLeaseService.cancel_lease` 被 **agent 模块跨模块调用**（`agent/service.py:545-547`，kill run 时 flip lease），是**独立活 service**，非死代码。`DaemonService.lease_*`（正向生命周期 create/claim/start/complete/expire）与 `DaemonLeaseService`（cancel 能力 + 部分重叠方法）分管 lease 不同操作，各有活调用方，**非纯粹待清理重复**。

**决策**：
- `DaemonLeaseService`（`lease_service.py`）**原位保留不动**，与 `permission_service` 同等地位（不并入 `lease/` 子包，不 re-export）。
- 本次仅将 `DaemonService.lease_*` 迁入新 `lease/service.py`（`LeaseService`）。
- 两者方法集（claim/heartbeat/expire）部分重叠，是否统一为单一 lease API 留独立评估，本变更不处理。

**理由**：
1. `DaemonLeaseService` 是活契约（agent 依赖其 import 路径 `from app.modules.daemon.lease_service import DaemonLeaseService`），移动会破 agent import，违反 N5（不动 agent）。
2. 保留现状 = 零风险；统一评估需要逐方法判断哪套是活的，属语义判断，不该混入纯结构重构。
3. 原选项 B（本次合并）已被否决——前提"双写"不成立，无从合并。

**影响**：design §1、§3 N2、§5.3 W6、§7.5、§10 R5。`lease/__init__.py` 仅导出 `LeaseService`。

---

## D-004@v1 — 拆分粒度：方案 A（5 子域标准），session 整体一个子包不细分

**背景**：session 占 ~1380 行，拆后仍是次大单元。是否再拆 `session/{lifecycle,recovery,query}/`？

**选项**：
- 方案 A：5 子域，session 整体一个 `service.py`（~1380 行）
- 方案 B：5 子域 + session 再拆 3 子文件（~450 行/文件）
- 方案 C：3 子域粗粒度，run_sync/patch 归 `_internal`

**决策**：方案 A。

**理由**：
1. 与 `ppm` 的 `problem/plan/project/task/kanban` 模式完全对齐，团队已有心智模型，一致性即收益。
2. 3500→1380 已充分止血；方案 B 把 session 状态机（create→inject→recover 紧耦合）强行分文件，割裂且收益递减。
3. 方案 C 把 run_sync（独立关注点：AgentRun 状态）塞进 session，是债转移非消除。

**影响**：design §5.2。session 子域内部不再细分。
