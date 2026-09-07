---
author: qinyi
created_at: 2026-09-07 22:58:28
---

# 决策记录 — 2026-09-07-session-pin-rename-scheduled-send

## D-001@v1 定时发送的实现方案

- type: architecture
- source: ai（自主模式：CLI --wait 展示方案 A/B/C 后用户未及时作答，且 AskUserQuestion 无回执，按推荐方案继续；用户可随时否决重开）
- question: 定时发送如何实现——复用消息队列表加 dispatch_at，还是新建定时消息表 + 独立 sweeper 协程，还是前端到点触发？
- answer: **方案 B：新建 `agent_session_scheduled_messages` 表 + 独立 sweeper 常驻协程**。到点扫描 due 条目，逐条复用 `inject_session_as_service`（忙轮自动入 `agent_session_queued_messages` 既有队列），单条状态 pending → dispatched / cancelled / failed，失败隔离。
- reason:
  - 方案 A 把「忙轮排队」与「定时等待」两种语义混进一张表：既有队列五操作（reorder / dispatch-now / retry / edit / delete）全部要适配定时语义，动已验证的派发核心（`dispatch_next_queued_message`）回归风险高；
  - 方案 B 定时域与队列域解耦：定时到点只是「未来的一个 inject 调用」，inject 之后的忙轮排队/失败重试全套复用现成链路，零改动；
  - 方案 C 前端 setTimeout 到点触发不可靠（页面关闭即丢、多端冲突），直接排除；
  - sweeper 协程模式是本仓既有惯例（sweep.py 的 reconnect/lease/GC 三兄弟 + patrol.py），运维心智一致。
- 模块域: backend, frontend
- evidence: brainstorm 步骤 4 方案对比轮；代码依据 `backend/app/modules/daemon/sweep.py:776/:951`（sweeper 模式）、`backend/app/modules/daemon/session/service.py:3274`（inject_session_as_service）、`backend/app/modules/agent/model.py:1029`（AgentSessionQueuedMessage 忙轮队列表；Grill B-04 勘误：原误写 daemon/model.py）。

## D-003@v1 定时到点时队列满员的处理

- type: boundary
- priority: P2
- status: accepted
- source: design-grill（B-02）
- question: 定时消息到点时会话正忙且既有消息队列已满（SESSION_QUEUE_MAX_PENDING=5，inject 抛 DaemonSessionQueueFull）时如何处理——置 failed 还是延后自动重试？
- answer: **置 failed 并落 error_code=queue_full**（不盲发不丢弃，失败原因用户可见，可取消重建）。不选满员自动延后重试。
- normalized_requirement: sweeper 捕获 DaemonSessionQueueFull → 条目 status=failed、error_code='queue_full'；测试第四分支覆盖。
- impacts: [FR-05, R-07, test_scheduled_send_sweeper.py]
- 模块域: backend
- evidence: design.md §风险登记 R-07；`backend/app/modules/daemon/session/service.py:3546`（队列满员抛 DaemonSessionQueueFull）。
- reason: 重试风暴（每 30s 撞满员）与「用户以为已排队实际在循环失败」的语义欺骗比显式失败更差；显式 failed 与既有队列条目 failed 语义一致。

## D-002@v1 定时发送的模式与置顶范围

- type: requirement
- source: ai（自主模式：AskUserQuestion 无回执，按推荐默认继续，可 reopen 修订）
- question: 定时发送支持一次性还是周期重复？置顶是分组内还是全局？
- answer: 定时发送**仅一次性**（精确到分钟，到点发一次）；置顶为**分组内置顶**（置顶会话排在其所属工作区分组最前，多个置顶按最近活跃排）。
- reason:
  - 一次性覆盖绝大多数场景（「1 小时后让它继续」「明早 9 点发日报指令」），周期重复需要重复规则字段 + 续期/停止逻辑，复杂度显著上升，留作后续独立变更（YAGNI）；
  - 会话树按工作区分组是现有结构，分组内置顶不打乱「到工作区找会话」的习惯；全局置顶跨组抽离反而破坏树形心智。
- 模块域: backend, frontend
- evidence: brainstorm 步骤 3 需求澄清轮。
