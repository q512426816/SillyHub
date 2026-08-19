---
author: WhaleFall
created_at: 2026-08-19 18:33:16
---

# 需求规格（Requirements）— 智能体会话流结构化重构

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户 | 在 /sessions 页或 /runtimes 弹窗与智能体会话交互，观察 agent 执行过程与结果 |
| 前端开发者 | 维护会话流装配/渲染组件的消费方（本次变更后只有一个装配器 + 一个渲染组件族） |

## 功能需求

### FR-01: 轮内结构化分段
覆盖决策：D-001@v1, D-002@v1

Given 一轮 agent 回复（主 agent 或含子代理归属的日志流）
When 该轮日志事件（含归属字段）被装配器处理
Then 输出有序段序列：文本段/思考段/工具段/stderr 段按真实到达顺序排列，文本被非文本段打断则开新段，不 concat 为单条

Given 历史日志（REST 拉取，`AgentRunLogEntry` 形状）
When `logsToSegments` 批量装配
Then 与 SSE 实时路径产出的段结构一致（同一段模型，两路径无分叉）

### FR-02: 轮级实时状态条
覆盖决策：D-001@v1, D-003@v1

Given 一轮处于 running/pending/interrupting 状态
When TurnTimeline v2 渲染该轮（「对话」与「进度」视图均显示）
Then 轮头部显示状态条：计时 + 工具计数（含子代理内部递归）+ 运行中子代理计数 + 当前活动摘要（最新 running 段派生；无 running 工具段时回退「正在输出文本/思考」）

Given 用户中途刷新/attach 到运行中轮
When 状态条计时恢复
Then 计时锚点取 run 快照 `started_at`（缺失则首条 log timestamp），不归零、不从刷新时刻重计

Given 轮到达终态（completed/failed/killed）
When 渲染
Then 状态条移除，streaming 标记清除

### FR-03: 子代理进度嵌套展示
覆盖决策：D-001@v1, D-002@v1, D-003@v1

Given 日志事件携带 `parent_tool_use_id` 且能匹配到已有 tool 段 id
When 装配器路由
Then 该事件的段进入对应 tool 段的 `children`，渲染为子代理块（头部状态点/名称(Task description)/subagent_type/时长 + 内部完整段序列，递归支持 depth>1）

Given 子代理消息先于其 tool_use 段到达（乱序/丢失）
When 装配器处理
Then 创建 `subagent_stub` 兜底段承接（标注 subagentType），后续 tool 段到达且 id 匹配时合并迁入

Given 主/子代理工具调用交错
When tool_result 到达（SSE/DB 均无自身 tool_use_id）
Then 按「同一归属桶内最后一个未配对 tool 项」位置配对，不跨桶误配

### FR-04: 子代理目录（仅 /sessions 页）
覆盖决策：D-003@v1

Given 当前选中会话存在（含子代理调用的）轮次
When 用户点击会话头部子代理目录按钮
Then 下拉列表展示子代理清单：状态点（运行中脉冲）、名称、subagent_type、时长（运行中 = 起始时间戳 + 每秒 tick；已完成 = endedAt - startedAt）；token 无数据不显示，不编造

When 用户点击目录中某子代理行
Then 切换到「进度」视图 + 展开对应子代理块 + 滚动定位到该块

### FR-05: 共享装配器收敛
覆盖决策：D-002@v1

Given sessions 页与 runtimes 弹窗两处消费方
When 任意一方处理日志事件或历史日志
Then 均调用同一 `session-log-assembler` 模块（`applyLogToSegments` / `logsToSegments`），不存在第二份日志处理逻辑副本

Given override 撤回令箭（`[ASSISTANT_OVERRIDE]`/`[THINKING_OVERRIDE]` 前缀 + segmentId）
When 装配器处理
Then 按 segmentId 前缀（`main:` / `<tool_use_id>:`）路由到归属段撤回；同一 segmentId 的 partial 已被工具段打断分裂多段时，各分裂段一并撤回

### FR-06: 渲染经济性
覆盖决策：D-002@v1

Given 一轮包含多个段且流式 delta 持续到达
When React 渲染更新
Then 仅当前 streaming 段的组件重渲染（段级 memo + 稳定 id key + 装配器段级 copy-on-write），其它段/轮组件不重渲染

## 非功能需求

- 兼容性：旧日志（无归属字段）/ Codex provider / 未升级 daemon 的会话，装配按主 agent 平铺，渲染与现状等价；`segments` 缺省的 turn（孤儿 turn 构造路径）走旧渲染回退不崩。
- 可回退：过渡期 `output`/`processItems` 兼容投影保留，外围消费方（重发 prompt、CtxUsageBar、孤儿 turn 排序）零改动。
- 可测试：装配器为纯函数（无 React/网络依赖），单测覆盖分段/嵌套/撤回/配对/去重/兜底/两路径一致性；段渲染组件独立可测。
- 跨平台：纯前端逻辑无 OS 相关面。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-02 | 「阶段」=轮内执行分段，非流程阶段；状态条为轮级信号 |
| D-002@v1 | FR-01, FR-03, FR-05, FR-06 | 方案 C：共享装配器 + 结构化渲染，否决保留副本/全量移植 |
| D-003@v1 | FR-02, FR-03, FR-04 | 原型为视觉/交互基准；子代理参考 deepseek SubagentCatalog |

无未覆盖决策。
