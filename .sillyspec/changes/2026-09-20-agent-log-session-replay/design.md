---
author: qinyi
created_at: 2026-09-20
scale: large
---

# 设计文档（Design）— 本地 Agent 会话回放按会话样式渲染 + 多 harness 解析器矩阵（usage/turn 打通）

> 变更：2026-09-20-agent-log-session-replay
> 决策依据：decisions.md D-001（用户亲选方案 A：TurnTimeline 直适配）；需求确认清单见 brainstorm step3 输出（用户交接卡授权，可否决）
> 原型：prototype-agent-log-session-replay.html（用户已确认）
> 实施基线：worktree `C:\Users\qinyi\IdeaProjects\multi-agent-platform-replay-redo`（分支 replay-redo，基线 53c67e02a）；SillySpec CLI 一律在主仓根目录跑（CLAUDE.md 规则 22）

## 1. 背景

origin=tool_report 且 turn_count===0 的会话（SillySpec CLI 自动上报创建）打开后，主体是**日志元数据卡列表**（`AgentLogSessionBody`，frontend/src/components/daemon/agent-log-card.tsx:1016）——harness 徽标/大小/调用次数/路径，正文藏在每条卡片「查看内容 ▾」的 320px 嵌套小窗里。用户结论：应该**直接按会话样式展示，只是数据来源不一样**。

2026-09-19 实证调研（生产库只读 + 本机真实日志解析）钉死的事实：

1. 会话 137ddfff 挂 6 条日志：1 条主日志（13MB，覆盖变更全生命周期，真人 user_input 仅 1 条 + 2 条 `<task-notification>` 系统通知）+ 5 条 `subagent_agent_` 前缀子代理日志（plan/execute/verify 各阶段）。主日志已含完整叙事（子代理以 Agent 工具调用出现、结果回流），子代理是并行工作会话。
2. zcode model-io 日志**每次 API 调用**带完整用量（`response.usage`：inputTokens/outputTokens/totalTokens/cacheReadTokens/cacheWriteTokens）+ 顶层 `turnId`（115 次调用聚成 3 轮：通知触发自主续跑 / 系统提醒 / 真人提问）+ `model{modelId,providerId}` + durationMs——但现有解析器 `parseZcodeModelIoLog`（sillyhub-daemon/src/agent-log/parse-zcode-model-io.ts:147）在 NormalizedLogMessage 里全部丢弃。
3. 解析器注册表（registry.ts）**仅注册 zcode-model-io-jsonl 一种**；生产库存量 claude-code 4 条（format=claude-code-jsonl，格式规整、usage 含 cache 四项、有 isMeta 标记，605 行 assistant 中 562 行非零 usage）无解析器→unsupported→原文回落；cursor IDE store.db（blob 库、无 token）维持不做；**cursor-agent CLI transcript**（`~/.cursor/projects/*/agent-transcripts/*/*.jsonl`，本机 96 份）是干净 JSONL（`{role,message}` 行 + `turn_ended` 事件切轮）但 **token 不落盘**（96/96 零 usage 键），且尚未被 CLI 扫描上报（sillyspec 仓职责，跨仓依赖）。
4. 「内容不对」的展示语义根因：系统注入消息（zcode task-notification/system-reminder、claude-code isMeta/注入上下文/tool_result 载体 user 行）冒充用户气泡；最新 200 段窗口机械落点在自主工作尾部。

## 2. 设计目标

- **FR-1（L1 主体置换）**：tool_report 未激活会话主体 = 真会话时间线（复用 TurnTimeline 组件，适配 NormalizedLogMessage→SessionTurnView），page 与 dialog 两形态都挂（dialog 现状对这类会话是空时间线，一并修复）。
- **FR-2（L2 显示语义）**：系统事件归一化（跨 harness 通则）——系统注入消息渲染为系统事件行，只有真人输入配用户气泡；首屏落点=最早可得窗口（顺序翻页到头，带上限）；超长输出折叠复用 TurnTimeline 内建（30k 字符）。
- **FR-3（L2.5 token/turn 打通）**：daemon 解析器矩阵——zcode 补 usage/turnId/model/全会话累计；新增 claude-code-jsonl 解析器（对话+usage）；新增 cursor-agent-transcript 解析器（对话、usage 恒缺省）；四层链路 daemon→RPC→平台 schema→gen:types→前端；老 daemon/老数据字段可选缺省「未知」。
- **FR-4（结构规则）**：多日志会话中主日志=正文（非 `subagent_agent_` 前缀），子代理日志=顶部「工作会话」次级入口（点击在回放中查看其自身对话），不并入正文。

## 3. 非目标

- **不做 L3 落库**：解析产物不持久化到平台库，回放依赖上报机器在线 + 本地日志文件存在（与现状同口径）。
- **不做 cursor-agent provider 化**：运行时 stream-json/hooks token 捕获属 daemon provider 集成，另一功能。
- **不做 cursor IDE store.db 对话化**（blob 库，无 token，存量 1 条）。
- **不改 sillyspec 仓扫描上报层**：cursor-agent transcript 的发现/上报/format 串产出在 sillyspec 仓——本仓只预置解析器与格式 key 契约（`cursor-agent-transcript`），等 CLI 侧上报后即通。
- **不动已激活 tool_report 会话形态**（turn_count>0 走正常对话流 + 顶部 AgentLogCard 折叠栏，现状保留）。
- **不改 200 段窗口/20MB/5s 预算与 beforeSeq 分页协议**（新增字段不新增端点/参数）。

## 4. 拆分判断

单变更不拆：三 Wave（daemon→backend→frontend）是一条数据流的上下游，拆开会形成中间态 schema 不齐（gen:types 对不上 daemon 字段）；且全部改动共享同一验收场景（回放页面）。规模 large（跨 3 子项目 + OpenAPI schema + 前端类型再生成）。

## 5. 总体方案

### Wave 1 — daemon 解析器矩阵（sillyhub-daemon）

**1.1 消息字段扩展（parse-zcode-model-io.ts）**

NormalizedLogMessage 增可选字段（全部可缺省，老 fixture 不破坏；**内层键全 snake_case，经 RPC 原样序列化零改名**——沿用 registry.ts:33-47 既有「messages 内层逐字段已对齐无需改名」约定，Grill F-1 修订）：

```ts
/** 该段所属 CLI 轮次 id（zcode 行顶层 turnId；缺失=null） */
turn_id?: string | null;
/** 产出该段的模型 id（zcode 行顶层 model.modelId；缺失=null） */
model?: string | null;
/** 该段关联调用的用量（产出段挂其源调用的 response.usage，键名 snake_case 直通四层）；无=null */
usage?: { input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number } | null;
/** claude-code isMeta 行标记（解析层保留原文与标记位，前端按系统事件处理） */
is_meta?: boolean;
/** cursor-agent turn_ended 生命周期事件标记（适配层据此切轮） */
turn_end?: boolean;
```

usage 挂载规则：reply/tool_use/thinking 段取**产出该段的 API 行**的 response.usage。ZcodeModelIoParseResult 增 `totalUsage`（全量行 usage 求和，窗口截断前算；**外层键 camelCase 沿用 daemon RPC 外层惯例**，内层键同上 snake_case）：

```ts
totalUsage?: { input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number } | null;
```

AgentLogMessagesResult（registry.ts）同步增可选 `totalUsage`。

**1.2 zcode SQLite 优先路径（read-zcode-sqlite.ts）**

execute 首个任务实证 `~/.zcode/cli/db/db.sqlite` 的 message/part data JSON 中 token 可得性（step-finish part 形态）。可得→读取器透传 usage/turn 边界（message 语义/时间切轮）+ totalUsage；不可得→usage 字段缺省（前端「未知」），**不回落文件双读**（一次回放两次 20MB 解析得不偿失；rollout 文件路径天然保有 token）。实证结论落 QUICKLOG。

**1.3 新解析器 parse-claude-code-jsonl.ts**

- 行过滤：`type∈{user,assistant}`；`queue-operation/attachment/last-prompt/mode/system` 行跳过（attachment 计入坏行外的忽略行）。
- assistant 行：content 块 text→reply 段、thinking→thinking 段、tool_use→tool_use 段（toolUseId=id、raw=JSON.stringify(input)）；usage 挂到该行产出的段，**归一为全量口径**（Grill v3 终笔：claude-code/Anthropic 惯例 input_tokens 不含缓存，zcode inputTokens 已含——统一 `input_tokens = 原始 input_tokens + cache_read_input_tokens + cache_creation_input_tokens`，`cache_read_tokens = cache_read_input_tokens`，`cache_write_tokens = cache_creation_input_tokens`；这样前端 ctx/徽标跨 harness 同一口径，zcode 侧原生已满足不重算）；
- user 行：content 为纯 tool_result 块→tool_result 段（不产 user_input）；含 text 且**非 isMeta**→user_input 段（真人）；isMeta=true→text 段照常产出但置 `is_meta: true`（前端按系统事件处理，解析层不改判）。
- 切轮：真人 user_input 为轮边界；文件级 sessionId 即会话（sidechain 行随主文件，不单独归属）。
- 预算/窗口/beforeSeq/skippedLines 语义与 zcode 解析器逐字对齐（20MB/200 段/5s）。

**1.4 新解析器 parse-cursor-agent-transcript.ts**

- 行形态：`{role:'user'|'assistant', message:{content:[{type:'text'|'tool_use'|'tool_result',…}]}}` + `{type:'turn_ended',status}` 生命周期事件。
- text 块→reply/user_input（role 判定）；tool_use→tool_use 段（call_id 配对）；tool_result 块（user 行内）→tool_result 段；turn_ended→轮边界标记（turn_id=null 但产 `turn_marker` 信息——用 NormalizedLogMessage 现有字段无法表达，增可选 `turn_end?: boolean`，适配层据此切轮）。
- usage/totalUsage 恒 null（token 不落盘，实证 96/96）。
- 防御：非 JSON 行计数入 skippedLines；未知块类型忽略（文档承诺向后兼容增字段）。

**1.5 registry 注册与 RPC 透传**

PARSERS 增 `'claude-code-jsonl'→parseClaudeCodeJsonlLog`、`'cursor-agent-transcript'→parseCursorAgentTranscriptLog`。host-fs-handler.readAgentLogMessages 零逻辑改动（result 结构透传，totalUsage 随 result 自动上行；sqlite 分支返回值同构）。

### Wave 2 — 平台 schema + OpenAPI（backend）

**2.1 schema.py**：AgentLogMessageItem 增 `turn_id: str|None=None`、`model: str|None=None`、`is_meta: bool|None=None`、`turn_end: bool|None=None`、`usage: AgentLogUsage|None=None`；新嵌套模型 `AgentLogUsage{input_tokens,output_tokens,cache_read_tokens,cache_write_tokens:int}`；AgentLogMessagesResponse 增 `totals: AgentLogUsage|None=None`。

**2.2 router.py read_agent_log_messages 转换层（Grill F-1 修订）**：messages 内层**零改名**——daemon 消息级新字段（turn_id/model/is_meta/turn_end/usage 及其内层 snake_case 键）经 RPC 原样 JSON 序列化，pydantic model_validate 递归校验直接命中（与既有 totalSegments 外层/skipped_lines 内层同构）；转换层**仅补一行外层映射** `totalUsage→totals`（外层 camelCase→snake_case 惯例）。全部 Optional：老 daemon 无字段→None。

**2.3 gen:types**：worktree 内 `PYTHONPATH=<worktree>/backend` 防主仓 venv editable 陷阱（docs/sillyspec/finished/worktree-gen-types-editable-install-trap.md），重导出 backend/openapi.json + frontend/src/lib/api-types.ts 并随变更提交。

### Wave 3 — 前端回放主体（frontend）

**3.1 适配层（纯函数）frontend/src/lib/agent-log-replay.ts**

- `isSubagentLog(entry)`：session_id 或 log_path 含 `subagent` → 工作会话；主日志=其余，按 first_seen_at 升序，多个主日志默认展示最新、其余「更早的本地会话」切换。
- `buildReplayTurns(messages): SessionTurnView[]`：
  - **轮边界双保险**：真人 user_input（系统事件判定之外）或 turn_id 变化或 turn_end 标记→新轮；
  - **系统事件归一化（跨 harness 通则，Grill G-2 修订）**：zcode `<task-notification>`/`<system-reminder>` 前缀文本、claude-code is_meta=true 文本→该轮 processItems 首项 `kind:'stderr'` 条目（文本加「⚙ 系统事件 · 」前缀，渲染复用 TurnTimeline stderr 项的弱化样式：不占用户气泡、全部视图可见、对话视图隐藏——回放默认全部视图，与原型「系统事件行」语义一致）；TurnTimeline 零改动；
  - **段映射**：reply→output 拼接；thinking/tool_use/tool_result→processItems（kind: thinking/tool，tool.raw=tool_input、result=tool_result、status: 'ok'/'deny' 按 is_error；tool_use 无配对 result→status:'ok' 且 result 缺省 + raw 前缀「[结果未记录]」标记——不假 running）；
  - **token**：inputTokens/outputTokens=轮内 usage 求和（无任何 usage→null→徽标「未知」）；ctxTokens=轮末次调用 usage.input_tokens（**全量口径**：解析器层已统一 input 含缓存命中/写入——zcode 原生即含、claude-code 归一并入，Grill v3 终笔）；
  - 必填契约：runId=`replay-<seq>`、**turn: null**（合法，先例 runtime-session-helpers.tsx:442）、prompt=真人文本（系统触发轮 prompt=''，string 不可 null）、output=reply 拼接（空串）、status:'completed'、seenLogIds:new Set()。
- 回归纯函数可单测（fixture=调研实证的消息形状）。

**3.2 主体组件 frontend/src/components/daemon/agent-log-replay-body.tsx**

- 数据链：listAgentLogs(sessionId) → 主日志选择 → readAgentLogMessages(entryId, beforeSeq?) 顺序翻页到最早（上限 10 页/2000 段，超限停在该页并提示）→ buildReplayTurns 正序渲染；
- 顶部条（替换原孤立说明行）：「本地 Agent 会话回放」+ harness chip + 主日志 chip + 「工作会话（N）」浮层（子代理条目列表，点击切换 selectedEntryId 查看其回放，可返回主日志）+ 用量汇总（totals：输入/输出/缓存命中/模型；null→「未知」）+ 刷新（invalidate agentLogs 键，保留 30s 轮询）；
- TurnTimeline 挂载：viewMode 本地态默认 'all'（回放价值在全程，可切'对话'）；errorMsg=null、pendingRequests=[]、dialogHistory=[]、onDialogResolved/onResend/onSwitchProvider=noop、sessionStatus='ended'（死卡防护）、hasOnlineProvider=机器在线、emptyProviderLabel=provider 展示名；streamFooter 不用；
- 回落（逐条目独立）：status≠parsed（unsupported/parse_error/too_large）或 ApiError（422 老 daemon/409/404/5xx）→ 该条目回落原文 <pre>（复用 RawLogContent 语义）+ 黄条原因，不弹错框；机器离线（404 无归属/504）→ 离线提示条 + 元数据（harness/短码/路径，可复制）；
- 「加载更早」pill 顶部前插（beforeSeq=当前最小 seq）；
- 容器与 TurnTimeline 同构（min-h-0 flex-1 overflow-y-auto），布局零跳动；
- 双主题铁律：新顶部条/浮层用 brand-* 语义阶 + 主题 token，不硬编码 hex。

**3.3 挂载点**

- session-panel-page.tsx:3520：`isToolReportBody` 分支 AgentLogSessionBody→AgentLogReplayBody（mobile/desktop 共路径）；
- session-panel-dialog.tsx:1913（Grill G-3 修订）：dialog 现无 session 详情 state（文件内注释明言），新增轻查询 `useQuery(getAgentSession(sessionId))`（既有 API，frontend/src/lib/daemon/sessions.ts:586）取 origin/turn_count 判分支，TurnTimeline 前挂 AgentLogReplayBody（dialog 形态现状空时间线缺陷一并修复）；
- agent-log-card.tsx：**删除 AgentLogSessionBody 导出与实现**（被取代；AgentLogCard 顶部折叠栏与「查看内容」内联面板保留——已激活会话仍用）；page-helpers.tsx:69 与 session-panel-page.tsx:4014/:4048 三处引用注释同步改写。

**3.4 兼容矩阵**

| 场景 | 行为 |
|---|---|
| 老 daemon（无新字段） | usage/turn 缺省→token「未知」、轮边界退化为 user_input 单保险 |
| 老 daemon（无 messages RPC） | 422→原文回落（现状语义不变） |
| cursor-agent transcript | 对话可回放，token「未知」 |
| 机器离线 | 离线提示 + 元数据，正文不可读（与现状同口径） |
| 已激活 tool_report（turn_count>0） | 不走本路径（现状正常对话流 + AgentLogCard） |

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/agent-log/parse-zcode-model-io.ts | NormalizedLogMessage 增 turn_id/model/usage/is_meta/turn_end 可选字段（内层键 snake_case 直通）；ParseResult 增 totalUsage（外层 camelCase）。数据流：zcode 行顶层 turnId/model.modelId/response.usage →（producer 解析器，键名归一 snake_case）→ RPC result.messages[].* 原样序列化 + result.totalUsage →（platform router 仅外层 totalUsage→totals 一行映射）→ OpenAPI → 前端 api-types →（consumer）agent-log-replay.ts 适配 |
| 新增 | NEW:sillyhub-daemon/src/agent-log/parse-claude-code-jsonl.ts | claude-code JSONL 解析器：行过滤/段映射/usage 键归一（input_tokens 并入 cache_read+cache_creation 成全量口径，见 §1.3；snake_case 直通）/真人切轮/is_meta 标记；预算窗口对齐 zcode 解析器 |
| 新增 | NEW:sillyhub-daemon/src/agent-log/parse-cursor-agent-transcript.ts | cursor-agent transcript 解析器：{role,message} 行 + turn_ended 切轮；usage 恒 null |
| 修改 | sillyhub-daemon/src/agent-log/registry.ts | PARSERS 注册 claude-code-jsonl / cursor-agent-transcript；AgentLogMessagesResult 增可选 totalUsage（producer 各解析器 → consumer host-fs-handler 透传） |
| 修改 | sillyhub-daemon/src/agent-log/read-zcode-sqlite.ts | 实证后透传 usage/轮边界/totalUsage（db.sqlite step-finish token 可得性实证，execute 首任务；不可得则缺省） |
| 修改 | sillyhub-daemon/src/host-fs-handler.ts | readAgentLogMessages 返回类型注释/透传确认（result 结构扩展自动上行，预期零逻辑改动） |
| 修改 | sillyhub-daemon/tests/agent-log/parse-zcode-model-io.test.ts | usage/turnId/totalUsage 断言 + 老 fixture 兼容回归 |
| 新增 | NEW:sillyhub-daemon/tests/agent-log/parse-claude-code-jsonl.test.ts | fixture 覆盖：tool_result 载体 user 行/isMeta/usage 求和/切轮/坏行 |
| 新增 | NEW:sillyhub-daemon/tests/agent-log/parse-cursor-agent-transcript.test.ts | fixture 覆盖：turn_ended 切轮/tool 配对/无 usage/非 JSON 行 |
| 修改 | sillyhub-daemon/tests/agent-log/read-agent-log-messages.test.ts | registry 新格式分发 + totalUsage 透传断言 |
| 修改 | sillyhub-daemon/tests/agent-log/read-zcode-sqlite.test.ts | sqlite 路径 usage/轮边界透传断言（实证可得时；不可得时缺省断言——Grill G-4 修订补） |
| 修改 | backend/app/modules/platform_sync/schema.py | AgentLogMessageItem 增 turn_id/model/is_meta/turn_end/usage；新 AgentLogUsage 模型（内层 snake_case 与 daemon 直通）；Response 增 totals。数据流：daemon RPC →（转换层外层一跳）→ snake_case schema → OpenAPI → api-types |
| 修改 | backend/app/modules/platform_sync/router.py | read_agent_log_messages 转换层仅补外层 `totalUsage→totals` 一行映射（messages 内层零改名，Grill F-1 修订），全 Optional 老 daemon 缺省 None |
| 修改 | backend/app/modules/platform_sync/tests/test_agent_log_messages.py | 新字段映射/缺省断言 |
| 修改 | backend/openapi.json | gen:types 重导出（PYTHONPATH=<worktree>/backend 防主仓 venv editable 陷阱） |
| 修改 | frontend/src/lib/api-types.ts | pnpm gen:types 再生成（数据流终点，禁止手写——CLAUDE.md 规则 21） |
| 新增 | NEW:frontend/src/lib/agent-log-replay.ts | 纯函数适配层：isSubagentLog/主日志排序/buildReplayTurns（系统事件归一化/轮边界双保险/token 求和）。consumer of api-types 新字段 |
| 新增 | NEW:frontend/src/components/daemon/agent-log-replay-body.tsx | 回放主体组件：数据链/顶部条+工作会话浮层+用量汇总/TurnTimeline 挂载/回落与离线态 |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | sessionBody 分支（:3520）AgentLogSessionBody→AgentLogReplayBody；:4014/:4048 注释同步 |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-dialog.tsx | 新增 getAgentSession 轻查询（sessions.ts:586）判 origin/turn_count，TurnTimeline（:1913）前挂 AgentLogReplayBody（Grill G-3 修订） |
| 修改 | frontend/src/components/daemon/session-panel/page-helpers.tsx | :69 AgentLogSessionBody 引用注释同步（仅注释） |
| 修改 | frontend/src/components/daemon/agent-log-card.tsx | 删除 AgentLogSessionBody（被取代）；AgentLogCard/查看内容保留 |
| 新增 | NEW:frontend/src/lib/__tests__/agent-log-replay.test.ts | 适配层单测：系统事件/双保险切轮/token 未知/子代理判定/多主日志排序 |
| 新增 | NEW:frontend/src/components/daemon/__tests__/agent-log-replay-body.test.tsx | 组件 smoke：主日志选择/回落原文/离线态/工作会话切换 |
| 修改 | frontend/src/components/daemon/__tests__/agent-log-card.test.tsx | AgentLogSessionBody 用例迁移/删除 |

## 7. 测试策略（scoped，禁全量）

- daemon：`pnpm vitest run tests/agent-log`（直改 5 个测试文件：parse-zcode-model-io / parse-claude-code-jsonl / parse-cursor-agent-transcript / read-agent-log-messages / read-zcode-sqlite；liveness/ 子目录不涉及）；
- backend：`uv run pytest -q --no-cov app/modules/platform_sync/tests/test_agent_log_messages.py`；
- frontend：`pnpm vitest run src/lib/__tests__/agent-log-replay.test.ts src/components/daemon/__tests__/agent-log-replay-body.test.tsx src/components/daemon/__tests__/agent-log-card.test.tsx`（replay-body smoke 含 page 挂载分支 + dialog 挂载分支两形态，Grill v3 终笔）；
- 类型链：gen:types 后 `pnpm exec tsc --noEmit`（frontend，先确认 node_modules 健康）。

## 8. 风险与回落

| 风险 | 缓解 |
|---|---|
| db.sqlite 无 token 数据（未实证） | 字段全可选，缺省=「未知」不炸；实证结论 QUICKLOG 留痕 |
| 大日志首屏翻页多请求（200 段/页） | 上限 10 页停驻+提示；单页解析实测 13MB/41ms 可承受 |
| TurnTimeline props 契约对不齐（ISP 现状） | 运行态 props 空置清单在 3.2 固定；dialog/page 两消费方同参数 |
| 双仓节奏（cursor-agent 上报在 sillyspec 仓） | 格式 key 契约先行，本仓解析器 fixture 自证；CLI 侧上报后零改动即通 |
| 老 daemon 混布 | 兼容矩阵 3.4：全字段可选 + 422/unsupported 原文回落不变 |

## 9. 生命周期契约：无/N/A（本变更是只读回放渲染 + 解析器字段扩展，不新增任何事件×状态迁移/心跳/认领语义；会话激活（turn_count 0→1）沿用既有懒激活契约不动）

## 10. 自审（Self-Review）

- 字段命名：daemon 消息级含 usage 内层全 snake_case 直通，router 仅外层 totalUsage→totals 一行（Grill F-1 修订后全链一致，§1.1/§1.3/§2.2 互检无矛盾）；
- token 口径：全量 input_tokens（含缓存命中/写入）跨 harness 统一，zcode 原生满足、claude-code 归一（§1.3/§3.1 互检一致）；
- TurnTimeline 契约：八字段必填齐（runId/turn:null/prompt:string/output/status/seenLogIds/inputTokens/outputTokens），系统事件落 stderr 原语不新增 SessionProcessItem 种类，TurnTimeline 零改动；
- 挂载面：page :3520 + dialog :1913（getAgentSession 轻查询）双分支，AgentLogSessionBody 删除后三处引用注释同步入清单；
- 测试面：daemon 5 测试文件/后端 1/前端 3，sqlite 可得/不可得双分支均安排；
- 遗留不确定：db.sqlite token 可得性未实证（task-02 首任务实证，结论落 QUICKLOG；两种走向都有既定行为不炸）。

## 11. 验收口径

- 打开 137ddfff 同型会话：主体=会话样式对话流（含系统事件行、真人用户气泡、思考折叠、工具卡片、轮 token 徽标、用量汇总条）；
- claude-code 日志「查看内容」/回放=对话化（非原文）；cursor-agent fixture 走解析器绿；
- 老协议（无新字段 mock）token 显示「未知」不报错；
- 已激活会话、普通会话、群聊面板零回归（不触碰）。
