---
author: flow-machine-draft
created_at: 2026-10-27T03:15:55.524Z
---
# 需求规格（Requirements）— 2026-10-27-turn-phase-stall-honest-ui

## 功能需求

### FR-01: 轮状态条对 dispatched/delivered 阶段停留超时（沿用 30 秒阈值）的展示改为排队语义文案（保留已等待秒数），其余阶段超时行为零变化

- 轮状态条在 phase 为 dispatched 或 delivered 且停留 ≥ PHASE_TIMEOUT_MS（30 秒）时，标签位必须切换为 DELIVERY_STALL_LABEL 排队语义文案（「已等待 N 秒」后缀与警示样式保留）；30 秒内及其他阶段超时必须保持词表文案原样。

#### 场景：主路径

Given 轮运行中且 currentPhase={phase: "delivered"} / When 停留推进 ≥30 秒 / Then 标签显「等待执行器开始处理」+「已等待 N 秒」+ warning 样式；Given phase="spawning" 同条件 / Then 仍显「正在启动 AI 进程」（零回归）；Given phase="delivered" 且停留 <30 秒 / Then 仍显「执行器已接收」。

### FR-02: 当轮收到任意 log 事件且 currentPhase 仍为 dispatched 或 delivered 时，立即清除该 phase，状态条退位回轮状态文案

- upsertTurn 处理 event="log" 的信封时，必须对 apply 后的目标轮执行 retireDeliveryPhase：currentPhase 为 dispatched/delivered 即清 null；执行期阶段（如 spawning）与无 phase 禁止清除；非 log 事件必须不触发清除（终态清理仍由 clearTurnPhase 负责）。

#### 场景：主路径

Given 轮 currentPhase={phase:"delivered"} / When 该轮 log 信封经 upsertTurn / Then currentPhase 变 null（状态条退位回「执行中」）；Given currentPhase={phase:"spawning"} 同条件 / Then 保留；Given 非事件（turn_completed）/ Then 不清除。

### FR-03: frontend 既有 turn-phase 相关测试全部通过，并新增测试覆盖上述两个行为

- 本次改动触及的 turn-phase 相关测试文件（状态条、turn-state 纯函数、upsertTurn 消费方）必须全部通过，且必须新增用例分别锚定 FR-01 的停滞文案与 FR-02 的 log 退位（含零回归对照）。

#### 场景：主路径

Given 本次改动 / When 跑相关测试文件 / Then 全绿且新增用例覆盖 FR-01/FR-02 行为与对照场景。

### FR-04: 不改动后端与 daemon 代码

- 本变更必须只改 frontend 侧文件（turn-state.ts / turn-status-bar.tsx 及对应测试）；backend 与 sillyhub-daemon 目录禁止有任何 diff；不涉及后端 schema，无需 gen:types。

#### 场景：主路径

Given 变更收口 / When 检查 git diff 文件清单 / Then 改动仅限 frontend 四文件。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/frontend/src/components/daemon/__tests__/turn-status-bar-phase.test.tsx「投递阶段停滞文案 > delivered 停留 ≥30s → 排队语义文案 + 警示样式 + 已等待秒数」
FR-01: test/frontend/src/components/daemon/__tests__/turn-status-bar-phase.test.tsx「投递阶段停滞文案 > dispatched 停留 ≥30s → 同款排队语义文案」
FR-01: test/frontend/src/components/daemon/__tests__/turn-status-bar-phase.test.tsx「投递阶段停滞文案 > 执行期阶段（spawning）停滞 ≥30s 仍显词表文案——排队语义只限投递两阶段」
FR-02: test/frontend/src/lib/daemon/__tests__/session-stream-turn-phase.test.ts「upsertTurn log 事件投递阶段退位 > log 到达时轮仍挂 delivered → currentPhase 被清除」
FR-02: test/frontend/src/lib/daemon/__tests__/session-stream-turn-phase.test.ts「upsertTurn log 事件投递阶段退位 > log 到达时轮挂非投递阶段（spawning）→ 保留」
FR-02: test/frontend/src/lib/daemon/__tests__/session-stream-turn-phase.test.ts「upsertTurn log 事件投递阶段退位 > 非 log 事件（turn_completed）不触发退位——delivered 清除只认 log」
FR-03: test/frontend/src/components/daemon/__tests__/turn-state-subagent-routing.test.ts「（upsertTurn 既有 36 项回归全绿）」
FR-04: 不适用：纯约束条款（diff 范围控制），无独立测试面——由本变更 change.patch 文件清单在收口时验证（仅 frontend 四文件）。
