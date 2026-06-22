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

---

## D-005@v1 — facade 子 service import 策略：`__init__` 内函数级 lazy import（修正 task-01 模块级循环）

> execute W2（task-02）启动前实测发现的 plan 缺陷修正。design §7.2 已预见，task-01 实现误用顶部模块级 import。

**背景**：task-01（W1）在 facade `service.py` **顶部模块级** import 5 个子 service（`from app.modules.daemon.runtime.service import RuntimeService` 等）。task-02~06 的子 service 需要**顶层** import facade 定义的异常类（`DaemonRuntimeNotFound` / `DaemonSessionNotFound` / `PatchApplyError` 等，task-07 前仍留在 `service.py`）。这构成 `service.py ↔ 子包` 双向模块级依赖 = **循环 import**。实测两方向均抛 `ImportError: cannot import name ... (most likely due to a circular import)`。task-01 的 import 冒烟能过，仅因子包当时是空壳、不反向 import。

**选项**：
- A：facade `__init__` 内函数级 lazy import 子 service（router.py:624 同款模式），子 service 保持顶层 import 异常类
- B：子 service 方法内函数级 lazy import 异常类，facade 保持顶部 import（task-01 不变）
- C：异常类提前迁 `daemon/errors.py` + facade re-export（提前做 task-07 核心）

**决策**：A。

**理由**：
1. design §7.2 明确要求「避免模块级循环 import」，A 正是该原则的实现落地。
2. router.py:624 已有函数级 lazy import 先例（注释说明：模块级 import 会绑死 mock 引用，函数级 import 才能被 per-test patch），项目接受此模式。
3. 实测验证：A 改动后两方向 import 均成功、mypy 通过（`self._rt: RuntimeService` 注解在 `from __future__ import annotations` 下被正确解析）、daemon 全测 43 passed 行为不变、router diff 空。
4. B 让每个用异常的方法重复 lazy import，代码冗余，偏离 task-02~06 蓝图「顶层 import」写法；C 工作量大（提前 task-07），task-02 范围膨胀。A 改动最小、子 service 写法不变。

**影响**：
- 修正 task-01 的 `service.py`：顶部 5 行子 service import 删除，移入 `__init__` 内函数级 import（5 行，持引用之前）。
- task-02~06 蓝图**不变**：子 service 顶层 `from app.modules.daemon.service import DaemonRuntimeNotFound` 等照旧（单向依赖：子 → facade 异常类；facade → 子 仅 `__init__` 内 lazy，不构成模块级循环）。
- task-07（异常类 re-export）不受影响。
- facade 性能可忽略：`__init__` 内 import 有 `sys.modules` 缓存，首次后零成本；`DaemonService(session)` 每请求实例化一次，5 次 dict 查找无感。

---

## D-006@v1 — 跨子域调用统一策略：子 service 持有 facade 引用（`self._facade`）

> execute W4（task-04）确立，W5/W6 沿用。design §7.2「持有对方引用」的具体落地。

**背景**：子域方法迁移后，子 service 方法体内仍需调用**未迁/跨域**的辅助（W4 时 `_get_lease_and_verify_token` 属 lease、`_publish_session_event` 属 session，均在 facade）。design §7.2 给了「持有对方引用 / 函数级 lazy import」两选项，需统一策略避免每个子代理各选各的。

**选项**：
- A：子 service 持有 facade 引用（`self._facade`），facade `__init__` 构造子 service 后注入 `self._x._facade = self`；方法体 `self._facade.<跨域方法>()`
- B：函数级 lazy import 对方子 service + 局部实例化
- C：每个子 service 互相持有对方引用（如 SessionService 持有 LeaseService）

**决策**：A。

**理由**：
1. W4-W6 串行，跨域目标方法在 W4/W5 时点仍在 facade（task-06 才迁 lease、task-05 才迁 session），C 无法立即用（对方子 service 是空壳）。
2. facade 始终保留全部方法委托（D-002），即使 task-05/06 迁完，`self._facade._get_lease_and_verify_token` 仍经 facade 委托到 LeaseService，**W4 的代码无需后续修改**，不耦合 Wave 顺序。
3. B 每次调用 lazy import + 实例化，开销大且状态不一致（新实例持有新 session/子 service）。
4. C 在全部 Wave 完成后才干净，过渡期（W4/W5）对方子 service 是空壳，不可行。

**影响**：
- 需要跨域调用的子 service（task-04 RunSyncService、task-05 SessionService、task-06 LeaseService）`__init__` 内设 `self._facade: "DaemonService | None" = None`（`TYPE_CHECKING` import 避免循环），facade `__init__` 注入 `self._x._facade = self`。
- 方法体内跨域调用改 `self._facade.<method>()`（随主方法逐字搬运时，把 `self.<跨域方法>` 改为 `self._facade.<跨域方法>`；本子域方法 `self.<本域方法>` 不变）。
- **测试 mock 跟随**：模块级符号（如 `get_redis`）被迁入子 service 后，测试 `patch("app.modules.daemon.service.get_redis")` 失效，patch 目标必须跟随到子包模块（`app.modules.daemon.run_sync.service.get_redis`）。这是结构迁移的必要测试维护，**源码 API 零变化**，仅 patch 目标跟随代码物理位置。task-04 已处理（test_session_sse / test_interactive_lifecycle_patch 的 mocked_redis）。
