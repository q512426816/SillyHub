---
author: qinyi
created_at: 2026-06-28 12:23:18
change: 2026-06-28-daemon-subagent-transcript
module_impact: sillyhub-daemon/interactive, backend/daemon.run_sync, backend/agent.model, frontend/components-agent-log
---

# daemon 子代理日志可见性 · design

## 1. 背景

主 agent（Claude Agent SDK 0.3.181，`@anthropic-ai/claude-agent-sdk`）在执行中调用 Task/Agent tool 派生子代理（subagent）时，子代理的 thinking / text / tool 调用在 daemon→backend→前端 日志链路中**完全不可见**，用户无法知道子代理在做什么。

根因（四层全缺，已逐层核实）：

1. **SDK option 未开**：`sillyhub-daemon/src/interactive/claude-sdk-driver.ts:343` 的 `start()` 只设 `options.includePartialMessages = true`，未设 `forwardSubagentText`。SDK 类型定义 `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1544-1550` 明确：`forwardSubagentText` 默认 `false` 时，子代理**只有 tool_use/tool_result 块**进入主流（仅供心跳计数），子代理自己的 text/thinking **被丢弃**。
2. **daemon 链路零识别归属**：`session-manager.ts` / `daemon.ts` 全文无 `parent_tool_use_id` / `subagent_type` 读取逻辑（grep 零命中，仅 driver 给用户输入写死 `parent_tool_use_id:null`）。
3. **backend 平铺展开不读归属**：`run_sync/service.py:956 _extract_sdk_messages` 把 content block 平铺为 `[ASSISTANT]/[THINKING]/[TOOL_USE]/[TOOL_RESULT]` 行，不读 `parent_tool_use_id`。
4. **前端无层级概念**：`frontend/src` 零命中 `parent_tool_use_id`/`subagent`，`agent-log-viewer` 无嵌套/归属渲染。

已核实 SDK 消息契约（`sdk.d.ts:2647-2666` / `4127-4166`）：`SDKAssistantMessage` 与 `SDKUserMessage` **均含** `parent_tool_use_id: string|null` + `subagent_type?: string` + `task_description?: string`。即默认进来的心跳级 tool_use/tool_result 也天然带归属字段，仅 text/thinking 需 `forwardSubagentText=true` 才流出。

## 2. 设计目标

- **G1**：主 agent 调 Task/Agent tool 派生子代理时，子代理的 thinking / text / tool_use / tool_result 在 AgentRun 日志中可见，并标注归属（哪个子代理、第几层）。
- **G2**：子代理流式 partial（thinking/text delta）实时显示，按 `parent_tool_use_id` 隔离，不与主 agent partial 互相干扰、不白屏。
- **G3**：多层嵌套子代理（子代理再调子代理）数据上完整支持，展示带层级深度标记。
- **G4**：持久化——归属信息落库，刷新页面 / 历史回看 / 断线重连后归属不丢。
- **G5**：向后兼容——历史日志（无归属）渲染为主 agent，行为不变。

## 3. 非目标

- **N1**：不改计费链路——子代理 token usage 照常聚合到 `AgentRun` 总量，不按子代理拆分计费（D-008）。
- **N2**：不做嵌套折叠 UI（树状 transcript）——本期只做"平铺带标签 + 深度缩进"；数据落库预留，未来升级只改前端（D-005）。
- **N3**：不做 Codex provider——`forwardSubagentText` 是 Claude SDK 特性，Codex 子代理机制不同，本期不碰（D-006）。
- **N4**：不新增生命周期事件、不改 lease/session/agent_run 状态机——只在 `submit message` 载荷里增加归属字段。
- **N5**：不做"按子代理聚合查询"的前端入口（虽然列式承载支持，但本期无 UI 需求）。
- **N6**：不做 batch 路径（task-runner spawn + stream-json）的子代理归属——batch daemon-client 走 `task-runner.ts` spawn Claude CLI（非 SDK query，零命中 parent_tool_use_id/forwardSubagentText），子代理转发需 spawn flag + `_eventToMessages` 独立改造，与 interactive（SDK driver）是不同路径。本期聚焦 interactive session（用户前端开 agent session 看日志的诉求），batch 留待后续（Design Grill X-003）。

## 4. 拆分判断

单一功能"子代理日志可见性"的端到端链路改造，跨 4 层（SDK option / daemon 转发 / backend 落库 / 前端渲染）紧耦合——4 层必须一起改才端到端 work，非 3+ 独立可交付模块；无重复模式。**不拆分，不批量**，作为一个变更走完整流程（见 brainstorm step 5）。

## 5. 总体方案

按数据流方向分 5 个 Phase，下层不阻塞上层契约定义，但端到端验证依赖全部完成。

### Phase 1 — daemon driver：开启子代理流出
`claude-sdk-driver.ts:307 start()` 在 options 构造段（`includePartialMessages` 旁）加 `options.forwardSubagentText = true`。`consume`/`interrupt` 不改——子代理消息（带 `parent_tool_use_id`）走现有 for-await 透传。

### Phase 2 — daemon session-manager：partial 隔离 + depth 维护 + init 守卫
改动最重的一层，解决 D-002 / D-003 / D-007：

- **partial buffer 分桶**：`_partialBuffers` 从 `Map<sessionId, PartialFlushBuffer>` 改为 `Map<sessionId, Map<parentKey, PartialFlushBuffer>>`，`parentKey = msg.parent_tool_use_id ?? 'main'`。`_clearPartialBufferSync` / `_emitOverrideSignals` / `_flushPartial` / `_bufferPartial` 全部按 parentKey 分桶——子代理 assistant 完整消息只清自己的桶，不误清主 agent（D-002）。`_resolveSegmentId` 的 segmentId 带 parent 前缀：`${parentKey}:${messageId}:${blockIndex}`，避免主/子 segment 撞 id。
- **depth 维护**（D-007）：`SessionState` 加 `subagentDepth: Map<string, number>`（key = tool_use block id）。`_onMessage` 处理 assistant message 时，遍历其 `tool_use` content blocks，预登记 `subagentDepth[tool_use.id] = msgDepth + 1`（`msgDepth` = 本消息按其自身 `parent_tool_use_id` 查 `subagentDepth` 得，主 agent parent=null → depth 0）。子代理/孙代理消息到达时按其 `parent_tool_use_id` 查 `subagentDepth` 得 depth，注入 `msg.depth` 顶层字段后转发。
- **agentSessionId 防御守卫**（D-003）：`_onMessage:1686` 写 `agentSessionId` 加双重守卫——`msg.parent_tool_use_id` 非空（子代理 init）直接跳过。现有 `===undefined` 守卫已足够（主 session init 必先于子代理到达），此为防御性加固。
- **转发**：`_onMessage` 转发 msg 前注入 `depth`（从 `subagentDepth` 查得）；`parent_tool_use_id`/`subagent_type`/`task_description` 已在 msg 顶层，原样透传。`daemon.ts onTurnMessage` **不改**（depth 已在 session-manager 注入）。

### Phase 3 — backend：归属列 + 透传 + 落库
- **migration**：`agent_run_logs` 表加 `parent_tool_use_id VARCHAR(200) NULL` / `subagent_type VARCHAR(100) NULL` / `depth INTEGER NULL`，加索引 `ix_agent_run_logs_parent` on `parent_tool_use_id`（方案 B 的核心优势：可按子代理聚合查询）。revision id 唯一、`down_revision` 接 execute 时**当时真实 head**（不写死，3 活跃变更并行，见 R-01）。
- **ORM + schema**：`AgentRunLog`（`agent/model.py:285`）加三列 Field；`AgentRunLogEntry`（`agent/schema.py:128`）及对应 Read DTO 加三字段（nullable，默认 None）。
- **`_extract_sdk_messages`**（`run_sync/service.py:956`）：从 msg 顶层读 `parent_tool_use_id`/`subagent_type`/`depth`，注入到产出的**每条** flat record——归属是 message 级属性，同一 SDK message 的所有 content block（text/thinking/tool_use 等）同属一个子代理，**每条** log 行都要带归属（否则同一子代理 message 展开的多行 log 归属不一致，thinking 行有归属而紧随的 text 行 NULL）。**与 `usage`/`session_id` 区分**：后者是 message 级聚合量，仍走 `stamp()` 仅注入首条避免重复累加；归属字段不经过 `stamp()`，直接写入每条 record（Design Grill X-001 修正，D-008）。
- **落库循环**（`run_sync/service.py:278+`）：从 flat record 读三字段，写入 `AgentRunLog(...)` 构造。

### Phase 4 — 前端：平铺带标签 + 深度
`agent-log-viewer.tsx` + `agent-log/*.tsx`（`components-agent-log` 模块）+ `logsToTurns`（`lib-agent-stream`）读三字段：
- `subagent_type` 非空 → 行首渲染 `[子代理:<subagent_type>]` 徽标（中文，CLAUDE.md 规则 11）；
- `depth > 0` → 左侧按 depth 缩进（`padding-left`）+ 深度标记；
- 同 `parent_tool_use_id` 连续行视觉归组（为未来嵌套折叠预留，本期不实现折叠）；
- 主 agent 行（`parent_tool_use_id=null` / `depth=0`）渲染不变。

### Phase 5 — verify
- daemon 单测：`forwardSubagentText` 开启；partial 按 parent 分桶（主/子并发不互清）；`agentSessionId` 不被子代理 init 覆盖；depth 维护正确（主 0 / 子 1 / 孙 2）。
- backend 单测：`_extract_sdk_messages` 透传三字段；落库三列；migration up + down 可逆。
- 前端：徽标 + 深度渲染（基于 mock 日志数据快照）。
- 集成：真实 Claude 调 Task tool 派生子代理（含嵌套），端到端日志可见归属 + partial 实时刷 + 刷新后归属不丢。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/interactive/claude-sdk-driver.ts` | `start()` options 加 `forwardSubagentText: true`（约 :343） |
| 修改 | `sillyhub-daemon/src/interactive/session-manager.ts` | `_partialBuffers` 改二级 Map；`_onMessage`/`_bufferPartial`/`_clearPartialBufferSync`/`_emitOverrideSignals`/`_flushPartial`/`_resolveSegmentId` 按 parentKey 分桶；`SessionState` 加 `subagentDepth`；depth 注入转发；init 防御守卫 |
| 修改 | `backend/app/modules/agent/model.py` | `AgentRunLog`（:285）加 `parent_tool_use_id`/`subagent_type`/`depth` 三列 + `ix_agent_run_logs_parent` 索引 |
| 修改 | `backend/app/modules/agent/schema.py` | `AgentRunLogEntry`（:128）+ Read DTO 加三字段 |
| 新增 | `backend/migrations/versions/2026XXXX_subagent_log_columns.py` | alembic：agent_run_logs 加三列 + 索引；down 接真实 head |
| 修改 | `backend/app/modules/daemon/run_sync/service.py` | `_extract_sdk_messages`（:956）flat record 透传三字段；`submit_messages` 落库循环（:278+）写三列 |
| 修改 | `frontend/src/components/agent-log-viewer.tsx` | 行渲染读三字段：徽标 + 深度缩进 |
| 修改 | `frontend/src/components/agent-log/*.tsx` + `frontend/src/lib`（logsToTurns / agent-stream 类型） | 日志行类型加三字段并透传到渲染层 |

> 精确行号在 plan 阶段定位；`daemon.ts onTurnMessage` **不改**（depth 在 session-manager 注入）。

## 7. 接口定义

### 7.1 daemon `SessionState` 新增字段（`session-manager.ts`）
```ts
/** D-007：子代理深度追踪。key = tool_use block id（即子代理消息的 parent_tool_use_id），
 *  value = 该子代理的 depth（主 agent = 0，子 = 父+1）。turn 边界不清（跨 turn 复用）。 */
subagentDepth: Map<string, number>;
```

### 7.2 daemon 转发 msg 顶层新增字段
session-manager `_onMessage` 转发前给 SDK msg 注入：
```ts
(msg as Record<string, unknown>)['depth'] = computedDepth; // number，主 agent = 0
// parent_tool_use_id / subagent_type / task_description 已由 SDK 提供，不动
```

### 7.3 backend `_extract_sdk_messages` flat record 新增字段
flat record（`{event_type, content, channel, ...}`）由 `stamp()` 注入到首条：
```python
{
  "event_type": "text" | "tool_use" | ...,
  "content": "[ASSISTANT] ...",
  "channel": "stdout" | "tool_call",
  "parent_tool_use_id": str | None,   # 来自 msg["parent_tool_use_id"]
  "subagent_type": str | None,         # 来自 msg["subagent_type"]
  "depth": int | None,                 # 来自 msg["depth"]
}
```

### 7.4 `AgentRunLog` model 新增列（`agent/model.py:285`）
```python
parent_tool_use_id: str | None = Field(
    default=None, sa_column=Column(String(200), nullable=True))
subagent_type: str | None = Field(
    default=None, sa_column=Column(String(100), nullable=True))
depth: int | None = Field(
    default=None, sa_column=Column(Integer, nullable=True))
# __table_args__ 加：Index("ix_agent_run_logs_parent", "parent_tool_use_id")
```

### 7.5 depth 计算算法（daemon session-manager）
```
# 主 agent：parent_tool_use_id = null → depth = 0
# 收到 assistant message M：
#   M_depth = M.parent_tool_use_id ? subagentDepth[M.parent_tool_use_id] : 0
#   （M.parent_tool_use_id 不在 map → 退化 1，理论上父 tool_use 先到已预登记）
#   for each tool_use block T in M.message.content:
#       subagentDepth[T.id] = M_depth + 1   # 预登记，等子代理消息查
#   注入 M.depth = M_depth，转发
```

## 7.5 节 · 生命周期契约表（本变更涉及 session/agent_run/daemon 关键词）

本变更**不新增生命周期事件、不改状态机**，仅在 `submit message` 事件载荷中增加归属字段。下表标注本变更对现有事件载荷的增强（标 ★ 为本变更新增字段）：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 | 本变更影响 |
|---|---|---|---|---|---|
| claim lease | daemon | backend | leaseId, claimToken, agentRunId | pending → running | 无 |
| create session | backend | daemon | sessionId, leaseId, claimToken | session active | 无 |
| submit message | daemon | backend | leaseId, claimToken, agentRunId | append agent_run_logs | **载荷 +★ parent_tool_use_id / ★ subagent_type / ★ depth**（session-manager 注入，_extract_sdk_messages 透传，落库三列） |
| turn result | daemon | backend | runId, status, output | running → completed/failed | 无 |
| session end | daemon | backend | sessionId, reason | active → ended | 无 |

- 表中 `submit message` 的 ★ 字段 → 出现在 §7.3 flat record / §7.4 model / §7.2 daemon 注入——契约自洽。
- 不新增事件、不改状态机 → 无遗漏事件风险。

## 8. 数据模型

`agent_run_logs` 表（`agent/model.py:285`，现有字段：`id/run_id/timestamp/channel/content_redacted/dedup_key`，**无 metadata 列**）新增三列：

| 列 | 类型 | nullable | 说明 |
|---|---|---|---|
| `parent_tool_use_id` | VARCHAR(200) | YES | 子代理消息指向的父 tool_use id；主 agent = NULL |
| `subagent_type` | VARCHAR(100) | YES | 子代理类型（如 `general-purpose`/`Explore`）；主 agent = NULL |
| `depth` | INTEGER | YES | 层级深度，主 agent = 0/NULL，子 = 父+1 |

索引：`ix_agent_run_logs_parent` on `parent_tool_use_id`（方案 B 核心优势，支持按子代理聚合查询）。

> **注意**：`agent_run_logs` **无 metadata 列**（`run_sync/service.py:273` 注释明示），故归属信息以独立列承载（方案 B），而非 JSON 注入——这也是用户选 B 而非 A 的现实依据（A 需先加 metadata JSON 列，代价不比 B 低）。

## 9. 兼容策略（brownfield）

- **未升级 daemon 的旧路径**：旧 daemon 不注入 `depth`、SDK 未开 `forwardSubagentText` → backend 收到的 msg 无归属字段 → `_extract_sdk_messages` 透传 None → 落库三列 NULL → 前端视为主 agent 行（`parent_tool_use_id=null`/`depth=null`→按 0 处理），渲染与现状一致。
- **历史日志**：已有 `agent_run_logs` 行三列 NULL → 前端按主 agent 渲染，行为不变。
- **回退路径**：migration 提供 down（drop 三列 + 索引）；daemon `forwardSubagentText` 可独立回退（关掉即子代理 text/thinking 不再流出，回到心跳级）。
- **不改变的 API/表**：`AgentRun` 表结构、计费链路（usage 聚合不变）、lease/session 状态机、主 agent 日志渲染。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | migration 链断裂：3 个活跃变更（本变更 + daemon-client-spec-sync-strategy + team-mainline-integration）若同时加 migration，撞 revision id 或 down_revision 分叉多 head，backend `alembic upgrade head` crash-loop（本项目多次踩坑，见 [[migration-chain-fragmentation-pattern]]） | **P0** | (1) revision id 唯一；(2) `down_revision` 接 execute 当时真实 head，**不写死**；(3) execute 前 `grep -hE "^revision\|^down_revision" backend/migrations/versions/*.py` 核对单一 head；(4) verify 在 PG（非 SQLite）跑 migration up/down，因 SQLite 测不出链断裂 |
| R-02 | partial buffer 改二级 Map 引入回归：现有 partial 节流 / thinking override / segmentId 去重逻辑复杂（task-11/ql-partial），分桶改造易破坏主 agent 单代理场景 | **P0** | (1) 主 agent 走 `parentKey='main'` 桶，行为与现状逐字节等价；(2) 补 partial 回归测试（主 agent 单 turn 不受影响）；(3) segmentId 带 parent 前缀，确保去重逻辑不跨桶误判 |
| R-03 | `forwardSubagentText=true` 增大消息量：子代理完整对话流出，daemon→backend submitMessages 频率 + agent_run_logs 落库量上升 | P1 | partial 已 500ms 节流；子代理 tool_use/tool_result 本就在流（心跳级）；监控 submit_messages QPS 与表增长，必要时调大节流窗口 |
| R-04 | depth 退化：父 tool_use 未先到（时序异常）致 `subagentDepth` 查不到，depth 退化为错误值 | P1 | 退化策略：查不到 → depth=1（假设父是主 agent，最常见）；记录 warn 日志便于诊断；主 agent tool_use 必先于子代理消息（SDK 时序保证），实际不会退化 |
| R-05 | 前端渲染：多层嵌套 + 并发子代理行交错，平铺展示层级不清晰 | P2 | depth 缩进 + 徽标 + 同 parent 视觉归组；原型已验证可读性（`prototype-daemon-subagent-transcript.html`）；未来升级嵌套折叠彻底解决 |
| R-06 | `forwardSubagentText` 实际流出形态未端到端实测：design 假设开 `forwardSubagentText=true` 后子代理 text/thinking 以带 `parent_tool_use_id` 的 assistant message 经主流 query generator 流入 daemon consume，字段名/消息类型仅依据 SDK 类型定义（`sdk.d.ts:1544-1550, 2647-2666`），未实测。若 SDK 实际行为不符（走 partial 通道 / 字段名不同 / 不经主流 generator），daemon 层归属识别失效 | P1 | verify Phase 5 集成测试必须用真实 Claude 调 Task tool 派生子代理，断言 daemon consume 收到带 `parent_tool_use_id` 的子代理 assistant message 且字段名与 SDK 类型一致；不符则 design §5 Phase 2 按实测调整（Design Grill X-002） |
| R-07 | partial 分桶后子代理 usage 累计：子代理 partial 的 `pendingUsage`/`sessionUsage` 若混入主 agent 桶会污染主 agent token 实时显示 | P2 | 子代理桶独立维护 `pendingUsage`/`sessionUsage`；最终经 daemon onTurnMessage usage lift 聚合到 AgentRun 总量（D-008 聚合不拆），主 agent 桶的 sessionUsage 不含子代理 |

## 11. 决策追踪

当前版本决策（详见 `decisions.md`）：

| 决策 ID | 标题 | 来源 | 覆盖章节 |
|---|---|---|---|
| D-001@v1 | 子代理消息归属字段来源（assistant+user 均带 parent_tool_use_id/subagent_type/task_description） | code | §1 / §7.3 / Phase 3 |
| D-002@v1 | partial buffer 按 parent_tool_use_id 分桶隔离 | code | §5 Phase 2 / §10 R-02 |
| D-003@v1 | agentSessionId 不被子代理 init 覆盖（现有 ===undefined 守卫 + 防御性 parent 守卫） | code | §5 Phase 2 |
| D-004@v1 | 归属承载 = AgentRunLog 新增列（方案 B，非 metadata 注入） | user | §6 / §8 |
| D-005@v1 | 展示形态分阶段：本期平铺带标签，数据预留嵌套升级 | user | §5 Phase 4 / N2 |
| D-006@v1 | provider 范围只 Claude（forwardSubagentText 是 Claude SDK 特性） | user | N3 |
| D-007@v1 | depth 由 daemon session 级 Map 维护，随 message 透传，backend 只落库不算 | design | §5 Phase 2 / §7.1 / §7.5 |
| D-008@v1 | 归属字段注入每条 flat record（非首条 stamp）——同一子代理 message 多 block 同属一代理，每行都要带归属；usage/session_id 仍首条 | design-grill | §5 Phase 3 / §7.3（X-001 修正） |

无未解决决策。剩余风险见 §10（含 Design Grill 新增 R-06/R-07）。

## 12. 自审

| 检查项 | 结果 | 依据 |
|---|---|---|
| 需求覆盖（G1-G5） | ✅ | G1→Phase1-4；G2→Phase2 partial；G3→depth 算法；G4→落库三列；G5→兼容策略 §9 |
| Grill 决策覆盖（D-001~D-007） | ✅ | §11 表逐条映射到章节 |
| 约束一致性 | ✅ | 中文 UI（规则 11）/ 跨平台（规则 12，无平台相关代码）/ 日志与 batch 字节兼容原则（_extract_sdk_messages 复用） |
| 真实性（表名/字段/类名） | ✅ | `agent_run_logs`（model.py:288 实测复数）/ `AgentRunLog`（:285）/ `AgentRunLogEntry`（schema.py:128）/ `_extract_sdk_messages`（run_sync/service.py:956）/ `PartialFlushBuffer`（session-manager.ts:159）/ `forwardSubagentText`（sdk.d.ts:1550）均来自真实代码 |
| YAGNI | ✅ | 嵌套折叠/聚合查询入口/Codex 全部列为非目标（N2/N5/N3） |
| 验收标准可测 | ✅ | Phase 5 五项，每项可单测/集成测 |
| 非目标清晰 | ✅ | §3 N1-N5 |
| 兼容策略（brownfield） | ✅ | §9 三条回退路径 |
| 风险识别 | ✅ | §10 R-01~R-05，含 2 个 P0 |
| 生命周期契约表 | ✅ | §7.5，标注本变更仅增强 submit message 载荷，不新增事件/不改状态机 |

**自审结论：通过**。两个 P0 风险（R-01 migration 链、R-02 partial 回归）在 plan 阶段必须有专项 task + 测试覆盖。

### Design Grill 结果（step 12 交叉审查）

status: **passed**（4 个交叉点全部修正，无未决 blocker）

| ID | 层级 | 交叉点 | 证据 A | 证据 B | 结论 | 决策 |
|---|---|---|---|---|---|---|
| X-001 | consistency | `_extract_sdk_messages` 归属注入（首条 stamp）vs 同一 message 多 block 同属一代理 | design §5 Phase 3 原"首条" | §7.3 flat record 每行落库 | **conflict**：只注首条 → 同子代理 message 的 thinking 行有归属、text 行 NULL | D-008@v1（改为每条注入） |
| X-002 | feasibility | forwardSubagentText 流出形态（字段名/类型/主流 generator）仅凭 SDK 类型，未实测 | design §5 Phase 1 假设 | `sdk.d.ts:1544-1550` 文档 | **假设待验** | R-06（verify 实测） |
| X-003 | boundary | design 只覆盖 interactive，batch（task-runner spawn）是否同期改 | design §5 仅 SDK driver | `task-runner.ts` spawn + 零命中 parent_tool_use_id | **scope 澄清**：batch 独立路径，本期不做 | N6（非目标） |
| X-004 | consistency | partial 分桶下子代理 usage/sessionUsage 累计污染主 agent | design §5 Phase 2 分桶 | §2 G2 + D-008 聚合 | **补充约束** | R-07（桶独立 usage） |

Question Distribution: immediately_answered=4（全部由代码/文档确定，无需用户判断）, needs_thinking=0, unresolved=0。

