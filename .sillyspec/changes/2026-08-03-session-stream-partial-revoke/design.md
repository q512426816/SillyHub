---
author: WhaleFall
created_at: 2026-08-03T10:06:49
scale: large
---

# 设计文档（Design）— daemon 会话实时流式回复「半截重复」修复

> 变更 `2026-08-03-session-stream-partial-revoke` · 方案 A（后端透传 segmentId + override 撤回令箭，前端按编号撤回）

## 1. 背景

daemon 会话（`/runtimes` 会话面板）实时流式回复出现段落重复/错乱；但**重新打开会话（历史回显）显示正常**。实测会话 `35334e5b`、`504c2d38`。

### 1.1 根因（explore 调研 + 链路查证，证据闭合）

agent 回复时 daemon 边生成边发流式消息，三类相关消息经 backend 转发到前端 SSE：

| 消息类型 | daemon emit | backend 落库 | backend SSE 转发 | 前端实时表现 |
|---|---|---|---|---|
| **partial（半截增量）** | `_flushPartial`（session-manager.ts:2702）`content=[ASSISTANT]/[THINKING] <增量片段>`, `metadata={segmentId, isPartial:true}` | 落库，`segment_id` 写值（task-14） | ✅ publish | concat 拼成「半截」显示 |
| **complete（全文）** | 完整 message 到达，backend 展开为 `[ASSISTANT] <全文>` | 落库，`segment_id=NULL`（task-14） | ✅ publish | append 全文 → **与半截叠加 = 重复** |
| **override（撤回信号）** | `_emitOverrideSignals`（:2910）`content=[ASSISTANT_OVERRIDE]/[THINKING_OVERRIDE] <segmentId>`, `metadata={segmentId, stale:true}` | ❌ `continue` 截断，**不落库**（task-14） | ❌ `continue` 截断，**不 publish**（service.py:434/464） | 收不到 → **无法撤回已渲染半截** |

**关键 gap**：task-14（`2026-07-31-daemon-heartbeat-dedup-fix`）只做了**落库去重**——override 信号触发 DELETE 同 `segmentId` 的 partial 落库行 → 历史回显（GET `/sessions/{id}/logs`）数据干净、显示正常。但 **SSE 转发层把 override 信号本身截断了**（service.py:434/464 的 `continue`），且 `published_logs`（:595）/`session_payload`（:164）**不写 `segment_id` 字段**，前端既收不到「该撤回了」的信号、也无法识别「哪条是半截」。task-14 design 注释:372 写「跨调用去重交给前端 normalize 覆盖」，但实现把前端做精确撤回所需的两个字段都在 SSE 层抹掉了——前端这半从没做过。

### 1.2 佐证：实时 vs 回显的数据通道差异

| | 实时流 | 重新打开回显 |
|---|---|---|
| 通道 | session SSE `GET /api/daemon/sessions/{id}/stream`（`streamSession`） | GET `/api/daemon/sessions/{id}/logs`（`getAgentSessionLogs`） |
| 数据 | daemon 实时 publish 的**全部**消息（含 partial + complete；override 被截断收不到） | 落库后的 `AgentRunLog` 行（partial 已被 override DELETE，只剩 complete 全文） |
| 结果 | 半截 + 全文叠加 → 重复 | 干净全文 → 正常 |

## 2. 设计目标

- **实时回复不重复**：partial 半截被后续 override 精确撤回，最终只显示 complete 全文（assistant + thinking 两种都修）。
- **回显保持正常**：不破坏 task-14 已生效的落库去重（override 仍不落库、partial 仍被 DELETE）。
- **前端按 segmentId 精确撤回**：用 daemon 已 emit 的权威 segmentId，不靠文本启发式猜测。
- **最小改动**：backend 只加一个 `segment_id` 透传字段 + override 改 publish；复用 task-14 已建的 `segment_id` 列与 segmentId 格式，不改 schema。

## 3. 非目标

- ❌ 不改 daemon（`session-manager.ts` 的 partial/complete/override emit 逻辑已正确，task-14 已修）。
- ❌ 不改 backend 落库去重机制（task-14 的 `_revoke_committed_partials` 跨调用 DELETE 保留原样；override 仍不落库）。
- ❌ 不改 `AgentRunLog` schema（`segment_id` 列 task-14 已建，本次只把它透传到 SSE）。
- ❌ 不改 lease/session/agent_run 状态机、不改 heartbeat、不改 WS 通道。
- ❌ 不改 agent 行为/提示词。
- ❌ 不改 `logsToTurns` 历史回看的渲染结果（数据本就干净，仅类型向下兼容）。

## 4. 拆分判断

单一变更，不拆分、不走批量。理由：前后端协同修复**同一个 bug**（实时半截重复），改动集中在「override 信号从 backend 到 frontend 的透传 + 撤回」一条链路，应一起端到端修完 + 一起验证（实时复现重复 → 修后只剩全文）。

## 5. 总体方案（方案 A：透传 segmentId + override 撤回令箭）

### Phase 1 — backend（`run_sync/service.py`）

**1.1 SSE envelope 加 `segment_id` 字段**
- `published_logs`（service.py:595-613）构造 dict 时加 `"segment_id": log_entry.segment_id`（**必须用 `log_entry.segment_id`：complete 行为 None**；切勿用循环顶部局部变量 `segment_id`——它取自 `metadata.segmentId`，complete 行也非 None，会让前端误判 complete 全文为半截触发错误撤回）。
- `session_payload`（`publish_submitted_messages` :164-180）同步加 `"segment_id": log_payload.get("segment_id")`。
- 语义：partial 行 `segment_id` 非空（`main:msg_xxx:N`），complete/其他行 `None`。前端用「`segment_id` 非空」识别半截，无需额外 `is_partial` 布尔字段。

**1.2 override 分支不再截断，改为 publish 到 SSE（仍不落库）**
- thinking override 分支（:413-434）：保留 `_revoke_committed_partials` DELETE + `flushed_partials.pop`（task-14 逻辑不动），把结尾的 `continue` 改为：构造 override envelope（`content=[THINKING_OVERRIDE] <segmentId>` 原样、`segment_id=<segmentId>`、`channel=stdout`）直接 publish 到 session channel，**跳过 INSERT**（不落库，保留 task-14 override 不污染历史的设计）。
- assistant override 分支（:445-464）：同上，`content=[ASSISTANT_OVERRIDE] <segmentId>`。
- 实现要点（Design Grill X-02 澄清）：INSERT 与 publish 早已解耦——`submit_messages` 返回纯标量 `PublishIntent`（service.py:710-726），真正 publish 由 `router.py:1033` 在 DB commit 后调 `publish_submitted_messages` 执行。故 override envelope **直接 append 到 `published_logs`（跳过 INSERT / `log_entry` 构造）**即可复用现成两路 publish（agent_run channel + session channel），无需抽 helper。override envelope：`segment_id`=被撤回的 segmentId、`stale=True`、`content` 保留 `[ASSISTANT_OVERRIDE]/[THINKING_OVERRIDE] <segmentId>` 文本。

### Phase 2 — frontend

**2.1 类型扩展**（`frontend/src/lib/daemon.ts:711` `SessionStreamEnvelope`）
- 加 `segment_id: string | null`、`stale: boolean`（默认 false，override 行 true）。

**2.2 分类识别 override**（`frontend/src/components/daemon/session-log-sanitize.ts:60` `classifySessionLog`）
- `SessionLogSegmentKind` 加 `"override"`；`SessionLogSegment` 加 `segmentId?: string`、`variant?: "assistant" | "thinking"`。
- 在丢弃规则之后、`[THINKING]` 分支之前，加 override 分支：
  - 匹配 `^\[(ASSISTANT_OVERRIDE|THINKING_OVERRIDE)\]\s+(\S+)` → 返回 `{kind:"override", segmentId: <捕获>, variant: "assistant"|"thinking", text:""}`。
- sanitize 函数 `sanitizeSessionLogContent` 同步识别 override 前缀并丢弃（返回 `""`），避免 attach 历史路径万一收到 override 文本时泄漏。

**2.3 onLog 撤回逻辑**（`frontend/src/components/daemon/interactive-session-panel.tsx`，onLog 回调约 :302-373）
- 每个 turn 维护 `partialSegments: Map<segmentId, {outputStart: number}>`（reply）/`Map<segmentId, {itemIndex: number}>`（thinking，记 processItems 索引）。
- 收到 `seg.kind==="reply"` 且 `env.segment_id` 非空（半截）：记录 `outputStart = turn.output.length`，再 concat（ql-004 语义不变）。
- 收到 `seg.kind==="thinking"` 且 `env.segment_id` 非空：记录 processItems 索引，再追加。
- 收到 `seg.kind==="override"`：按 `seg.segmentId` 查 Map：
  - reply → `turn.output = turn.output.slice(0, outputStart)`（截断到半截起点之前，撤回半截）。
  - thinking → 从 processItems 移除该索引的 thinking 项。
  - 撤回后从 Map 删该 segmentId。
- complete（`segment_id` 为空）正常 concat/追加，override 紧随其后异步到达即撤回半截。
- 多 segment 并发（主 agent + 子代理，segmentId 前缀 `main:` vs `<tool_use_id>:`）按 segmentId 天然区分，互不串扰。
- turn 边界（`onTurnCompleted`/`clearCurrentRun`）清空 `partialSegments` Map，防跨 turn 泄漏。

**2.4 历史回看**（`runtime-session-helpers.tsx` `logsToTurns`）
- 数据本就干净（override 不落库、partial 已 DELETE），**不加撤回逻辑**。
- 历史路径不依赖 segment_id：`AgentRunLogEntry` DTO（schema.py:161）本轮**不加** segment_id 字段（守住 §3 不改 schema 非目标）；`logsToTurns` 处理不变。前端 envelope 新字段仅在实时 SSE 通道出现，历史 GET 不返回该字段。

### Phase 3 — 测试

- **backend**：override publish 到 SSE 且**不落库**（断言 `agent_run_logs` 无 override 行）；override 仍触发 partial DELETE（task-14 不回归）；`session_payload`/`published_logs` 含 `segment_id`（partial 非空、complete 空）。
- **frontend**：`classifySessionLog` override 识别（assistant/thinking 两种 + segmentId 解析）；onLog 半截 append → override 撤回 → 只剩 complete 全文；多 segment 不串扰；`logsToTurns` 历史兼容。
- **实跑**：真实会话复现实时重复场景（如 Write 被拦截分段输出），确认修后实时只剩全文。

### 5.1 UX 说明

complete（全文）到达后到 override 到达前，存在**毫秒级**「半截 + 全文」中间态；override 在同一 message 处理周期内紧随 complete 异步 emit，肉眼基本无感。若实测闪烁明显，留作 R-03 优化（complete 携带 segmentId 即时替换，但需改 task-14 落库语义，本轮不做）。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/daemon/run_sync/service.py` | `published_logs`(:595)+`session_payload`(:164) 加 `segment_id`；override 分支(:434/:464)`continue`→publish-only 到 SSE（不落库） |
| 修改 | `frontend/src/lib/daemon.ts` | `SessionStreamEnvelope`(:711) 加 `segment_id` + `stale` |
| 修改 | `frontend/src/components/daemon/session-log-sanitize.ts` | `classifySessionLog` 加 override kind + segmentId/variant；`sanitizeSessionLogContent` 丢弃 override 前缀 |
| 修改 | `frontend/src/components/daemon/interactive-session-panel.tsx` | onLog 维护 `partialSegments` Map，override 时按 segmentId 截断 output/移除 thinking |
| 修改 | `frontend/src/components/daemon/runtime-session-helpers.tsx` | logsToTurns 类型兼容（envelope 新字段，渲染不变） |
| 修改 | `backend/app/modules/daemon/tests/test_run_sync_assistant_override.py` | 加 override publish 到 SSE + 不落库 + segment_id 透传断言 |
| 修改 | `frontend/src/components/daemon/__tests__/session-log-sanitize.test.ts` | 加 override 识别用例 |
| 修改 | `frontend/src/components/daemon/__tests__/interactive-session-panel.test.tsx` | 加 onLog 撤回用例（半截→override→全文） |

## 7. 接口定义

### 7.1 backend SSE session envelope（追加字段，向下兼容）
```python
# service.py session_payload / published_logs 追加：
{
  "log_id": ..., "channel": ..., "content": ..., "timestamp": ...,
  "parent_tool_use_id": ..., "subagent_type": ..., "depth": ..., "tool_kind": ...,
  "segment_id": segment_id,   # 新增：partial 行="main:msg_xxx:N"；complete/其他=None
}
# override 行（publish-only，不落库）：
{
  "event": "log", "log_id": None, "channel": "stdout",
  "content": "[ASSISTANT_OVERRIDE] main:msg_xxx:N",   # 或 [THINKING_OVERRIDE]
  "segment_id": "main:msg_xxx:N", "stale": True,      # 新增：stale=True 标识撤回令箭
  ...timestamp 等
}
```

### 7.2 frontend `SessionStreamEnvelope`（追加字段）
```ts
export interface SessionStreamEnvelope {
  // ... 现有字段
  segment_id: string | null;  // 新增：非空=partial 半截；null=complete/其他
  stale: boolean;             // 新增：true=override 撤回令箭
}
```

### 7.3 `SessionLogSegment`（扩 kind + 字段）
```ts
export type SessionLogSegmentKind =
  | "reply" | "thinking" | "tool_use" | "tool_result" | "stderr"
  | "override";                                  // 新增
export interface SessionLogSegment {
  kind: SessionLogSegmentKind;
  text: string;
  segmentId?: string;                            // 新增（override/partial 用）
  variant?: "assistant" | "thinking";            // 新增（override 用）
}
```

### 7.4 onLog 撤回契约
```ts
// 每 turn 维护（InteractiveTurn 内或 ref）：
partialSegments: Map<string, { outputStart: number } | { itemIndex: number }>;
// override 到达 → 按 segmentId 截断 output（reply）/移除 processItems 项（thinking）
```

## 7.5 生命周期契约表

不涉及生命周期契约。本次仅改 session SSE 消息**透传字段**与 override 信号 **publish 路径**，不改 session/lease/agent_run/daemon 的状态机、状态流转、claim/heartbeat/lifecycle 事件（详见 §3 非目标）。`session`/`daemon`/`agent_run` 字样仅指消息流经的模块，非生命周期状态变更。

## 8. 数据模型

**不改 schema**。复用 task-14 已建的 `AgentRunLog.segment_id` 列（String 200, nullable, indexed，migration `202608310900`）。本次仅把该列的值（落库时已写）透传到 SSE envelope，无新增列、无 migration。

## 9. 兼容策略

- **未升级前端时**：backend 发出的 `segment_id`/`stale` 字段被旧前端忽略（TS 类型未更新但运行时多字段无害），旧前端仍重复显示（行为同现状，不 worse）。
- **未升级 backend 时**：新前端 `segment_id`/`stale` 字段为 undefined，撤回逻辑不触发（`env.segment_id` 为空 → 不记 Map → 无 override → 不撤回），行为同现状。
- **历史回看**：`logsToTurns` 数据本就干净，envelope 新字段兼容，渲染不变。
- **回退路径**：若 override publish 引入问题，回退 backend 1.2（override 分支改回 `continue`）即恢复 task-14 行为（实时重复回来，但回显正常），前端撤回逻辑空转无副作用。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | override publish-only 路径实现不当，误落库污染历史 | P0 | 单测断言 override 后 `agent_run_logs` 无新增 override 行；复用 task-14 已有不落库测试基线 |
| R-02 | 前端 partialSegments Map 跨 turn 未清空，撤回错段 | P1 | turn 边界（onTurnCompleted/clearCurrentRun）清空 Map；多 segment 用 segmentId 前缀天然隔离 |
| R-03 | complete→override 之间毫秒级「半截+全文」闪烁 | P2 | 本轮接受（override 紧随 complete）；若明显，后续 complete 携带 segmentId 即时替换（改 task-14 落库语义，另开 change） |
| R-04 | override 文本 publish 到 SSE，前端漏识别 → 当正文显示 | P1 | classifySessionLog + sanitizeSessionLogContent 双重识别丢弃；前端单测覆盖 |
| R-05 | task-14 落库去重回归（override 改 publish 影响 DELETE） | P0 | 保留 `_revoke_committed_partials` 调用顺序不动；复跑 task-14 的 12 用例 + 实跑 7 次 DELETE 日志基线 |

## 11. 决策追踪

| 决策 ID | 内容 | 覆盖章节 / FR | 状态 |
|---|---|---|---|
| D-001@v1 | 允许动后端（纯前端不可行：SSE 层丢 segmentId+override 截断） | §1.1、§5 Phase1、FR-01 | accepted |
| D-002@v1 | 方案 A：backend 透传 segment_id + override publish，前端按 segmentId 撤回（优于 B 改落库语义 / C 独立 event） | §5、FR-02/FR-03 | accepted |
| D-003@v1 | Grill 澄清：override envelope append published_logs 跳 INSERT（INSERT 与 publish 已解耦）；透传用 log_entry.segment_id；DTO 不加 segment_id 字段 | §5.1.1/§5.1.2/§2.4、FR-01/FR-02/FR-06 | accepted |

无未解决决策。

## 12. 自审

| 检查项 | 结果 | 说明 |
|---|---|---|
| 必填章节齐全（背景/目标/非目标/总体方案/文件变更清单/接口定义/风险登记） | ✅ | 齐全 |
| 生命周期关键词命中（session/daemon/agent_run） | ✅ 豁免 | §7.5 写明「不涉及生命周期契约」，本次不改状态机 |
| 文件变更清单与方案一致 | ✅ | backend 1 + frontend 4 + 测试 3 |
| 接口定义含数据结构 | ✅ | §7.1-7.4 envelope/类型/撤回契约 |
| 数据模型：无 schema 变更 | ✅ | 复用 task-14 segment_id 列 |
| 兼容策略 + 回退路径 | ✅ | §9 双向兼容 + 回退 |
| 决策 D-001/D-002 引用 | ✅ | §11，decisions.md 详记 |
| 非目标守住（不改 daemon/落库机制/schema/状态机） | ✅ | §3 |
| override publish-only 实现细节 | ✅ 已解决 | Design Grill X-02 澄清：INSERT 与 publish 已解耦（submit_messages 返回 PublishIntent、router.py:1033 commit 后 publish），override envelope 直接 append published_logs 跳 INSERT 即可，无需 helper |
