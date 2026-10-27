---
author: flow-machine-draft
created_at: 2026-10-27T04:37:17.255Z
---
# 需求规格（Requirements）— 2026-10-27-turn-phase-observability-monotonic

## 功能需求

### FR-01: daemon 层 turn_phase POST 失败从 debug 提为首警 warn（复用 turn-phase-observability 的 warnOncePhaseFailure 同 session+phase 去重惯例），成功仍静默

- 桥层拦截分支（daemon.ts onTurnMessage 的 turn_phase_report 处理）的 notifyTurnPhase 失败（异步 reject 与同步抛两路）必须各补首警 warn（turn_phase_report_failed_once 事件，同 session_id+phase 去重），debug 明细必须保留，成功路径必须保持静默零变化。

#### 场景：主路径

Given 桥层收到 phase 上报桥消息 / When notifyTurnPhase reject（网络故障）/ Then 不抛出且 logger.warn 恰好一次（含 session_id/run_id/phase/error 摘要）；同 (session, phase) 第二次失败静默；成功调用不产生 warn。

### FR-02: 前端 applyTurnPhase 单调守卫：dispatched/delivered 不覆盖已是执行期阶段（skills_sync 至 inject_received）或 first_event 的 currentPhase（回退写静默丢弃，正常推进与乱序前跳不受影响）

- applyTurnPhase 写入前必须按词表九值序判定：新 phase 与现 currentPhase 均为词表内值且新序小于现序时必须丢弃该写入（返回保持现值）；前跳、同值覆盖、词表外值（任一方未知）必须维持既有 last-write-wins 透传行为。

#### 场景：主路径

Given 轮 currentPhase=first_event（或 spawning/inject_received）/ When delivered 事件（steering 忙轮注入回执）到达 / Then currentPhase 保持不变；Given currentPhase=delivered / When 迟到 dispatched 到达 / Then 保持 delivered（乱序前跳顺手修正）；Given 词表外值 future_x / When 任意词表值到达 / Then 照常覆盖（兼容策略零回归）。

### FR-03: log 到达退位集合从 {dispatched, delivered} 扩展含 inject_received（AI 已输出的场合送达信号同样失去展示意义）

- retireDeliveryPhase 的退位集合必须包含 dispatched、delivered、inject_received 三值；log 事件目标轮 currentPhase 为三者之一时必须清 null；其余执行期阶段（skills_sync 至 ready）与无值必须保持不清除。

#### 场景：主路径

Given 轮 currentPhase={phase:"inject_received"} / When 该轮 log 信封经 upsertTurn / Then currentPhase 变 null；Given currentPhase={phase:"ready"} 同条件 / Then 保留。

### FR-04: 既有相关测试全绿，新增用例覆盖上述三项行为

- 本次触及的 daemon turn-phase 测试与前端 turn-phase/turn-state 测试必须全部通过，且必须新增用例分别锚定 FR-01 首警去重、FR-02 回退丢弃与前跳/未知值零回归、FR-03 集合扩展。

#### 场景：主路径

Given 本次改动 / When 跑相关测试文件 / Then 全绿且新增用例覆盖三项行为与对照场景。

### FR-05: 后端 backend 代码零改动（daemon 与 frontend 各自范围内）

- 本变更必须只改 sillyhub-daemon 与 frontend 侧文件；backend 目录禁止有任何 diff；SSE 协议与词表九值零改动，无 gen:types 义务。

#### 场景：主路径

Given 变更收口 / When 检查 git diff 文件清单 / Then 改动仅限 daemon 1 文件 + frontend 2 文件 + 两侧测试文件。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/sillyhub-daemon/tests/turn-phase-report.test.ts「② daemon.onTurnMessage turn_phase_report 拦截 > notifyTurnPhase reject → 首警 warn 一次（同 session+phase 去重）」
FR-02: test/frontend/src/lib/daemon/__tests__/session-stream-turn-phase.test.ts「applyTurnPhase 单调守卫 > delivered 不覆盖 first_event（steering 注入回执退化防护）」
FR-02: test/frontend/src/lib/daemon/__tests__/session-stream-turn-phase.test.ts「applyTurnPhase 单调守卫 > 迟到 dispatched 不覆盖 delivered（乱序前跳修正）」
FR-02: test/frontend/src/lib/daemon/__tests__/session-stream-turn-phase.test.ts「applyTurnPhase 单调守卫 > 词表外值不参与守卫照常覆盖（兼容零回归）」
FR-03: test/frontend/src/lib/daemon/__tests__/session-stream-turn-phase.test.ts「retireDeliveryPhase（log 兜底退位）> inject_received 清 null / ready 保留」
FR-04: test/sillyhub-daemon/tests/turn-phase-report.test.ts「（既有 ①②③ 段全量回归）」
FR-05: 不适用：纯约束条款（diff 范围控制），由 change.patch 文件清单在收口时验证。
