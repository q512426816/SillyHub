---
author: qinyi
created_at: 2026-07-09 06:05:33
change: 2026-07-09-agent-log-display-fix
related: design.md, decisions.md, proposal.md, tasks.md
---

# Requirements · 智能体执行日志回显修复

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户 | 在工作台查看智能体执行日志、token 用量的开发者（主要受益人） |
| 智能体（agent） | 执行任务并产出工具调用/结果/思考/系统日志的主体（claude 为主，codex 次之） |
| daemon | batch 路径把 agent 事件转成 submit_messages 的源头（task-runner _eventToMessages） |
| backend | run_sync 落库 + SSE publish 日志/usage 的中转（本次几乎不改） |
| frontend | 日志归一化（normalize）+ 渲染（agent-log-viewer/interactive-session-panel） |

---

## 功能需求

### FR-01: daemon tool_use 不再双写 stdout [TOOL_USE]

覆盖决策：D-006@v1

Given daemon batch 路径处理一个 `tool_use` AgentEvent（metadata 含 tool_name + tool_input + tool_use_id）
When `_eventToMessages(ev)` 转换
Then 返回的 messages 数组**只有 1 条** tool_call JSON（channel='tool_call'，带 tool_kind + tool_use_id），**不再包含** stdout `[TOOL_USE]` 文本行

Given 旧版本 daemon 产生的已落库日志含 stdout `[TOOL_USE]`
When 前端 normalize 处理历史日志
Then 走 classifyLog `[TOOL_USE]` 降级分支（FR-10）+ 启发式配对，仍能合并显示（兼容）

### FR-02: daemon tool_result 补 tool_use_id

覆盖决策：D-006@v1

Given daemon 处理一个 `tool_result` AgentEvent，metadata 含 call_id（stream-json.ts:815 存的单字段）
When `_eventToMessages(ev)` 转换
Then message 带 `tool_use_id` 字段（从 metadata.tool_use_id/id/call_id 取，与 tool_use 分支同源解析），channel 保持 'stdout'，content 保持 `[TOOL_RESULT] <preview 3000>`

Given tool_result 事件 metadata 无任何 id 字段（退化场景）
When 转换
Then message 不带 tool_use_id 字段（省略），后续靠启发式配对（不阻塞）

### FR-03: 前端 tool_result 按 parent_tool_use_id 精确配对进卡片（全新逻辑）

覆盖决策：D-001@v1, D-007@v1

Given 日志含一条 channel='stdout'、content 以 `[TOOL_RESULT]` 开头、`parent_tool_use_id` 非空的行，且存在同 tool_use_id 的 tool_call JSON 卡片
When normalize 处理该 result 行
Then result body 合并进对应 tool_call 卡片（mergeToolResult），该 result 行 hidden=true 不独立渲染

Given result 行 `parent_tool_use_id` 为空（旧日志/id 缺失）
When normalize 处理
Then 退化到 lastToolSourceIdx 启发式最近邻配对（兼容，不丢结果）

Given 多条 result 乱序到达（id 命中但距离远）
When normalize 处理
Then 仍按 id 精确配对（不受 ±20 窗口限制）

### FR-04: 前端工具卡片合并折叠渲染

覆盖决策：D-001@v1

Given 一条 tool_call 卡片（含配对的 result body）
When agent-log-viewer 渲染
Then 显示：工具徽标 + tool_kind 中文标签（toolKindMeta）+ 调用参数 + "▸执行结果"折叠区（默认收起）
When 用户点击折叠区
Then 展开显示 result body 原始内容

### FR-05: SYSTEM/thinking 日志默认折叠可展开（改两处）

覆盖决策：D-002@v2

Given 日志含 `[SYSTEM:thinking_tokens]` 行
When normalize 处理（NOISE_PREFIXES filter 已改为折叠标记，不再 filter 删）
Then 行标记为折叠类，渲染摘要"思考 token 计数 · N 条"，点击展开原始内容

Given 日志含 `[SYSTEM:init]`/`[SYSTEM:status]`/`[SYSTEM:api_retry]` 等其余 [SYSTEM:*] 行
When normalize 处理（isThinkingContent 分类已改为折叠，不再归 thinking 合并块吞掉）
Then 行渲染为折叠摘要"系统信息 · N 条"，点击展开（不再被 thinking 合并吞掉）

Given 日志含 `[THINKING]` 行
When normalize 处理
Then 连续 thinking 合并到折叠摘要（保留现有合并逻辑，渲染形态改为折叠）

### FR-06: 交互式会话面板补 token 缓存两维

覆盖决策：问题 2c（无 D 编号，step 6 确认 token 一起修）

Given SessionStreamEnvelope 的 `tokens`/`turn_completed` 事件含 cache_read_tokens + cache_creation_tokens（daemon.ts:884-885 已发）
When interactive-session-panel 的 onTokens/onTurnCompleted 回调处理
Then SessionTurnView 读入并显示四维（输入/输出/缓存读/缓存写），不再只取 input/output 丢弃 cache

### FR-07: cache_creation 恒 0 实证 + 三分支修复

覆盖决策：D-004@v2

Given 一条真实 Claude run 完成
When execute 阶段实证 task 跑该 run 并 dump
Then 产出三处原始值：(1) result.usage JSON；(2) this._accumulatedUsage 终值；(3) 每条 assistant 事件 message.usage 的 cache_creation_input_tokens 是否存在

Given 实证结果为 A1（Claude result.usage 返回 cache_creation 且 accumulated 有）
When 按分支 A1 修复
Then 修 daemon extractResultStats 字段映射/聚合，cache_creation 落真实值

Given 实证结果为 A2（accumulated 漏采，assistant 事件 usage 无 cache 维度）
When 按分支 A2 修复
Then 修 daemon parseAssistant/usage_update 采集（stream-json.ts:678-683, 548-553 周边）

Given 实证结果为 B（Claude 本就不返回，两处都无）
When 按分支 B 修复
Then frontend format-token.ts 让 cache_creation=0/null 显示"—/未知"，不显示误导的"0"

### FR-08: killed/failed run token 占位

覆盖决策：D-003@v1

Given run.status 为 killed 或 failed，且 total_cost_usd/num_turns/duration_ms 为 NULL
When token 面板渲染（agent-run-panel + runtime-session-dialog）
Then 对应维度显示"已中断"/"未汇总"占位文案，非空白或 0

Given run.status 为 completed
When token 面板渲染
Then 正常显示数值（行为不变）

### FR-09: 历史回看补 token 四维

覆盖决策：D-005@v1

Given 用户打开 runtime-session-dialog 历史回看某 run
When SessionHistoryView 渲染
Then 显示 token 四维（输入/输出/缓存读/缓存写），与主面板口径一致（之前无任何 token 显示）

### FR-10: classifyLog 补 [TOOL_USE] stdout 历史降级分支

覆盖决策：D-006@v1（兼容）

Given 历史日志含 channel='stdout'、content 以 `[TOOL_USE]` 开头的行（旧 daemon 双写遗留）
When classifyLog 处理
Then 归类为 `tool_call` 语义类（参与工具配对/筛选），不再 fallthrough 到 `log` 灰徽标

---

## 非功能需求

- **NF-1 跨平台**：daemon 改动兼容 Windows/Linux/macOS（不引入平台特定逻辑）。
- **NF-2 兼容性**：历史已落库双写日志仍可正常渲染（前端降级路径）；未升级 daemon 的客户端不受影响。
- **NF-3 性能**：normalize 新增配对应 O(n) 单遍 + Map 查找，不引入 O(n²)。
- **NF-4 测试覆盖**：daemon task-runner + frontend normalize/viewer 新增单测，覆盖 id 命中/缺失/乱序三类场景；backend 既有测试不回归。
- **NF-5 方言**：backend 几乎不改（现有继承逻辑 dialect 无关），不触发 SQLite/PG 方言问题。
- **NF-6 中文 UI**：折叠摘要、占位文案、工具标签均中文（遵循 CLAUDE.md rule 11）。

---

## 决策覆盖关系

| 决策 | 覆盖 FR | 状态 |
|---|---|---|
| D-001@v1（合并卡片） | FR-03, FR-04 | accepted |
| D-002@v2（SYSTEM 折叠，含 isThinkingContent） | FR-05 | accepted |
| D-003@v1（killed 占位） | FR-08 | accepted |
| D-004@v2（cache_creation 三分支） | FR-07 | investigate |
| D-005@v1（历史回看 token） | FR-09 | accepted |
| D-006@v1（修订 C-02 daemon 不双写） | FR-01, FR-02, FR-10 | accepted |
| D-007@v1（tool_result 配对全新逻辑） | FR-03 | accepted |

## 生命周期契约

详见 design.md §7.5。submit tool_use/tool_result/publish/tokens 四事件字段-DTO 对应齐全，无未覆盖事件。
