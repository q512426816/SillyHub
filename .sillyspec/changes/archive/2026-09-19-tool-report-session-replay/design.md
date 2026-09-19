---
author: qinyi
created_at: 2026-09-19 20:45:30
generated_by: sillyspec-design-init
scale: large
---

# 设计文档（Design）— 2026-09-19-tool-report-session-replay

<!-- 引用规范：全文源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦 -->

## 背景

origin=tool_report 且 turn_count===0 的会话（SillySpec CLI 自动上报创建）当前主体是
`AgentLogSessionBody`（frontend/src/components/daemon/agent-log-card.tsx:1016）——渲染
**日志元数据卡列表**，对话内容藏在每条卡「查看内容 ▾」的 320px 嵌套小窗（标题即
「会话回放」）里。

实证（2026-09-19，生产库只读 + 本机真实日志实测，样本会话
`137ddfff-e612-47b9-9efd-749a3dfb4277`）暴露三重问题：

1. **形态错位**：主对话被埋在元数据卡与子代理日志中间（该会话 1 主日志 + 5 条
   `subagent_agent_` 前缀子代理日志）；嵌套小窗字号/高度都是「附件」级，不是会话级。
2. **内容错位**：自主运行日志里 user 角色消息多为系统注入（主日志 327 段仅 2 条
   user 且均为 `<task-notification>`），按用户气泡渲染直接「内容不对」；最新 200
   段窗口落在自主工作尾部（工具调用墙），真人提问被「加载更早」藏起。
3. **信息缺失**：zcode 日志每次调用含 `response.usage` 五项 token + 顶层
   `turnId`/`model`/`durationMs`（115 次调用实证聚 3 轮），但解析器
   （sillyhub-daemon/src/agent-log/parse-zcode-model-io.ts:66 NormalizedLogMessage）
   全部丢弃；claude-code 格式规整含 usage 但无解析器（unsupported 回落原文）；
   cursor-agent transcript（本机 96 份）干净 JSONL 但零上报、token 不落盘。

用户需求原话：「应该直接按 会话样式展示，只是数据来源不一样而已」「还有 token
信息也要能获取到」「不光 zcode 其他 agent 你也核对下是否能正确获取，以及正确显示」。

## 设计目标

- **FR-01 会话样式回放主体**：tool_report 纯日志会话的主体 = 会话时间线
  （TurnTimeline 真组件复用），数据源 = agent 日志对话化消息；主日志为正文、子代理
  日志为次级「工作会话」入口；支持「对话/全部」视图与轮次导航（组件既有能力）。
- **FR-02 跨 harness 归一化与解析器矩阵**：伪用户消息（task-notification /
  system-reminder / isMeta / 注入上下文 / 纯 tool_result 载体行）归一为系统事件或
  工具段，仅真人输入作用户气泡；新增 claude-code-jsonl 与 cursor-agent-transcript
  解析器，zcode 既有解析器补字段。
- **FR-03 token 链路**：usage/turnId/model/durationMs/全会话累计 从 daemon 解析器
  → RPC → 平台 schema → gen:types → 前端轮徽标与用量显示四层打通；数据源无 token
  时显式「未知」，不伪造。
- **FR-04 不可用态显式化**：机器离线 / 格式不支持（cursor IDE 二进制 409 死胡同改
  像样说明）/ 文件已清理 三态中文提示，元数据保留可见。

## 非目标

- **不做 L3 落库**：回放沿用按需 RPC 现读，解析产物不入库（D-007；持久化单独决策）。
- **不做 cursor-agent provider 化**：运行时 stream-json/hooks 捕获 token 属 provider
  集成，另行立项。
- **不做 cursor IDE store.db 对话化**：blob 库 + 无 token，投入产出不成立（D-006）。
- **不展示 CLI 命令原文轮起点**：日志有轮边界无命令文本（D-005 实证），轮起点有真人
  文本用原文、无则用系统事件标记，不伪造命令。
- **不动已激活路径**：turn_count>0 的 tool_report 会话（正常对话流 + 顶部
  AgentLogCard 折叠栏）与 chat 会话零改动；首条消息懒激活派发机制维持原状。
- **不改 sillyspec 仓**：cursor-agent transcript 扫描上报属独立仓，本仓只交付
  daemon/平台侧先行就绪 + docs/sillyspec/ 跨仓跟进记录。

## 拆分判断

单一垂直功能（一条回放链路：解析器→RPC→schema→前端主体），三层改动由同一契约
（NormalizedLogMessage 扩展）串联，拆开会导致 schema 演进碎片化；不满足「3+ 可独立
交付功能模块」的拆分条件。非批量模式（无「模板 × 数据」重复模式，任务 < 15）。

## 总体方案

方案 A（适配复用，D-008 用户已选）：前端适配器把消息映射成 TurnTimeline 的
SessionTurnView，渲染层单源；token/归一化在 daemon 解析器层解决；平台库零表结构
改动。分四个 Phase（= plan 的 Wave 骨架）：

### Phase 1 — daemon 解析器矩阵（sillyhub-daemon）

1. **契约扩展**：`NormalizedLogMessage`（sillyhub-daemon/src/agent-log/
   parse-zcode-model-io.ts:66）增可选字段 `usage`（五项）、`turn_id`、`model`、
   `duration_ms`、`sender`（`human | system_event`，缺省 human——user_input 段专用；
   其余 kind 语义不变）。`AgentLogMessagesResult`（sillyhub-daemon/src/agent-log/
   registry.ts:46）增可选 `totalUsage`（全会话累计，解析器全量过一遍后顺带求和）。
2. **zcode 补字段**：逐行读顶层 `turnId/model/durationMs` + `response.usage`，附着
   到该次调用产出的段（补产段同理）；`user_input` 文本以 `<task-notification>` /
   `<system-reminder>` 开头 → `sender=system_event`。sqlite 持久库读取器
   （sillyhub-daemon/src/agent-log/read-zcode-sqlite.ts readZcodeSqliteMessages）同步
   补字段——**execute 前核对 db.sqlite 的 message/part JSON 是否含 usage**，缺则该
   路径 usage/totalUsage 置 undefined（前端显示未知），核对结论记入 verify-facts。
3. **新增 parse-claude-code-jsonl**：只取 user/assistant 行（queue-operation /
   attachment / mode / last-prompt / system 跳过）；assistant content 块
   thinking/text/tool_use → 对应段 + `message.usage` 透传；user 行纯 tool_result
   块 → 工具段（按 tool_use_id 与 assistant 配对，失配走孤儿结果）；`isMeta=true`
   或内容以已知注入标记开头（`【当前用户信息】` 等平台注入块，白名单前缀）→
   `system_event`；其余 text user → 真人 user_input。
4. **新增 parse-cursor-agent-transcript**：`{role,message}` 行 + `turn_ended` 事件
   （96 份中 89 份实证有）切轮；无 usage（不落盘，恒未知）；
   **execute 前用真实 transcript fixture 核对 tool_result 的落盘形态**（实证样本
   仅见 text/tool_use，工具结果载体形态待 fixture 确认，见 R-02）。
5. **注册**：registry.ts PARSERS 增 `claude-code-jsonl`、
   `cursor-agent-transcript-jsonl` 两键（format 串与扫描上报层未来约定一致）。
6. host-fs-handler.ts:2035 readAgentLogMessages 原样透传新字段（unsupported/
   too_large 早退分支不受影响）。

### Phase 2 — 平台 schema（backend）

`GET /agent-logs/{entry_id}/messages`（backend/app/modules/platform_sync/router.py:849）
内层消息 schema 增同名可选字段 + 外层 `total_usage`；透传映射零改写语义不变（老
daemon 不返回即缺省）。openapi.json + `pnpm gen:types` 重生成前端类型。零表结构变更。

### Phase 3 — 前端会话主体（frontend）

1. **适配器**（纯函数，可单测）：`NormalizedLogMessage[]` → `SessionTurnView[]`——
   按 `turn_id` 变化 / 真人 user_input 切轮；`sender=system_event` → 中性系统事件行；
   thinking/tool_use/tool_result → `processItems`（frontend/src/components/daemon/
   turn-timeline.tsx:190 SessionProcessItem）；reply → output；usage 聚到轮级
   `inputTokens/outputTokens`、`ctxTokens`=该轮末次调用 inputTokens（zcode
   inputTokens 已含 cacheRead，与平台 input+cache_read 口径一致）；缺
   usage → null（「未知」既有兜底）。
   **TurnTimeline 最小扩展**（Grill 交叉点 1 结论）：系统事件中性行在 TurnRow 无
   既有承载分支（唯一中性紧凑行门控在 whoLine）——给 SessionProcessItem 增
   `system_event` kind（或等价机制），渲染为居中虚线边框中性行（原型 .sysrow 形态），
   仅回放数据路径产生该 kind，实时会话零出现（改动收敛在 turn-timeline.tsx 单点）。
2. **AgentReplayBody 组件**（替换 AgentLogSessionBody 作 isToolReportBody 主体）：
   `listAgentLogs` → 按 `subagent_agent_` 前缀分主/子 → 主日志 `readAgentLogMessages`
   最新窗口 + 触顶「加载更早」（beforeSeq 前插，沿用既有分页语义）→ 适配器 →
   TurnTimeline。多条主日志（同 ctx 多次本地会话）：最新为主，更早主日志归入折叠条。
   **TurnTimeline 必填 props 回放取值**（Grill 交叉点 2 结论，11 项逐一）：
   `turns`=适配器产物；`viewMode`=本地 state（对话/全部切换，与普通会话同款控件）；
   `errorMsg`=null（错误走主体三态提示行，不进时间线）；`daemonRestartedHint`=null；
   `autoResumeEntries`=[]；`sessionStatus`="idle"（回放只读，不渲染待答卡/恢复卡）；
   `pendingRequests`=[]；`dialogHistory`=[]；`onDialogResolved`/`onResend`/
   `onSwitchProvider`=no-op 回调；`hasOnlineProvider`=false（空态文案走回放自有空态，
   不显示 provider 就绪提示）；`emptyProviderLabel`=""；`highlightTurnKey`=跳转选中轮；
   `suppressFollowBottom`=跳转翻页期间置位（沿用既有语义）。
3. **工作会话折叠条**：子代理日志以「工作会话（N）」条呈现（形态对齐既有
   AgentLogCard 折叠栏），点击展开列表，条目点击进入该日志的回放（同组件复用，
   传入 entryId 直读）。
4. **不可用三态**：daemon 离线（404 no daemon）/ 格式不支持（unsupported / 409
   cursor IDE）/ 文件缺失（not_found）→ 顶部显式中文提示行；元数据（harness/
   大小/调用数/时间）保留可见。
5. 会话累计用量：底部输入区旁显示 `total_usage`（daemon 一并返回，前端不求和）。
6. AgentLogSessionBody 退役删除；agent-log-card.tsx 保留 AgentLogCard（activated
   会话顶部栏）与 AgentLogEntry 元数据行。

### Phase 4 — 跨仓跟进记录（docs）

`docs/sillyspec/cursor-agent-transcript-report-pipeline.md`：记录 sillyspec 仓待办
（扫描 `~/.cursor/projects/*/agent-transcripts/*/*.jsonl`、format 串
`cursor-agent-transcript-jsonl`、归属沿用 ctx 规则），本仓解析器/平台侧已就绪；
上报落地前 cursor-agent 会话不会出现在平台（不阻塞本期）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/agent-log/parse-zcode-model-io.ts | NormalizedLogMessage 增可选 usage/turn_id/model/duration_ms/sender；解析透传行顶层 turnId/model/durationMs + response.usage；task-notification/system-reminder user → system_event。数据流：zcode jsonl 行（producer）→ 解析器附着段（本文件）→ RPC 透传 → 平台 messages 端点（consumer） |
| 修改 | sillyhub-daemon/src/agent-log/read-zcode-sqlite.ts | readZcodeSqliteMessages 同步补字段（execute 前 fixture 核对 db.sqlite JSON 含 usage 与否；缺则 undefined + verify-facts 记录） |
| 新增 | NEW:sillyhub-daemon/src/agent-log/parse-claude-code-jsonl.ts | claude-code JSONL 解析器（行过滤 / isMeta+注入前缀→system_event / tool_result 载体→工具段配对 / message.usage 透传） |
| 新增 | NEW:sillyhub-daemon/src/agent-log/parse-cursor-agent-transcript.ts | cursor-agent transcript 解析器（{role,message} 行 + turn_ended 切轮；无 usage） |
| 修改 | sillyhub-daemon/src/agent-log/registry.ts | PARSERS 注册 claude-code-jsonl / cursor-agent-transcript-jsonl；AgentLogMessagesResult 增可选 totalUsage |
| 修改 | sillyhub-daemon/src/host-fs-handler.ts | readAgentLogMessages 透传新字段与 totalUsage（producer=解析器/读取器 → consumer=RPC 响应） |
| 新增 | NEW:sillyhub-daemon/tests/agent-log/parse-claude-code.test.ts | claude-code 解析器单测（isMeta/tool_result 载体/usage 场景脱敏 fixture） |
| 新增 | NEW:sillyhub-daemon/tests/agent-log/parse-cursor-agent.test.ts | cursor-agent 解析器单测（turn_ended 切轮/无 usage 兜底脱敏 fixture） |
| 新增 | NEW:sillyhub-daemon/tests/agent-log-matrix.test.ts | 解析器矩阵单测：三 harness 真实日志脱敏 fixture 交叉断言 + 字段断言 |
| 修改 | sillyhub-daemon/tests/agent-log/parse-zcode-model-io.test.ts | zcode 既有形状断言更新（新可选字段 + system_event 归一） |
| 修改 | sillyhub-daemon/tests/agent-log/read-zcode-sqlite.test.ts | sqlite 读取器断言更新（spike-01 结论采纳路径） |
| 修改 | backend/app/modules/platform_sync/schema.py | AgentLogMessagesResponse 内层消息可选新字段 + total_usage（producer=daemon RPC → consumer=openapi/前端） |
| 修改 | backend/app/modules/platform_sync/router.py | messages 端点透传新字段映射（camel→snake 转换层同现状） |
| 修改 | backend/app/modules/platform_sync/tests/test_agent_log_messages.py | task-08 连带：既有严格相等断言按新字段补齐 + camel→snake 端到端映射断言（execute 补录，review 留痕） |
| 修改 | backend/openapi.json | gen:types 命令产物 |
| 修改 | frontend/src/lib/api-types.ts | gen:types 命令产物 |
| 新增 | NEW:frontend/src/lib/agent-log-turns.ts | 适配器纯函数 buildReplayTurns(messages): SessionTurnView[]（切轮/系统事件/processItems/轮级 usage 聚合/未知兜底） |
| 新增 | NEW:frontend/src/lib/__tests__/agent-log-turns.test.ts | 适配器单测（真人/系统事件/工具配对/usage 聚合/无 usage 兜底/孤儿结果） |
| 新增 | NEW:frontend/src/components/daemon/agent-replay-body.tsx | 回放主体组件（主/子分类、messages 拉取与加载更早、TurnTimeline 挂载、工作会话折叠条、不可用三态、total_usage 显示） |
| 修改 | frontend/src/components/daemon/turn-timeline.tsx | TurnTimeline 最小扩展：SessionProcessItem 增 system_event kind + 居中虚线中性行渲染分支（Grill 交叉点 1；仅回放数据路径产生，实时会话零出现） |
| 修改 | frontend/src/components/daemon/session-log-assembler.ts | task-10 类型层涟漪（execute 补录，review 留痕）：与 turn-timeline 逐字段一致的镜像类型 parity 同步增 system_event 成员，投影不产该项 |
| 修改 | frontend/src/components/daemon/session-panel/dialog-helpers.ts | task-10 类型层涟漪（execute 补录，review 留痕）：bootstrapLegacySegments 一行类型谓词守卫跳过 system_event（段模型无承载，运行时不可达） |
| 新增 | NEW:frontend/src/components/daemon/__tests__/agent-replay-body.test.tsx | 组件测试（渲染分支/三态/折叠条/分页交互） |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | isToolReportBody 分支（:3474/:3520）换挂 AgentReplayBody；isToolReportBody 判定与激活路径零改动 |
| 修改 | frontend/src/components/daemon/agent-log-card.tsx | 删除 AgentLogSessionBody（退役）；AgentLogCard/AgentLogEntry/查看内容语义保留 |
| 修改 | frontend/src/components/daemon/__tests__/agent-log-card.test.tsx | 清理 AgentLogSessionBody 专属 describe 块（组件退役连带） |
| 修改 | frontend/src/components/daemon/session-panel/page-helpers.tsx | task-12 注释卫生（execute 补录，review 留痕）：mobile 外包层注释组件名 AgentLogSessionBody→AgentReplayBody 单词级同步，代码零改动 |
| 修改 | frontend/src/lib/agent-logs.ts | 引用生成后类型（新字段注释同步） |
| 新增 | NEW:docs/sillyspec/cursor-agent-transcript-report-pipeline.md | 跨仓跟进记录（sillyspec 仓扫描上报待办，本仓侧就绪声明） |

## 接口定义

```ts
// sillyhub-daemon/src/agent-log/parse-zcode-model-io.ts（契约扩展，三解析器共用）
interface NormalizedLogMessage {
  seq: number;
  kind: 'user_input' | 'reply' | 'thinking' | 'tool_use' | 'tool_result';
  text: string | null;
  tool_name: string | null;
  tool_use_id: string | null;
  tool_input: string | null;
  tool_result: string | null;
  is_error?: boolean;
  ts: string | null;
  // —— 本变更新增（全部可选，老数据/无数据源缺省）——
  sender?: 'human' | 'system_event';   // 仅 user_input 段有意义；缺省 'human'
  turn_id?: string | null;              // zcode 顶层 turnId / cursor turn_ended 轮号 / claude-code 会话内轮序
  model?: string | null;                // 如 "GLM-5.3"（zcode modelId）
  duration_ms?: number | null;          // 该次调用耗时（附着到其产出的段）
  usage?: {
    inputTokens: number; outputTokens: number; totalTokens: number;
    cacheReadTokens: number; cacheWriteTokens: number;
  } | null;
}

// registry.ts
interface AgentLogMessagesResult {
  status: 'parsed' | 'unsupported' | 'parse_error' | 'too_large';
  messages: NormalizedLogMessage[];
  truncated: boolean;
  totalSegments: number;
  skippedLines: number;
  totalUsage?: { inputTokens: number; outputTokens: number;
                 cacheReadTokens: number; cacheWriteTokens: number } | null; // 新增可选
}

// 前端适配器（frontend/src/lib/agent-log-turns.ts，纯函数）
export function buildReplayTurns(messages: AgentLogMessageItem[]): SessionTurnView[];
// 切轮：turn_id 变化或 sender='human' 的 user_input；system_event → 独立中性行段；
// thinking→processItems.thinking；tool_use+配对 tool_result→processItems.tool；
// reply→output；usage 轮级聚合 inputTokens/outputTokens、ctxTokens=末次 inputTokens。

// 组件（frontend/src/components/daemon/agent-replay-body.tsx）
export function AgentReplayBody({ sessionId, focusEntryId }: {
  sessionId: string;              // 会话 id（拉日志列表）
  focusEntryId?: string;          // 工作会话入口进入时直读该 entry
}): React.JSX.Element;
```

平台 schema（backend/app/modules/platform_sync/schema.py）内层消息 + 外层
`total_usage: TotalUsage | None`，字段名 snake_case 与上述一一对应（端点转换层
camel→snake 同现状）。

## 生命周期契约表

不涉及生命周期契约（本变更为只读回放链路：不改 session/lease/agent_run 状态机；
「首条消息懒激活」沿用既有机制零改动）。

## 数据模型

无表结构变更（platform_agent_logs / agent_sessions 零改动；messages 端点「读即弃
不落库」语义维持）。

## 兼容策略（brownfield 必填）

- **老 daemon**：新字段全部可选——老 daemon 不返回即缺省，前端显示「未知」/
  缺省行为；`422 HTTP_422_AGENT_LOG_UNSUPPORTED`（老 daemon 无 messages 方法）与
  `unsupported`/`parse_error`/`too_large` 回落语义逐字保留（不弹错框、原文回落）。
- **未升级前端 + 新 daemon**：daemon 新字段不影响既有「查看内容」小窗（字段被
  忽略），AgentLogCard 顶部栏行为不变。
- **激活路径**：turn_count>0 后 isToolReportBody 变 false 自然回正常对话流，
  AgentLogCard 顶部栏照旧——本变更零接触。
- **不改的 API**：content 端点（256KB 原文尾部）、states/上报链路、归属规则、
  所有表结构。
- 回退路径：AgentReplayBody 挂载分支单独一行（session-panel-page.tsx:3520），
  回退 = 换回 AgentLogSessionBody（git revert 单提交粒度）。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | zcode **db.sqlite 持久库**（主读取路径）message/part JSON 可能不含 usage → 该路径 token 恒未知 | P1 | execute 前 fixture 核对（真实库只读开库验证）；缺则 usage 置 undefined 前端显示未知，结论记 verify-facts；rollout 文件路径不受影响 |
| R-02 | cursor-agent transcript 的 tool_result 落盘形态未实证（样本仅见 text/tool_use） | P1 | execute 前用真实 transcript fixture 枚举 content 块类型全集；未落盘的工具结果按「结果未记录」中性徽章渲染（沿用既有中性徽章先例，不伪造） |
| R-03 | 大日志性能：13MB 文件每页 beforeSeq 重解析（实测 41ms 可接受）；超长轮 markdown 渲染 | P2 | 首屏只挂最新窗口；TurnTimeline 既有 3 万字符折叠复用；解析器 LINES_PER_BATCH 让出事件循环既有机制不变 |
| R-04 | 多条主日志排序与归属边界（同 ctx 多次本地会话） | P2 | 最新为主、更早折叠；排序键 first_seen_at（同秒用 id 稳定排序，对齐 2026-09-16-logs-cursor-tiebreaker 先例） |
| R-05 | daemon 部署滞后：新解析器/字段需用户升级本机 daemon | P2 | 字段可选 + unsupported/422 既有回落；界面上「daemon 未升级」黄条文案已存在（fallbackNoteForError 422 分支） |
| R-06 | claude-code 注入上下文识别不全（isMeta 覆盖 4/343，其余靠前缀白名单） | P2 | 前缀白名单（`【当前用户信息】`、`<command-name>`、`Caveat:` 等已知形态）；未识别漏网保守归 human（错标系统事件会隐藏真人输入，代价不对称） |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | FR-01 / Phase 3.1-3.2（TurnTimeline 真组件 + 适配器） | 已覆盖 |
| D-002@v1 | FR-01 / Phase 3.2-3.3（主/子分类 + 工作会话折叠条） | 已覆盖 |
| D-003@v1 | FR-02 / Phase 1.1 sender 契约 + Phase 1.3-1.4 各解析器归一规则 | 已覆盖 |
| D-004@v1 | FR-03 / Phase 1.1-1.2 + Phase 2 + Phase 3.1/3.5（四层打通 + totalUsage） | 已覆盖 |
| D-005@v1 | FR-01/FR-03 / Phase 1.2/1.4 + Phase 3.1（turnId/turn_ended/user 边界切轮） | 已覆盖 |
| D-006@v1 | FR-02 / Phase 1.3-1.5 + Phase 4（解析器矩阵 + 跨仓跟进） | 已覆盖 |
| D-007@v1 | FR-04 / 非目标（L3 不做、不可用态显式化） | 已覆盖 |
| D-008@v1 | 方案 A / 总体方案（适配复用） | 已覆盖 |

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本 D-001@v1 ~ D-008@v1
- [x] 生命周期关键词豁免短语已写（「不涉及生命周期契约」紧邻章节标题）
- [x] UI 原型已生成：prototype-tool-report-session-replay.html（视图级变化，必须生成档）
- [x] ⚠️ 自审存疑两项已入风险登记：R-01（sqlite 库 usage 未知）、R-02（cursor
      transcript tool_result 形态未实证）——均为 execute 前 fixture 核对点，不阻塞
      设计成立（字段可选，缺则「未知」）
