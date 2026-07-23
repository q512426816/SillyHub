---
author: qinyi
created_at: 2026-07-09 05:54:32
change: 2026-07-09-agent-log-display-fix
related: decisions.md, prototype-agent-log-display-fix.html
---

# 设计文档 · 2026-07-09-agent-log-display-fix

智能体执行日志回显修复：工具标签对应不上 + token 数值空白 + 日志信息缺失。

方案 B：daemon 源头治理（不双写）+ 前端合并卡片 + token 四维补全。

---

## 1. 背景

用户反馈智能体执行日志页面三类问题：(1) 工具标签对应不上；(2) 部分 token 数值空白；(3) 日志信息缺失。

基于真实 run `8fab8465`（completed、75 轮、6.77 美元、1565 条日志）的根因调研：

- **标签对应不上**：daemon batch 路径（`sillyhub-daemon/src/task-runner.ts:1843-1880`，C-02 设计决策）对每次工具调用产生 **3 条日志**——① stdout `[TOOL_USE] Name: args`（tool_kind=NULL，前端归「日志」灰徽标）；② tool_call JSON（tool_kind 有值，归「工具」蓝徽标）；③ stdout `[TOOL_RESULT]`（tool_kind=NULL，归「返回」绿徽标）。74 次调用 = 1:1:1 三写。前端 `normalize.ts:525-567` 已有①合并进②的去重，但③独立行不配对（仅"同行①③"才合并，line 561），且①去重依赖 ±20 窗口在密集穿插/uuid 乱序时偶发失败。
- **token 空白**：DB 中 input/output/cache_read 有真实大值（714555/42962/4223680）；空白在三处——(a) `cache_creation_tokens` 全表 594 条 run 恒 0；(b) killed/failed run 的 total_cost_usd/num_turns/duration_ms 全 NULL；(c) 交互面板 `interactive-session-panel.tsx:217-225` 回调丢弃 cache_read/cache_creation 两维。
- **日志缺失**：(a) `[SYSTEM:thinking_tokens]` 被 `normalize.ts:374` NOISE_PREFIXES 整条 filter 删除；**其余 `[SYSTEM:*]`（init/status/api_retry 等）经 `isThinkingContent`（normalize.ts:619-629，`[SYSTEM` 前缀命中）归入 thinking 合并块被"吞掉"**（该 run 535 条 [SYSTEM] 多数走此路径，前端不可见）；(b) 对话视图默认只显 user_input+assistant，隐藏 thinking(637)/tool/system。

## 2. 设计目标

- **G1**：每个工具调用在日志面板呈现为单张卡片（工具徽标 + 工具名标签 + 参数 + 折叠结果），消除三行分裂与标签错位。
- **G2**：token 四维（输入/输出/缓存读/缓存写）在主面板、交互面板、历史回看三处一致显示；cache_creation 根因查清并修或合理占位。
- **G3**：SYSTEM/thinking 类日志默认折叠可展开，不再删除。
- **G4**：killed/failed 任务的 NULL 字段显示"已中断·未汇总"占位。
- **G5**：不破坏 terminal.log 回显、不破坏历史已落库日志的可读性。

## 3. 非目标

- **N1**：不改 daemon 的 terminal 回显路径（`renderAgentEvent`，task-runner.ts:2590-2651）——它独立于 backend 日志链路。
- **N2**：不重写 normalize.ts 的整体归一化架构——扩展现有配对骨架。
- **N3**：不处理 codex/OpenAI 系的 cache 字段（其本就无 cache，尽力而为，见 memory [[claude-cache-token-semantics]]）。
- **N4**：不改 backend AgentRunLog 表结构（tool_kind/parent_tool_use_id 等列已存在，无需 migration）。
- **N5**：不做日志全文搜索 / 高级筛选增强（超出本次范围）。

## 4. 拆分判断

三类问题相对独立但同属"日志回显"、相互关联（tool_kind 配对同时影响标签与完整性），作为一个变更推进。任务预估 8-12 个，非重复模式，不走批量模式。详见 step 5 范围评估。

## 5. 总体方案

分三个 Phase（对应 Wave），daemon → frontend → token，依赖顺序明确。

### Phase 1 · daemon 源头不双写（Wave 1）

改 `sillyhub-daemon/src/task-runner.ts` 的 `_eventToMessages`：

- **tool_use 分支（1790-1880）**：删除 stdout `[TOOL_USE]` 文本行 push（1843-1848），只保留结构化 tool_call JSON（1862+，已带 tool_kind + tool_use_id）。
- **tool_result 分支（~1890）**：保持 stdout channel + `[TOOL_RESULT]` 前缀（可读性好、preview 3000 不变），补 `tool_use_id` 字段（从 `ev.metadata.tool_use_id/id/call_id` 取，与 tool_use 分支 `toolUseId` 解析逻辑同源，1825-1829）。
- **terminal 回显不动**：`renderAgentEvent`（2590-2651）是独立渲染路径，terminal.log 照常显示 `[task xxx] [tool_use Bash]`。

效果：一个工具调用从 3 条 → 2 条（卡片 + 结果），且都带 tool_use_id 能精确配对。

### Phase 2 · 前端合并卡片 + 折叠（Wave 2）

依赖 Phase 1（新日志 tool_result 带 id）。

- **normalize.ts**：
  - `classifyLog`（334-358）补 `[TOOL_USE]` stdout 分支（归 tool_call），作历史降级。
  - **新增**（非"扩展"）stdout `[TOOL_RESULT]` 行按 `parent_tool_use_id` 精确配对逻辑：当前 `toolUseIdIndex`（406）仅收 `channel==='tool_call'` 行，stdout result 行**从无 id 配对代码**（只走 lastToolSourceIdx 启发式，600-604）。实现：单遍处理 stdout result 行时，若 `current.log.parent_tool_use_id` 非空，回查 toolUseIdIndex 命中则 mergeToolResult 并 hidden，否则退化到 lastToolSourceIdx。**配对 key 明确用 `current.log.parent_tool_use_id`**（AgentRunLogEntry 字段，backend service.py:472 已透传），非 content 解析（result 行 content 是 `[TOOL_RESULT] ...` 文本，无 id JSON）。详见 D-007。
  - 新日志（Phase 1 后）不再有 [TOOL_USE] stdout，但旧日志兼容靠启发式窗口保留。
- **agent-log-viewer.tsx**：
  - tool_call 卡片渲染"工具徽标 + tool_kind 标签 + 参数 + ▸执行结果（默认折叠，点击展开）"——D-001。
  - `[SYSTEM:xxx]`/`[THINKING]` 折叠摘要行 + 展开交互——D-002。**同时改造两处**（CC-09 修正）：(1) NOISE_PREFIXES filter（374）删除逻辑改折叠标记；(2) `isThinkingContent`/`isThinkingOnly` 分类（619-640）把 `[SYSTEM` 开头归 thinking 合并的逻辑改为折叠摘要——否则多数 `[SYSTEM:*]` 仍被 thinking 合并吞掉，折叠只覆盖 `thinking_tokens` 一种。

### Phase 3 · token 四维补全（Wave 3）

- **交互面板补 cache 维度**：`interactive-session-panel.tsx` 的 `SessionTurnView`（72-74）+ `onTokens`（217-225）/`onTurnCompleted`（204-216）补读 `env.cache_read_tokens`/`cache_creation_tokens`（数据源 `SessionStreamEnvelope` daemon.ts:884-885 已有）——问题 2c。
- **cache_creation 实证 + 双支**（D-004）：Wave 1 首个 task 实证 Claude `result.usage` 是否返回 `cache_creation_input_tokens`。分支 A 修采集；分支 B 改 `format-token.ts` 让 0/null 显示"—/未知"。
- **killed/failed 占位**（D-003）：token 面板按 `run.status` 判断，NULL 字段显示"已中断·未汇总"。
- **历史回看补 token**（D-005）：`runtime-session-dialog.tsx`/`runtime-session-helpers.tsx` 补四维面板。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/task-runner.ts | `_eventToMessages` tool_use 分支删 stdout [TOOL_USE] push（1843-1848）；tool_result 分支补 tool_use_id |
| 修改 | sillyhub-daemon/src/adapters/stream-json.ts | （D-004 分支 A）若实证确认 Claude 返回 cache_creation，修 extractResultStats（1137-1148）字段映射 |
| 修改 | frontend/src/components/agent-log/normalize.ts | classifyLog 补 [TOOL_USE] 分支；tool_result 按 tool_use_id 配对；NOISE_PREFIXES 改折叠标记 |
| 修改 | frontend/src/components/agent-log-viewer.tsx | tool_call 卡片合并折叠结果渲染；SYSTEM/thinking 折叠行 |
| 修改 | frontend/src/components/daemon/interactive-session-panel.tsx | SessionTurnView 补 cache 两维；onTokens/onTurnCompleted 回调补读 |
| 修改 | frontend/src/components/daemon/runtime-session-dialog.tsx（或 daemon/runtime-session-helpers.tsx） | 历史回看补 token 四维 + killed 占位 |
| 修改 | frontend/src/lib/format-token.ts | （D-004 分支 B）cache_creation=0/null 显示"—/未知" |
| 新增 | sillyhub-daemon/src/__tests__/task-runner-event-to-messages.test.ts | tool_use 不双写 + tool_result 带 tool_use_id 单测 |
| 新增 | frontend/src/components/agent-log/__tests__/normalize-pair-result.test.ts | tool_result 按 id 配对 + 历史 [TOOL_USE] 降级单测 |

## 7. 接口定义

### 7.1 daemon `_eventToMessages` tool_result 输出（修订后）

```typescript
// task-runner.ts tool_result 分支（修订后）
case 'tool_result': {
  const preview = rawContent.length > 3000 ? rawContent.slice(0, 3000) : rawContent;
  // 新增：与 tool_use 分支 toolUseId 解析同源（task-runner.ts:1825-1829）
  const toolUseId =
    (typeof md.tool_use_id === 'string' && md.tool_use_id) ||
    (typeof md.id === 'string' && md.id) ||
    (typeof md.call_id === 'string' && md.call_id) ||
    '';
  messages.push({
    event_type: ev.type,
    content: `[TOOL_RESULT] ${preview}`,
    channel: 'stdout',
    // 新增字段：让 backend 继承 tool_kind + 前端按 id 配对
    ...(toolUseId ? { tool_use_id: toolUseId } : {}),
  });
  break;
}
```

### 7.2 frontend `ProcessedLog` 卡片合并字段（扩展）

```typescript
// normalize.ts ProcessedLog 已有 toolUseId（task-14）。新增：
interface ProcessedLog {
  // ...既有字段
  toolUseId?: string;
  mergedToolResult?: string;   // 已有（mergeToolResult 写入），本次扩展：独立 tool_result 行也并入
  foldedSummary?: string;      // 新增：SYSTEM/thinking 折叠摘要
  foldedDetail?: string;       // 新增：折叠展开详情
}
```

## 7.5 生命周期契约表

本变更涉及 agent_run / daemon / submit message / tool_use_id 关键词，契约如下：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| submit message（tool_use） | daemon task-runner | backend run_sync | leaseId, claimToken, agentRunId, messages[{event_type:'tool_use', content: JSON{tool,tool_use_id,args}, channel:'tool_call', tool_kind}] | append tool_call log + tool_kind 落库 |
| submit message（tool_result） | daemon task-runner | backend run_sync | leaseId, claimToken, agentRunId, messages[{event_type:'tool_result', content:'[TOOL_RESULT] ...', channel:'stdout', **tool_use_id**}] | append stdout log + 按 tool_use_id 继承 tool_kind（service.py:432-439） |
| SSE log publish | backend run_sync | frontend | log_id, channel, content, timestamp, tool_kind, parent_tool_use_id, subagent_type, depth | run channel + session channel 双推（service.py:462-480, 143-159） |
| SSE tokens | backend run_sync | frontend interactive-panel | input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens | 本次补读 cache 两维（service.py:162-177 已发，前端未读） |

**字段-DTO 对应**：
- `tool_use_id`：daemon message dict 顶层（task-runner.ts 注入）→ backend `AgentRunLog.parent_tool_use_id`（model.py:351，已存在）+ publish payload（service.py:472）→ frontend `AgentRunLogEntry.parent_tool_use_id`（agent.ts）
- `cache_*_tokens`：`SessionStreamEnvelope`（daemon.ts:884-885，已有）→ 本次 frontend 回调补读

**未覆盖事件**：无。tool_use/tool_result/submit/publish/tokens 全链路字段已存在，本次只是补齐 daemon tool_result 的 tool_use_id 注入 + frontend 读取。

## 8. 数据模型

**无表结构变更**。AgentRunLog 已有列（model.py:285-371）：`tool_kind`(367)、`parent_tool_use_id`(351)、`subagent_type`(355)、`depth`(359)。AgentRun token 列（model.py:175-228）已含 `input_tokens`/`output_tokens`/`cache_read_tokens`/`cache_creation_tokens`/`total_cost_usd`/`num_turns`/`duration_ms`。无需 migration。

## 9. 兼容策略（brownfield）

- **历史已落库双写日志**：旧 run 的 stdout `[TOOL_USE]` 行仍存在。frontend normalize.ts 保留启发式配对（toolNameIndex ±20 窗口，525-567）作降级，新旧日志都能渲染合并卡片。
- **未升级 daemon 的客户端**：旧 daemon 仍双写 stdout [TOOL_USE]，前端降级路径正常工作；新 daemon 不双写，前端按 tool_use_id 精确配对。两条路径共存。
- **tool_result 无 tool_use_id 的旧日志**：靠"紧邻 tool_call"的隐式顺序 + 启发式窗口配对（现有 lastToolSourceIdx 退化逻辑，normalize.ts:399 注释）。
- **backend run_sync 无需改动**：`tool_kind_by_tool_use_id` 继承逻辑（service.py:432-439）已存在，daemon 补 tool_use_id 后自动激活；旧 daemon 无 id 时 `_msg_tuid` 为 None 跳过，行为不变。
- **不改变的 API/表结构**：REST `/logs`、`/runs/{id}`、SSE `/stream` 契约不变；AgentRunLog 表不动。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | cache_creation 恒 0 根因未实证（D-004），存在两条独立路径：(a) Claude result.usage 不返回该字段；(b) accumulated（_currentTurnUsage）未采到 cache 维度（assistant 事件 usage 无 cache_creation） | P1 | Wave 1 首个 task 实证时同时 dump result.usage 原值 + accumulated 终值 + assistant message.usage 的 cache 字段；三分支策略（A1 修映射 / A2 修采集 / B 前端占位），见 D-004@v2 |
| R-02 | 2026-06-28-daemon-subagent-transcript 仍活跃，同改 agent_run_logs 周边 | P2 | plan 确认其 merge 状态；本次改 tool_kind/token 列，subagent 改归属三列，不直接冲突；execute 注意 merge 顺序 |
| R-03 | 前端 tool_result 按 id 配对在 id 缺失时退化 | P2 | 保留启发式窗口降级（normalize.ts 现有逻辑）；单测覆盖 id 缺失场景 |
| R-04 | daemon 改动影响 batch 路径终端用户 | P1 | terminal 回显独立（已查证 renderAgentEvent 不受影响）；daemon 单测 + 端到端验证 |
| R-05 | 折叠 UI 改变默认视图信息密度 | P2 | 折叠摘要保留可读性；原"对话/全部"视图切换不变 |

## 11. 决策追踪

当前版本决策见 `decisions.md`：D-001@v1（合并卡片）、D-002@v2（SYSTEM 折叠，含 isThinkingContent 改造）、D-003@v1（killed 占位）、D-004@v2（cache_creation 实证，三分支，investigate）、D-005@v1（历史回看 token）、D-006@v1（修订 C-02 daemon 不双写）、D-007@v1（前端 tool_result 按 parent_tool_use_id 配对是全新逻辑）。

覆盖关系见 decisions.md 末尾表格。仍未解决：D-004@v2 待 execute 实证（A1/A2/B 三分支）。

**Design Grill 已执行**（step 12）：1 P0（CC-01→D-007）+ 3 P1（CC-02/CC-06→D-004@v2/CC-09→D-002@v2）+ 2 P2（CC-04/CC-08）已全部修正，详见 decisions.md "Design Grill 修正记录"。

## 12. 自审

- ✅ **需求覆盖**：G1-G5 对应用户三类问题 + 用户两个体验决策（合并卡片、折叠）。
- ✅ **Grill 覆盖**：design §5 引用 D-001~D-006 全部当前版本决策。
- ✅ **约束一致性**：与 CONVENTIONS.md 一致（中文 UI、TDD、数据可清空、三端工具链）。backend SQLite/PG 方言：本次 backend 几乎不改（现有继承逻辑 dialect 无关）。
- ✅ **真实性**：文件路径/行号/字段名（tool_kind、parent_tool_use_id、cache_creation_tokens、extractResultStats、normalize.ts:525-567 等）均来自真实代码调研。
- ✅ **YAGNI**：不重写 normalize、不改表结构、不动 terminal 回显、不处理 codex cache。
- ✅ **验收标准**：G1-G5 可测——tool_use 不双写（daemon 单测断言 messages.length===1 for tool_use）、合并卡片渲染（frontend 单测）、token 四维显示（组件测试）、折叠交互（组件测试）、killed 占位（按 status 断言）。
- ✅ **非目标清晰**：N1-N5 明确。
- ✅ **兼容策略**：§9 三条降级路径。
- ✅ **风险识别**：R-01~R-05。
- ✅ **生命周期契约表**：§7.5 覆盖 submit tool_use/tool_result/publish/tokens，字段-DTO 对应齐全。

**自审结论**：通过。进入下一步。
