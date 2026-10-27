---
author: qinyi
created_at: 2026-10-27 12:44:59
scale: large  # 见「拆分判断」Wave 证据
---

# 设计文档（Design）— 2026-10-28-bg-task-status-report

## 背景

用户实测（2026-10-27 截图实证）平台会话页的后台任务状态两头不准：①CLI 后台任务（run_in_background Bash）运行期间会话空闲，平台无任何运行中提示（「就像结束了一样」）；②任务完成后平台条目永远挂着「后台任务 · 运行中」（截图显示已完成的部署命令「运行中 02:14」）。

链路调研实证：daemon 已解析 tool_use 的 run_in_background 声明（sillyhub-daemon/src/interactive/session-manager/events.ts:578），启动条目经既有会话事件通道到达平台并显示（前端 SSE agent_session:{id} 频道消费；上报侧为 daemon HTTP 客户端封装——精确端点见接口定义节）；但**完成信号**（rollout jsonl 中 user 消息内嵌 `<task-notification>` XML，含 task-id + tool-use-id + status 三值）被 daemon 日志解析器（sillyhub-daemon/src/agent-log/parse-claude-code-jsonl.ts）完全忽略（grep 零命中）——缺口确切位置。

## 设计目标

1. 后台任务终态条目级翻转：启动条目不再永挂「运行中」，收到完成信号后翻转为已完成/失败。
2. 会话空闲期后台任务运行中提示：状态区显示「后台任务 N 个运行中」（启动-终态事件配对实时推导）。
3. 旧版 daemon 兼容：不上报终态时平台保持现状（不误翻、不报错）。

## 非目标

- 不做后台任务实时输出流转发（output-file 内容展示归既有日志查看，另立变更）。
- 不改 CLI（Claude Code）自身——只消费其日志。
- 不做跨会话/全局后台任务聚合视图。
- 不做心跳计数-only 兜底路线（D-002@v1 防复潮）与平台超时猜测翻转（D-003@v1 防复潮）。
- 不修「会话空闲时活动面板折叠」的交互问题（展示层已有折叠逻辑，仅加计数提示）。

## 拆分判断

**scale=large，Wave 证据**：
- 可真并行簇：Wave 1（daemon 解析+上报）与 Wave 2（backend 事件模型）文件零重叠，可并行；Wave 3（frontend 消费）依赖两者。
- 跨模块：sillyhub-daemon + backend + frontend 三子项目联动（同仓三段）。
- 治理需求：事件模型词表扩展涉及 payload 校验与 gen:types 双端义务（CLAUDE.md 规则 21）核查点。

## 总体方案（方案 A：事件级上报，D-001@v1）

### Wave 1 — daemon：task-notification 解析与上报

1. `sillyhub-daemon/src/agent-log/parse-claude-code-jsonl.ts`：识别 user 消息 content 中的 `<task-notification>` 文本块（文本前缀匹配 + XML 字段提取：task-id/tool-use-id/status/output-file），产新段类型 `bg_task_final`（{taskId, toolUseId, status: completed|failed|stopped, outputFile}）；解析纯函数 + 单测（本会话 rollout 实录为 fixture）。
2. `sillyhub-daemon/src/interactive/session-manager/events.ts`（及其调用链）：bg_task_final 段消费——经 onTurnMessage 桥发控制标记（turn_phase_report 同款桥模式，daemon.ts:4887 拦截先例）→ daemon 层拦截转 `_client.notifyBgTaskFinal`（HubClient 新方法）上平台；幂等双层：daemon 进程级 Set（同 turn_phase first_event 有界 Set 先例）+ backend (run_id, dedup_key) 唯一索引兜底（重启重扫去重）。

### Wave 2 — backend：上报端点与事件发布

1. 新增 `POST /api/daemon/sessions/{session_id}/bg-task-final`（backend/app/modules/daemon/router/notify.py，turn-phase 端点同款）：DTO `BgTaskFinalReportRequest`（run_id 必填 + task_id/tool_use_id/status 三值封闭枚举/output_file 可选）；runtime owner 越权校验（notify.py:344 先例）；落 agent_run_logs（dedup_key=bg-task:{task_id} 撞唯一索引幂等）。
2. `publish_bg_task_final_event` 发布 `bg_task_final` 事件到 agent_session:{id} Redis 频道（publish_turn_phase_event 同款）；前端 SSE 信封键与 payload 逐字对齐（2026-10-26-session-stage-progress 变更 D-012@v1 同纪律——键名逐字对齐防信封失配）。
3. HTTP 端点 1 个新增 + HubClient RPC 方法 1 个新增（daemon 侧 notifyBgTaskFinal）。

### Wave 3 — frontend：条目翻转与运行中计数（task-01 定位收口后的落地形态）

1. 定位结论（task-01 产出）：活动条目渲染=agent-log 渲染群（tool-renderers.tsx BashToolPreview/AgentToolPreview 含 run_in_background 标注）+ entry 层 normalize.ts（tool_use_id 已在提取链）；「运行中」态源自无 tool_result 跟随的后台调用。落地采用**查询失效收敛**：session-sse.ts 信封新增 bg_task_final 类型 → 消费点失效 agent logs 查询重拉（daemon 已落库终态行，活动流自然显示终态，免逐渲染层改状态机）——比逐条目 patch 更简单可靠。
2. 运行中计数：由重拉后活动数据推导（含 run_in_background 且无终态配对的条目集合）——派生纯函数+单测；会话空闲态状态区显示「后台任务 N 个运行中」（N=0 不显示）。
3. 旧 daemon 兼容：无终态事件时条目维持「运行中」现状（不误翻）。
4. 双显示防御：前端既有 task-notification 文本归一逻辑（turn-timeline.tsx:251 剥离注入文本）与 bg_task_final 事件是同一信号的两个视图（文本剥离=消息流侧、事件=状态侧）——事件消费不改文本归一行为，无双显示（状态翻转作用于既有条目，不新增渲染行）。

### Wave 4 — 验证收口

三侧测试 + gen:types 双端同步核查（若 schema 面变化）+ 平台实测全链路（启动后台任务→空闲计数→终态翻转）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/agent-log/parse-claude-code-jsonl.ts | task-notification 识别解析（Wave 1） |
| 修改 | sillyhub-daemon/src/agent-event-schema.ts | 事件类型扩展（Wave 1） |
| 修改 | sillyhub-daemon/src/interactive/session-manager/events.ts | bg_task_final 消费上报+幂等（Wave 1） |
| 修改 | sillyhub-daemon/src/daemon.ts | onTurnMessage 桥拦截转 client 调用（Wave 1，turn_phase_report 拦截同款位 :4887） |
| 修改 | backend/app/modules/daemon/router/notify.py | 新增 bg-task-final 端点+越权校验+事件发布（Wave 2） |
| 修改 | backend/app/modules/daemon/schema.py | BgTaskFinalReportRequest DTO（Wave 2，TurnPhaseReportRequest 同款位） |
| 修改 | sillyhub-daemon/src/hub-client.ts | notifyBgTaskFinal 方法（Wave 1，notifyTurnPhase 同款位） |
| 修改 | frontend/src/components/agent-log/tool-renderers.tsx | 活动条目渲染（Wave 3 条目翻转落点候选） |
| 修改 | frontend/src/components/daemon/turn-timeline.tsx | task-notification 文本归一所在（plan 评审提示 R-03 定位候选之二；终态翻转若落此文件须与文本归一双视图协调） |
| 修改 | frontend/src/lib/daemon/session-sse.ts | 事件类型消费（Wave 3） |
| 修改 | 各侧 __tests__ 对应测试文件 | 单测/契约测试（各 Wave 内同卡） |
| 修改 | backend/app/modules/daemon/run_sync/service/__init__.py | 发布函数导出桶注册（Wave 2，task-04 实施补录） |
| 修改 | backend/app/modules/daemon/run_sync/service/publish.py | publish_bg_task_final_event（Wave 2，task-04——review 声明补录） |
| 修改 | sillyhub-daemon/tests/agent-log/parse-task-notification.test.ts | 解析/批量提取单测（Wave 1，task-02/03） |
| 修改 | backend/app/modules/daemon/router/__init__.py | 端点序表注册（Wave 2，task-04 实施补录） |
| 修改 | backend/app/modules/platform_sync/schema.py | BgTaskFinalAttach 透传模型（Wave 3，task-05 闭环补全补录） |
| 修改 | frontend/src/components/daemon/agent-log-card.tsx | 装配层终态配对翻转（Wave 3，task-05 闭环补全补录——task-01 定位产出落点） |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | onBgTaskFinal 失效查询接线（Wave 3，task-05 补录） |
| 修改 | frontend/src/components/daemon/__tests__/turn-time-display.test.tsx | round4 存量债顺手修（task-05 提交面） |

## 接口定义

本变更接口面：**1 新 HTTP 端点 + 1 新 daemon 客户端方法**（独立评审 fail 项修正：原「0 端点/复用 logs POST」锚点失实——该 POST 不存在，真实通道为 turn-phase 同款上报模式）：

- `POST /api/daemon/sessions/{session_id}/bg-task-final`：请求体 `{run_id: UUID, task_id: string, tool_use_id: string, status: "completed"|"failed"|"stopped", output_file?: string}`（daemon 侧 camelCase → DTO snake_case 映射在 HubClient 封装层，同 notifyTurnPhase 先例）。
- daemon HubClient 新方法 `notifyBgTaskFinal(sessionId, payload)`。
- 前端 SSE 信封新事件类型 `bg_task_final`（payload 与上同构）。
- 后端 schema 面变化触发 gen:types 双端义务（规则 21：frontend 与 sillyhub-daemon 两份 api-types 同 change 重生成）。

## 生命周期契约表

本变更不涉及生命周期契约（lifecycle contract）——事件上报为既有会话事件通道内的类型扩展，不改 session/lease/agent_run 状态机；bg_task_final 是观察性事件（描述 CLI 内后台任务状态），不参与任何状态转移判定。

## 数据模型

无 DB migration——agent_run_logs 负载为 JSON 列，仅扩展事件类型词表与负载字段校验。

## 兼容策略（brownfield 必填）

- **未上报终态的旧 daemon**：平台不误翻（无 bg_task_final 事件即维持「运行中」显示，与现状一致）；计数含未配对历史条目属现状延续，事件流重放可自愈。
- **孤儿终态**（终态先到、启动条目不在当前流——中途接入 SSE 只收增量时）：不渲染新条目、只参与计数修正与后续到达条目的翻转（纯函数推导天然覆盖，单测锁定）。
- **CLI 版本差异**：task-notification 文本格式实证于当前 CLI；格式漂移时解析纯函数返回 null 静默降级（不产事件，平台维持现状）——fail-safe。
- **回退路径**：三侧独立可 revert；未知事件 kind 平台/前端按既有惯例忽略（向后兼容）。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | task-notification 文本格式随 CLI 版本漂移致解析失效 | P2 | 解析纯函数容错（失配返回 null 静默）；fixture 单测锁格式；fail-safe=维持现状 |
| R-02 | 会话刷新后历史 bg_task_final 事件重放，条目翻转需幂等 | P2 | 翻转按 tool_use_id 幂等（重复终态不重复翻转）；计数推导纯函数化+单测 |
| R-03 | 前端「后台任务运行中」条目的精确渲染组件未定位（截图形态与 agent-log 渲染群待对齐） | P2 | plan 阶段首任务定位（SSE→组件消费链逐环 grep）；清单已留活口 |
| R-04 | ~~已收口~~ 独立评审修正：通道=turn-phase 同款（onTurnMessage 桥→daemon 拦截→HubClient HTTP 封装→notify.py 端点）；残余=HubClient 封装文件名 plan 定位 | P3 | 先例链已锚（daemon.ts:4887/notify.py:328/schema.py:1666） |
| R-05 | 多 agent 并行同仓三段文件冲突 | P2 | Wave 文件集隔离；Edit 前重读 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | 总体方案全节（事件级上报路线） | 已采纳（source=user） |
| D-002@v1 | 非目标第 4 条（不做计数-only 兜底） | 已否决（落选方案 B，防复潮） |
| D-003@v1 | 非目标第 4 条（不做超时猜测翻转） | 已否决（落选方案 C，防复潮） |

无未解决决策。剩余风险 R-01~R-05。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本 D-xxx@vN（三条全引用）
- [x] 生命周期豁免短语紧邻否定（「不涉及生命周期契约（lifecycle contract）」）
- [x] UI 原型分级核对：跳过（纯状态逻辑无新布局——条目翻转/计数复用既有样式；用户 brainstorm Step 5 知情确认）
- [x] 不确定的问题标注：R-03/R-04 两处 plan 期定位项显式登记（存在性已证非臆断，精确坐标留 plan）
