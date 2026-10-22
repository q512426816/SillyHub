---
author: flow-machine-draft
created_at: 2026-10-22T03:14:44.733Z
---
# 需求规格（Requirements）— 2026-10-22-turn-trigger-generalize

## 功能需求

### FR-01: turn_trigger 段泛化（task_wakeup 行为零变化）

- TurnSegment 必须以单一 `kind: "turn_trigger"`（携带 `trigger: TurnTriggerKind` 字段，枚举 task_wakeup/auto_resume/shadow_chat/group_chat）取代现 task_wakeup 专段；TurnTriggerView 必须按 trigger 配置表（图标字形/标签/提示语/正文是否折叠）渲染；task_wakeup 的既有呈现必须零变化（「✈ 收到任务消息（N 个后台任务已结束）」折叠行、展开全文、对话与进度两视图均渲染）；原 task_wakeup 段类型必须移除（渲染期计算段、无持久化数据，无迁移面）。

#### 场景：task_wakeup 等价回归

- Given 「[后台任务通知]」user_input 开轮的历史日志
- When logsToTurns 装配并渲染
- Then 段序列首部为 turn_trigger 段（trigger=task_wakeup），折叠行文案/展开交互与改造前一致

### FR-02: auto_resume 轮触发（断线自动续跑）

- 以 `[系统续跑` 开头（覆盖 daemon auto_resume.py 四模板共同前缀：[系统续跑提示]/[系统续跑]）的 user_input 必须归类为 turn_trigger(trigger=auto_resume)：正文按系统代笔折叠进触发行（标签「↻ 断线自动续跑」），prompt 槽保持空（开轮占位语义与 task_wakeup 同构）；内容前缀判定必须与 daemon 模板常量同步（跨语言常量同步义务注释，沿 TASK_WAKEUP_PROMPT_PREFIX 先例）。

#### 场景：续跑轮触发行

- Given daemon 重启续跑注入的「[系统续跑提示] …{原文}」user_input 开轮
- When 装配渲染
- Then prompt 为空、段首为 turn_trigger(trigger=auto_resume) 折叠行，展开可见续跑指令与原始任务全文

### FR-03: 影子直聊/群聊开轮来源标注（正文可见）

- 开轮 user_input 的前导头为「【影子直聊】」或「【群聊上下文】」时，必须产出 turn_trigger(trigger=shadow_chat/group_chat) 来源标注行（「💬 来自影子直聊」「👥 来自群聊」，正文不折叠、不可展开——消息正文照常按既有剥离逻辑显示为 prompt），且该前导不得再重复产出 preamble 段（进度视图由触发行承担来源展示，避免双卡）；中途到达的群聊引导注入（非开轮槽）必须维持既有 preamble 行为不变。

#### 场景：影子直聊开轮

- Given 「【影子直聊】前导 …
用户消息正文」user_input 开轮
- When 装配渲染
- Then 段序列含 turn_trigger(trigger=shadow_chat) 标注行（无展开交互）、无 shadow 前导的 preamble 段、prompt 为剥离前导后的用户正文气泡

#### 场景：中途群聊注入不产触发行

- Given 群聊引导注入落在轮中（非首条 user_input）
- When 装配
- Then 不产出 turn_trigger 段（既有 preamble/user_msg 行为不变）

### FR-04: 排队栏触发源事件行泛化

- MessageQueueBar 的事件行分流必须从 origin==='task_wakeup' 泛化为触发源集合（origin==='task_wakeup' 或以 'auto_resume:' 开头），按 trigger 渲染对应标签（收到任务消息（N 个后台任务已结束 · 本轮结束后自动继续）/ 断线自动续跑（本轮结束后自动继续））；显示计数与满员判定对触发源条目一律豁免（排队栏只呈现用户消息口径；后端 pending 配额实际计入 auto_resume，queue_full 由后端兜底——显示与配额的分叉为已知取舍）；auto_resume 条目的 ✎ 编辑抑制必须与 task_wakeup 同口径。

#### 场景：续跑条目事件行

- Given 排队含 1 条 origin='auto_resume:<uuid>' 条目与 1 条用户消息
- When 渲染
- Then 「排队消息（1）」仅计用户消息、事件行显示「↻ 断线自动续跑（本轮结束后自动继续）」

### FR-05: 回归与类型门

- 变更后前端 tsc --noEmit 必须零错误；受影响测试套件（session-log-assembler / turn-segment-views / runtime-session-helpers / message-queue-bar / turn-state 等）必须全绿。

#### 场景：回归

- When tsc 与目标 vitest 套件执行
- Then 零错全绿

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx「TurnTriggerView 按 kind 渲染——task_wakeup 与现状等价」+ runtime-session-helpers.test.tsx 既有唤醒段用例翻 turn_trigger 口径
FR-02: frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx「auto_resume 注入开轮 → 断线自动续跑触发行」
FR-03: frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx「影子直聊/群聊开轮来源标注且正文可见」「中途群聊注入不产触发行」
FR-04: frontend/src/components/daemon/__tests__/message-queue-bar.test.tsx「auto_resume 条目事件行与计数口径」
FR-05: frontend tsc --noEmit + 受影响 vitest 套件（套件级门，无单用例）
