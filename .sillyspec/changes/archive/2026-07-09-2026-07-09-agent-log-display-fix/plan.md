---
plan_level: full
author: qinyi
created_at: 2026-07-09 06:05:33
change: 2026-07-09-agent-log-display-fix
related: design.md, decisions.md, proposal.md, requirements.md, tasks.md
---

# 实现计划 · 智能体执行日志回显修复

详细蓝图，供 execute 阶段按 Wave 推进。技术细节见 design.md，决策见 decisions.md。

## Spike 前置验证

| Spike | 验证内容 | 不通过后果 |
|---|---|---|
| spike-01 (= task-01) | 跑一次真实 Claude run，dump result.usage 原始 JSON + `_accumulatedUsage` 终值 + 每条 assistant 事件 message.usage 的 cache_creation_input_tokens 是否存在 | task-09 分支无法确定（A1/A2/B），按 B 兜底显示"—/未知" |

## Wave 1 · daemon 源头治理 + spike（并行，无前后依赖）

- [x] task-01: cache_creation 恒 0 根因实证 dump（覆盖：FR-07, D-004@v2）
- [x] task-02: task-runner `_eventToMessages` tool_use 删 stdout `[TOOL_USE]` 文本行（覆盖：FR-01, D-006@v1）
- [x] task-03: task-runner `_eventToMessages` tool_result 补 tool_use_id（覆盖：FR-02, D-006@v1）
- [x] task-04: daemon 单测——tool_use 不双写 + tool_result 带 id（覆盖：FR-01, FR-02）

## Wave 2 · 前端合并卡片 + SYSTEM 折叠（依赖 Wave 1 task-03 的新日志 id；旧日志降级不依赖）

- [x] task-05: normalize 新增 stdout `[TOOL_RESULT]` 按 parent_tool_use_id 精确配对（覆盖：FR-03, D-007@v1, D-001@v1）
- [x] task-06: normalize classifyLog 补 `[TOOL_USE]` 降级 + NOISE_PREFIXES/isThinkingContent 改折叠分类（覆盖：FR-10, FR-05, D-002@v2）
- [x] task-07: agent-log-viewer 工具卡片合并折叠渲染 + SYSTEM/thinking 折叠 UI（覆盖：FR-04, FR-05, D-001@v1, D-002@v2）
- [x] task-08: normalize/viewer 单测——id 命中/缺失/乱序 + 折叠展开 + `[TOOL_USE]` 降级（覆盖：FR-03, FR-04, FR-05, FR-10）

## Wave 3 · token 四维补全（task-09 依赖 task-01 实证结果）

- [x] task-09: cache_creation 按 task-01 分支落地（A1 修 extractResultStats 映射 / A2 修 parseAssistant 采集 / B 改 format-token 占位）（覆盖：FR-07, D-004@v2）
- [x] task-10: interactive-session-panel SessionTurnView + onTokens/onTurnCompleted 补 cache_read/cache_creation（覆盖：FR-06）
- [x] task-11: token 面板 killed/failed 占位（覆盖：FR-08, D-003@v1）
- [x] task-12: 历史回看 daemon/runtime-session-dialog 补 token 四维（覆盖：FR-09, D-005@v1）
- [x] task-13: 前端 token 单测——cache 维度读取 + killed 占位 + 历史回看四维（覆盖：FR-06, FR-08, FR-09）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | cache_creation 实证 dump | W1 | P1 | — | FR-07, D-004@v2 | 临时加 dump，跑真实 run，区分三条根因路径 |
| task-02 | tool_use 删 stdout [TOOL_USE] | W1 | P0 | — | FR-01, D-006@v1 | task-runner.ts:1843-1848 删 push |
| task-03 | tool_result 补 tool_use_id | W1 | P0 | — | FR-02, D-006@v1 | task-runner.ts tool_result case 加 id 字段 |
| task-04 | daemon 单测 | W1 | P0 | task-02,03 | FR-01, FR-02 | 新增 test 文件，id 有/无两场景 |
| task-05 | tool_result 按 id 配对 | W2 | P0 | task-03（新日志） | FR-03, D-007@v1 | normalize.ts 全新逻辑（非扩展） |
| task-06 | classifyLog + 折叠分类 | W2 | P0 | — | FR-10, FR-05, D-002@v2 | 改 NOISE_PREFIXES + isThinkingContent 两处 |
| task-07 | 卡片合并 + 折叠 UI | W2 | P0 | task-05,06 | FR-04, FR-05 | agent-log-viewer 渲染 |
| task-08 | normalize/viewer 单测 | W2 | P0 | task-05,06,07 | FR-03,04,05,10 | id 命中/缺失/乱序 + 折叠 |
| task-09 | cache_creation 分支落地 | W3 | P1 | task-01 | FR-07, D-004@v2 | 三分支择一 |
| task-10 | 交互面板补 cache 维度 | W3 | P1 | — | FR-06 | onTokens/onTurnCompleted 回调 |
| task-11 | killed 占位 | W3 | P2 | — | FR-08, D-003@v1 | 按 run.status 判断 |
| task-12 | 历史回看补 token | W3 | P2 | — | FR-09, D-005@v1 | runtime-session-dialog |
| task-13 | 前端 token 单测 | W3 | P1 | task-10,11,12 | FR-06,08,09 | 组件测试 |

## 关键路径

- **task-01 → task-09**（spike 决定 cache_creation 修复分支，最长路径）
- **task-03 → task-05 → task-07**（daemon 补 id → 前端配对 → 卡片渲染，合并卡片主链）
- task-02/03/04 可并行（Wave 1 内）；task-10/11/12 可并行（Wave 3 内）

## 任务详情（execute 指引）

### task-01 · cache_creation 实证 dump
- 文件：`sillyhub-daemon/src/adapters/stream-json.ts`（extractResultStats ~1092-1162 临时加 console.error dump）+ 跑一次真实 run
- 步骤：(1) extractResultStats 入口 dump result.usage 原始 JSON；(2) dump this._accumulatedUsage 终值（cache_creation_tokens）；(3) parseAssistant/usage_update 处 dump message.usage 是否含 cache_creation_input_tokens；(4) 跑真实 run 收集三处输出
- 验收：产出实证记录，明确 A1/A2/B 归属，写入 task-09 依据

### task-02 · tool_use 删 stdout [TOOL_USE]
- 文件：`sillyhub-daemon/src/task-runner.ts:1843-1848`
- 步骤：删除 tool_use 分支中 stdout `[TOOL_USE] ${name}: ${argsLine}` 的 messages.push（保留 1862+ 的 tool_call JSON push）；更新 1700 注释（tool_use → 1 条）
- 验收：AC-01（messages 只 1 条 tool_call）

### task-03 · tool_result 补 tool_use_id
- 文件：`sillyhub-daemon/src/task-runner.ts` tool_result case（~1890）
- 步骤：复用 tool_use 分支 toolUseId 解析（1825-1829），tool_result message 加 `...(toolUseId ? { tool_use_id: toolUseId } : {})`；content/channel/preview 不变
- 验收：AC-02（message 带 tool_use_id 当 metadata 有 id）

### task-04 · daemon 单测
- 文件：`sillyhub-daemon/src/__tests__/task-runner-event-to-messages.test.ts`（新增）
- 步骤：测 tool_use event → 1 条 tool_call（无 stdout [TOOL_USE]）；tool_result event + metadata.call_id → message 带 tool_use_id；tool_result 无 id → 不带字段
- 验收：3 case 全绿

### task-05 · tool_result 按 id 配对（全新逻辑）
- 文件：`frontend/src/components/agent-log/normalize.ts`（400-413 toolUseIdIndex + 596-612 stdout TOOL_RESULT 分支）
- 步骤：(1) 单遍处理 stdout `[TOOL_RESULT]` 行时，读 `current.log.parent_tool_use_id`；(2) 非空则回查 toolUseIdIndex 命中 → mergeToolResult + hidden；(3) 未命中/无 id 退化 lastToolSourceIdx
- 注意：配对 key 是 `current.log.parent_tool_use_id`（非 content 解析）
- 验收：AC-03（id 命中合并 hidden）+ AC-03b（id 缺失退化）

### task-06 · classifyLog + 折叠分类
- 文件：`frontend/src/components/agent-log/normalize.ts`（334-358 classifyLog + 374 NOISE_PREFIXES + 619-640 isThinkingContent/Only）
- 步骤：(1) classifyLog 补 `[TOOL_USE]` stdout → tool_call 分支（降级）；(2) NOISE_PREFIXES filter 改为标记折叠类（不删）；(3) isThinkingContent 把 `[SYSTEM` 归 thinking 合并的逻辑改为折叠摘要分类
- 验收：AC-05（[SYSTEM:*] 折叠）+ AC-10（[TOOL_USE] 归 tool_call）

### task-07 · 卡片合并 + 折叠 UI
- 文件：`frontend/src/components/agent-log-viewer.tsx`
- 步骤：(1) tool_call 卡片渲染折叠结果区（▸执行结果 默认收起，点击展开 mergedToolResult）；(2) SYSTEM/thinking 折叠摘要行 + 展开交互（foldedSummary/foldedDetail）
- 验收：AC-04（卡片折叠）+ AC-05（折叠展开）

### task-08 · normalize/viewer 单测
- 文件：`frontend/src/components/agent-log/__tests__/`（新增）
- 步骤：测 id 命中/缺失/乱序三场景配对；折叠展开交互；[TOOL_USE] 降级归 tool_call
- 验收：5 case 全绿

### task-09 · cache_creation 分支落地
- 文件：按 task-01 结果——A1 `sillyhub-daemon/src/adapters/stream-json.ts` extractResultStats；A2 stream-json.ts parseAssistant/usage_update（678-683,548-553）；B `frontend/src/lib/format-token.ts`
- 步骤：据实证择一分支实现
- 验收：AC-07（cache_creation 真实值或"—/未知"占位）

### task-10 · 交互面板补 cache 维度
- 文件：`frontend/src/components/daemon/interactive-session-panel.tsx`（72-74 SessionTurnView + 204-225 onTokens/onTurnCompleted）
- 步骤：SessionTurnView 加 cacheRead/cacheCreation state；回调读 env.cache_read_tokens/cache_creation_tokens
- 验收：AC-06（四维显示）

### task-11 · killed 占位
- 文件：`frontend/src/components/agent-run-panel.tsx`（TokenUsageBadge）+ `frontend/src/components/daemon/runtime-session-dialog.tsx`
- 步骤：run.status=killed/failed 且字段 NULL → 显示"已中断"/"未汇总"
- 验收：AC-08

### task-12 · 历史回看补 token
- 文件：`frontend/src/components/daemon/runtime-session-dialog.tsx`（或 runtime-session-helpers.tsx）
- 步骤：SessionHistoryView 补 token 四维面板（与主面板口径一致）
- 验收：AC-09

### task-13 · 前端 token 单测
- 文件：对应组件 `__tests__/`
- 步骤：测 cache 维度读取 + killed 占位 + 历史回看四维
- 验收：3 类组件测试全绿

## 全局验收标准

- **AC-01**：daemon 单测 `_eventToMessages(tool_use)` 只产 1 条 tool_call（无 stdout [TOOL_USE]）
- **AC-02**：daemon 单测 `_eventToMessages(tool_result)` 带 tool_use_id（metadata 有 id 时）
- **AC-03**：前端单测 stdout [TOOL_RESULT] + parent_tool_use_id → 合并进卡片 hidden
- **AC-04**：组件测试 tool_call 卡片渲染徽标+标签+参数+折叠结果，点击展开
- **AC-05**：组件测试 [SYSTEM:*]/[THINKING] 折叠摘要可展开（不删/不吞）
- **AC-06**：组件测试交互面板 token 四维显示
- **AC-07**：cache_creation 真实值或"—/未知"占位（据 task-01 分支）
- **AC-08**：组件测试 killed/failed + NULL → "已中断·未汇总"占位
- **AC-09**：组件测试历史回看 token 四维
- **AC-10**：单测 classifyLog [TOOL_USE] stdout → tool_call（降级）
- **AC-11**：全量回归 backend pytest（cov≥60%）+ frontend vitest + daemon vitest 全绿
- **AC-12**：端到端真实 run 日志面板无三行分裂、标签一致、SYSTEM 可展开、token 非空白
- **AC-13**：terminal.log 回显不变（[task xxx] [tool_use Bash] 仍正常）

## 覆盖矩阵

| 决策 | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1（合并卡片） | task-05, task-07 | AC-03, AC-04 |
| D-002@v2（SYSTEM 折叠含 isThinkingContent） | task-06, task-07 | AC-05 |
| D-003@v1（killed 占位） | task-11 | AC-08 |
| D-004@v2（cache_creation 三分支） | task-01, task-09 | AC-07 |
| D-005@v1（历史回看 token） | task-12 | AC-09 |
| D-006@v1（修订 C-02 daemon 不双写） | task-02, task-03, task-06 | AC-01, AC-02, AC-10 |
| D-007@v1（tool_result 配对全新逻辑） | task-05 | AC-03 |

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| task-01 实证结果不确定 | 三分支策略兜底，B 分支至少消除"误导性 0" |
| task-05 配对误判（id 缺失/乱序） | 保留 lastToolSourceIdx 退化 + 单测三场景 |
| Wave 2 依赖 task-03 但旧日志无 id | 降级路径兼容，新日志精确配对 |
| daemon 改动影响 batch 终端用户 | terminal 回显独立（已查证）+ AC-13 端到端验证 |
| 2026-06-28-daemon-subagent-transcript merge 顺序 | execute 前确认其状态，不同列不冲突 |

## 自检

- ✅ Wave 分组与依赖：W1（spike+治理）→ W2（前端合并，依赖 W1 task-03）→ W3（token，task-09 依赖 task-01）
- ✅ 每个 task 有 checkbox（execute 解析格式）
- ✅ 覆盖矩阵：D-001~D-007 全部映射到 task + AC
- ✅ AC 具体可测（单测/组件测试/端到端）
- ✅ Spike（task-01）前置技术不确定性
- ✅ 关键路径标注
- ✅ 风险识别 + 缓解
- ✅ 与 design.md 一致（文件:行/决策引用）
- ✅ backend 几乎不改（无 SQLite/PG 方言风险）
