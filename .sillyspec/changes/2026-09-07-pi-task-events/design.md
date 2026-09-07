---
author: qinyi
created_at: 2026-09-07 10:16:46
scale: large
---

# 设计文档（Design）— pi 引擎任务事件派生

## 背景

2026-09-04-session-task-execution-panel（已归档）为会话面板新增了任务执行面板（任务清单/运行中/轮次历史三页签），数据来自 daemon 上报的 `agent_task_status` 事件（新表 `agent_session_task` 持久化）。该变更把 pi 引擎留在了空态边界（原 design 决策 D-003：无任务事件的引擎显示空态不报错）——pi 的原始事件流没有任务级事件（无 claude 的 task_* system 帧、无 TodoWrite 结构），当时不为凑齐多引擎强改适配器。

用户实测发现 pi 会话任务面板恒为空，确认要做派生补齐：从 pi 的原始事件流（工具调用、轮次流）派生出任务事件，让 pi 会话也有任务进度数据。

## 设计目标

1. pi 会话在任务执行面板每轮（turn）恰好一行任务：running 期间随工具调用实时刷新（正在调用什么工具/次数），轮终显示成功/失败与耗时。
2. 派生逻辑内聚在 `pi-events.ts` 归一化器（方案 A，D-002），session-manager / cli / backend / 前端全链路零改动复用。
3. 不破坏 pi-events 现有纯函数测试范式与既有映射语义。

## 非目标

- 不做 pi 子代理派生（pi 原始流无 Task/Agent 工具概念）。
- 不做计划事件（pi 无 plan_mode 类事件，任务清单页签的总纲条对 pi 会话不显示——既有 R-07 降级语义天然覆盖）。
- 不改 claude/codex 引擎的任何行为。
- 不改前端面板组件（纯数据链路补齐，UI 零变化——原型跳过：无界面变化档）。
- 不动批量适配器 `pi-json.ts`（打印模式无会话面板场景）。

## 拆分判断

单变更不拆分：派生状态机+测试同链路，拆开无独立交付价值。非批量模式。

## 总体方案

**派生规则（D-001）**——PiEventNormalizer 增加实例级 `turnTask` 聚合状态（按 driver 实例持有：pi-rpc-driver.ts:518 `new PiEventNormalizer()` 每会话一实例，turn 边界事件做状态推进点；`normalizeRpcLine` 单行解析仍独立无跨行耦合）：

| pi 事件 | turnTask 状态动作 | 产出事件 |
|---|---|---|
| `turn_start` | 建/复 running：task_id=`pi-t<turnSeq>`（实例内单调递增）；task_name='执行任务'（pi 无首轮摘要可提取，保守命名）；started 基准记 `Date.now()`（now() 注入可测） | `status/agent_task_status(running)` |
| `tool_execution_start` | last_tool_name=toolName；tool_uses+1；summary=`正在调用 <toolName>` | `status/agent_task_status(running)`（刷新） |
| `tool_execution_end` | 不终态（工具成败≠任务成败）；无新事件（避免事件洪水；tool_uses 已在 start 计） | — |
| `turn_end`（stopReason==='error'） | status=failed；summary=errorMessage；finished 基准 | `status/agent_task_status(failed)` |
| `turn_end`（其余 stopReason，fixture 实证仅 'stop'） | status=completed；finished 基准 | `status/agent_task_status(completed)` |
| `error`（顶层/extension_error/ame.error） | 置 pendingError（若轮内无 turn_end 承接，下一个 turn_start 前由 driver agent_settled 收敛，任务行保持 running 由下一轮 turn_start 复用覆盖——与 pi 轮失败主要经 turn_end 浮出的实证一致，real-error-turn.jsonl） | — |

字段契约对齐 `AgentTaskStatusEvent`（backend schema.py:1219）：task_id/task_name/status 必填五项 + `last_tool_name`/`summary`/`elapsed_ms`（start 基准差值）/`tool_uses`（可选四项），claude-events `_normalizeTaskMessage`（claude-events.ts:663-797）同构 metadata 键。

**下游链路（零改动复用）**：status/agent_task_status 事件 → pi-rpc-driver `onTurnMessage` envelope → session-manager `_onMessage` → `_dispatchStatusEvent`（envelopeHasTaskToolUse=false 走 `_handleAgentTaskStatusEvent` 注册表口径）→ `_emitSessionEvent` → cli.ts:846 `onSessionEvent` switch → `notifyAgentTaskStatus` 上报 → backend 落库+SSE → 前端面板。

**状态机边界语义**：

- turn_start 到达时若上一轮任务仍 running（异常流：上一轮 turn_end 丢失）——先补发上轮 completed（防御），再开新行；不产生悬挂 running。
- `agent_settled`（driver 收敛信号，现不经归一化器）不触碰 turnTask 状态——轮边界以 turn_start/turn_end 为准。
- interrupt（用户打断）：grill 实证——`aborted` 不是 stopReason 取值（fixture 全量仅 `stop`/`error` 两值），pi 的 abort 语义走 message_update ame.error reason='aborted'（pi-rpc-driver.ts:999 → error 事件），轮收尾 stopReason 为 'stop'。故无 aborted→stopped 映射：被打断的轮 turn_end 按 completed 收任务行（与轮实际产出一致，无悬挂 running）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/interactive/pi-events.ts | PiEventNormalizer 增实例级 turnTask 状态机与派生规则（数据流：producer=pi 原始 JSONL 行 → 归一化点=turnTask 状态推进 → consumer=status/agent_task_status 事件 → session-manager 既有分发） |
| 修改 | sillyhub-daemon/tests/interactive/pi-events.test.ts | 状态机用例：轮完整生命周期/工具刷新/异常流防御补终态/now 注入走秒；**既有用例预期数组适配**（turn_start/turn_end/tool_execution_start 触发的用例 expected 追加派生事件，属预期适配非破坏） |
| 新增 | sillyhub-daemon/tests/interactive/pi-task-dispatch.test.ts | 集成用例：pi 产出的 agent_task_status 经 session-manager _dispatchStatusEvent 正确 emit（复用既有 session-manager 测试 harness） |
| 修改 | .sillyspec/docs/SillyHub/modules/daemon.md | 模块卡 pi 段补任务事件派生说明（archive 前置同步） |

## 接口定义

无新增对外接口/DTO/端点（复用 AgentTaskStatusEvent 契约，`async` 字段 pi 恒 false 不传）。PiEventNormalizer 公共方法签名不变（`normalizeRpcLine(line: string): AgentEvent[]`），新增可选构造参数注入时钟：

```ts
constructor(opts?: { now?: () => number })
```

## 生命周期契约表

本变更涉及 session/daemon 关键词。pi 任务的生命周期：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| pi turn_start → agent_task_status(running) | PiEventNormalizer | session-manager（注册表）→ backend POST agent-task-status → agent_session_task 行 | session_id, run_id, task_id, task_name, status=running | agent_session_task 无则插入（started_at=now） |
| pi tool_execution_start → agent_task_status(running 刷新) | 同上 | 同上 | 同上 + last_tool_name/tool_uses/summary | 行刷新（None-keep 语义保 started_at） |
| pi turn_end → agent_task_status(completed/failed/stopped) | 同上 | 同上 | 同上 + summary（错误信息）| 终态定格（backend 已有终态吸收，finished_at 置位） |

## 数据模型

无新表/列变更（复用 agent_session_task）。

## 兼容策略

- pi-events 既有事件产出零变化（映射表不动，仅新增派生事件追加到返回数组——status 事件先行、内容事件随后，对齐 claude statusEvents 先行的 envelope 约定）。
- session-manager 对 pi 的 status 事件按既有 agent_task_status 口径处理，无 provider 特判。
- 旧版 backend（无 agent_session_task 表）收上报仅 4xx 记日志（既有旁路），不炸 daemon。
- 降级：派生状态机任何异常不得阻断原始事件流（turnTask 更新 try/catch 包裹，异常记 console.error 并跳过派生，内容事件照常）。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 归一化器引入实例状态后，既有用例的 expected 数组会因追加派生事件而变化（turn_start/turn_end/tool_execution_start 相关用例） | P0 | 映射表零改动；既有用例逐条适配（expected 追加派生事件，语义仍「原事件照旧 + 新派生事件追加」）；新状态机用例独立 describe |
| R-02 | session-manager 注册表口径对 pi 任务落 [TASK_STARTED] 行（chat 流新增行）可能干扰 pi 会话消息流观感 | P1 | _handleAgentTaskStatusEvent 落行行为对 claude/codex 一致——pi 用户已习惯任务行语义；实测观察，异常再收窄（如 pi 特判跳过落行留 execute 验证后定） |
| R-03 | turn_start 无对应 turn_end（daemon 重启/进程被杀）→ 任务行悬挂 running | P2 | backend upsert 终态吸收不影响悬挂行——接受（会话 ended 后行仍 running 与 claude 悬挂场景同口径）；不做跨重启清扫 |
| R-04 | task_id 命名冲突：pi-t<seq> 与 claude SDK task_id 空间撞 | P2 | pi 前缀 `pi-t` 区分；session 级唯一键 (session_id, task_id) 天然隔离 |

## 决策追踪

| 决策 | 状态 | 覆盖 |
|---|---|---|
| D-001@v1 派生粒度=一轮一任务 | accepted | 总体方案派生规则、生命周期契约表 |
| D-002@v1 归一化器内派生（⚠️ 自主决策待复核） | accepted | 总体方案、文件清单 |
| D-003@v1 设计整体确认（⚠️ 自主决策待复核） | accepted | 本文档全文 |

## 自审（Self-Review）

- ✅ 章节齐全（背景/目标/非目标/拆分/方案/清单/接口/生命周期契约表/数据模型/兼容/风险/决策/自审）。
- ✅ 生命周期契约表含（session/daemon 关键词命中）；三事件均有对应实现与测试任务。
- ✅ 文件清单 4 行全覆盖（含模块卡）；纯主仓变更无跨仓段；字段数据流已标注。
- ✅ 原型跳过声明：纯数据链路无 UI 变化（面板组件零改动）。
- ✅ D-001~D-003 全引用；自主决策标注。
- ⚠️ 自审存疑 1：`stopReason` 的实际取值枚举需在 execute 时对照 pi 0.81.1 types.d.ts 实证（现按 'error'/'aborted' 两值 + 其余兜底设计，fixture real-error-turn.jsonl 仅证实 error 值）。
- ⚠️ 自审存疑 2：`turn_start` 帧是否携带可提取的任务摘要字段（现按无设计，task_name 恒'执行任务'）——execute 时对照 pi 下行样例确认，若有更优来源再增强。
