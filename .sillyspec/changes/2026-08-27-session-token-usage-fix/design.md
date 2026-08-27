---
author: qinyi
created_at: 2026-08-27 21:57:40
change: 2026-08-27-session-token-usage-fix
scale: large
---

# 设计文档（Design）— 会话 token 统计口径修复（上下文环 last-call ctx + 消除轮中/终态跳变）

## 1. 背景

会话面板的上下文用量环（CtxUsageRing）数值严重失真，用户实证"不对劲"（2026-08-27 排查，本地 Docker Postgres 会话 64dca456）：

1. **环分子口径错误**：`session-panel.tsx:1562` 把各轮 `inputTokens` 求和当"上下文累计"，除以 200K 窗口分母。但每轮 `input_tokens` 本身是该轮内**所有 API 调用输入的总和**（agent 一轮连续调几十次工具，每次重发全上下文；实证一轮 66 次调用 Σ=1,092,740），6 轮累加 ≈394 万 → 环永远封顶 100%。
2. **实时/终态口径不一致**：轮中实时上报是 daemon 会话级累计值（`session-manager.ts` sessionInput/OutputTokens 跨轮不清零），轮终态落库又被 `close_interactive_run` 用 SDK result 的本轮值覆盖——实证 turn 1 终态 1,092,740（=该轮逐调用累计）→ turn 2 轮中实时值承接会话累计 ≥1.09M → turn 2 终态回落 144,212（两数字分属相邻两轮，非同轮回落；复审 N1 澄清）→ 每轮徽标数字暴涨后骤降。
3. **input 不含缓存**：开了 prompt caching 后大部分历史在 cache_read 里，环浮层声称"含系统提示与历史轮次"但分子没算 cache；且 cache 列（会话最新快照语义）与 input 列（本轮求和语义）口径不一致，拼不出真实上下文大小。

根因：设计期（archive/2026-08-19-sessions-portal FR-08/R-06）就把"累计计费 usage"当"上下文窗口用量"，未区分**计费量**（跨调用可加）与**上下文大小**（瞬时量，取最近一次调用）两个物理量。

## 2. 设计目标

- **FR-01**：上下文环分子改为"最近一次 API 调用的提示词大小"（= 该调用 `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`，新指标 `ctx_tokens`）。daemon 计算，经现有 usage 附带管线全链路透传，落库 `AgentRun.ctx_tokens`；前端取**最新非 null 值**（逆序），不再求和。历史会话（无 ctx 数据）环显示未知态。
- **FR-02**：消除轮中实时值与终态值的**语义级**跳变——统一为"本轮计费量"口径：daemon 实时上报改为轮级计数（turn 至今），终态以 SDK result 值为**权威校准**（终态覆盖照旧）。轮中徽标 ↑↓ 递增，终态定格；若 SDK result 与轮级累计存在数值出入（口径见 R-09 spike），表现为终态定格时的小幅校正，不再出现"会话累计暴涨→本轮值骤降"的跨语义跳变（现状实证 1,092,740→144,212）。
- **FR-03**：会话累计量（预算检查 D-009 口径）行为零回归——`_checkBudgetCutoff` 继续用会话累计计数器。

## 3. 非目标（Non-Goals）

- **NG-01**：不改 `AgentRun.cache_read_tokens/cache_creation_tokens` 列语义（现状"最新快照"，与终态 SDK result 同语义无跳变）；runtimes 用量页 `SUM(cache_read)` 跨轮重复计的已知偏差本次不动（记入风险，后续独立变更）。
- **NG-02**：不做会话累计总量的后端聚合列（R-06 原文"后端聚合列后续优化"仍是后续）。
- **NG-03**：不动 budget/预算检查逻辑本身（仅保证其数据源语义不变）。
- **NG-04**：不迁移历史数据、不做旧值换算（项目未上线，历史 run `ctx_tokens=NULL` → 环未知态，D-003）。
- **NG-05**：不改环组件视觉/布局/交互（原型跳过依据）。

## 4. 拆分判断

daemon → backend → frontend 是同一条 usage 数据链路，三处改动互为 producer/consumer（字段加一半就是断链），拆成多个变更会产生互相依赖的半成品；单变更一次贯通，走 large 四件套流程。

## 5. 总体方案

### Phase 1 — daemon（`sillyhub-daemon/src/interactive/session-manager.ts`）

**核心原则：新增轮级/调用级计数器，会话累计计数器原样保留**（`_checkBudgetCutoff` 依赖后者，误改即预算漏计）。

1. `PartialFlushBuffer` 新增字段：
   - `turnInputTokens: number` — 本轮至今输入（message_start 时 `+=` 该调用 `input_tokens`）；**所有桶**（主+子代理）都累计——子代理计费量经各自 pendingUsage flush 上报，backend 仅增不减聚合（**取 max，非求和**）接收，子代理量不小于其自身上报（复审 N3 措辞修正）；
   - `turnOutputTokens: number` — 本轮至今输出（message_delta 时 `+=` output delta，复用现有 `lastCallOutputTokens` 差分逻辑）；所有桶同上；
   - `lastCallCtxTokens: number` — 最近一次调用提示词大小（message_start 时 = `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`；message_delta 携带 cache 更新时用最新 cache 值重算）。**仅 'main' 桶计算与注入**——子代理桶的上下文不是会话主上下文，若注入会在子代理轮把环切到子代理 ctx 再跳回（审查 X-02/B2，D-006）。
2. 轮边界清零：`_onResult` 收尾时清零 main 桶 turn 级计数器与 `lastCallCtxTokens`。**turn 级计数器不参与 `_shrinkSubagentBuffers` 折算**——折算发生在轮已结束（currentRunId 已清空）之后，后续 flush 因无 runId 早退丢弃（`_flushPartial` :5451-5457），折算即死代码（审查 X-04/B3）；会话级计数器折算照旧（budget 数据源，行为不变）。子桶随折算删除，其 turn 级字段随桶销毁。
3. `pendingUsage` 结构调整（`_flushPartial` 注入值）：
   - `input_tokens` / `output_tokens` 改取**轮级值**（消跳变核心）；
   - `cache_read_tokens` / `cache_creation_tokens` 保持现状快照语义不变；
   - 新增 `ctx_tokens: lastCallCtxTokens`——**仅 main 桶的 pendingUsage 携带该字段**，子桶 pendingUsage 不含（backend 侧 `usage.get("ctx_tokens")` 缺失即跳过，天然兼容）。
4. 语义澄清注释（修正 ql-20260710-001 的误读）：Anthropic 原生 stream 事件的 `cache_*_input_tokens` 是**本调用**的缓存前缀量，replace 取最新值 = "最近一次调用的缓存读取"，与终态 SDK result 值天然一致；"会话级累计快照"的旧注释描述失准但行为正确，本次只改注释不改行为。**连带修正**旧注释对 batch `stream-json.ts:552/1143-1148` 的错引——batch 实为 `+=` 逐调用累加（:498-511），恰好佐证 per-call 语义（审查 X-11 附注）。
5. **SDK result 聚合口径验证（R-09，execute 首个任务）**：现有实证（会话 64dca456 turn 1：daemon 逐调用累计 1,092,740 与终态 SDK result 覆盖值相等）支持"SDK result usage = 该 query 内 Σ per-call input"，但样本仅一轮。execute 阶段先在真实会话上对照两路数值；若系统性偏差 >5%，启用 fallback：close 终态对 input/output 改"仅当 result 值 > 实时写入值才覆盖"（保大防回跳），该 fallback 在 plan/execute 期按 spike 结果决策，不阻塞本设计。

### Phase 2 — backend

1. **迁移**：`agent_runs` 加列 `ctx_tokens INT NULL`（nullable，无回填；down_revision 锚定当前唯一 head）。
2. **`run_sync/service.py submit_messages`**：usage 提取循环加 `ctx_tokens` 字段提取；写回 `AgentRun.ctx_tokens` 用 **last-write-wins**（批内取最后出现值直接赋值——ctx 是瞬时量可上可下，不用 max 守卫；input/output/cache 的 max 守卫维持现状）。
3. **SSE 透传**：`publish_submitted_messages` 的 run channel summary payload 与 session channel tokens 事件 payload 各加 `ctx_tokens`（None 不带，老 daemon 兼容）。
4. **`close_interactive_run`**：`InteractiveRunResultRequest` **不加** ctx_tokens 字段（SDK result 无 per-call 拆分）；input/output 终态覆盖照旧（口径已统一，终态值 ≈ 轮级终值，无跳变）；`ctx_tokens` 保留实时最后写入值。
5. **`router.py SessionRunRead`**：加 `ctx_tokens: int | None`（历史回填路径，`from_attributes` 直映列）。

### Phase 3 — frontend

1. `pnpm gen:types`（规则 20：node_modules 健康检查先行）。
2. `session-panel.tsx`：turn 视图（`SessionTurnView`）加 `ctxTokens`（SSE `onTokens`/终态 env 实时 + `runsMeta` 历史回填两条来源）；环分子 `usedTokens` 由"Σ 各轮 inputTokens"改为 **displayTurns 逆序第一个非 null 的 ctxTokens**。
3. `ctx-usage-bar.tsx`：`usedTokens` prop 类型改 **`number | null`**（审查 X-09——现类型 `number`，全轮缺 ctx 时 Σ=0 会显示 0.0% 而非未知态）；全 null → `pct=null` 未知分支 + 中心文本/浮层显示"—"；文案改为"最近一次模型调用的提示词大小（含缓存命中部分）"。此为类型+渲染分支改动，非纯文案。
4. `turn-timeline.tsx` 徽标不动（本轮计费量语义，FR-02 达成后自然无跳变）。
5. `lib/daemon.ts`：手写 SSE 类型 `SessionStreamEnvelope`（tokens 事件）补 `ctx_tokens?: number | null`——**gen:types 只覆盖 REST（api-types.ts），不覆盖手写 SSE envelope 类型**，漏改此跳前端拿不到字段（审查 X-07）。
6. （已核实）`floating-session-host.tsx` **无** CtxUsageRing/usedTokens 组装（审查 X-16 直接核源码定论），无需同步。

### 测试

- **R-09 spike（execute 首任务，非自动化测试）**：真实会话跑一轮含子代理的对话，对照 daemon 轮级累计与终态 SDK result 两路 input/output 数值，结论写入 QUICKLOG（偏差 >5% → 启用 R-09 fallback）。
- daemon vitest：turn 级计数器跨轮清零、ctx_tokens 三分量计算且仅 main 桶注入、子代理 token 经各自桶 flush 上报并入本轮（turn 级不折算，审查 B3 修正）、会话级折算与 budget 聚合零回归（防 R-01/R-05）。
- backend pytest：ctx_tokens 提取与 last-write-wins、SSE payload 透传、SessionRunRead 序列化、close 不覆盖 ctx_tokens。
- frontend vitest：环分子取最新非 null、全 null 未知态（usedTokens 可空）、SSE 实时更新。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/interactive/session-manager.ts | PartialFlushBuffer 加 turnInput/turnOutput/lastCallCtxTokens；_onResult 轮边界清零（turn 级不折算，会话级折算行为不变）；pendingUsage 取轮级值+ctx_tokens（仅 main 桶）；cache 语义注释修正 |
| 修改 | backend/app/modules/agent/model.py | AgentRun 加 `ctx_tokens INT NULL` 列 |
| 新增 | backend/migrations/versions/20260827230000_add_agent_runs_ctx_tokens.py | alembic 加列迁移（nullable 无回填；down_revision 锚执行时唯一 head） |
| 修改 | backend/app/modules/daemon/run_sync/service.py | submit_messages 提取 ctx_tokens（last-write-wins 写回）；publish 两路 payload 加 ctx_tokens。数据流：producer=daemon pendingUsage → flush 消息 usage dict → submit_messages 提取 → ①AgentRun.ctx_tokens 落库 ②Redis publish（run channel summary + session channel tokens 事件）→ consumer=前端 SSE |
| 修改 | backend/app/modules/daemon/router.py | SessionRunRead 加 ctx_tokens。数据流：producer=AgentRun.ctx_tokens 列 → SessionRunRead(from_attributes) → GET /api/daemon/sessions/{id}/runs → consumer=前端 runsMeta 回填 turn.ctxTokens |
| 修改 | frontend/src/components/daemon/session-panel.tsx | SessionTurnView 加 ctxTokens（SSE env 实时 + runsMeta 回填）；usedTokens 改逆序最新非 null ctxTokens |
| 修改 | frontend/src/components/sessions/ctx-usage-bar.tsx | usedTokens 改 `number \| null` + 全 null 未知态渲染分支；文案改 last-call 口径 |
| 修改 | frontend/src/lib/daemon.ts | 手写 SSE SessionStreamEnvelope（tokens 事件）补 ctx_tokens?: number \| null（gen:types 不覆盖此跳，X-07） |
| 生成 | frontend/src/lib/api-types.ts + backend/openapi.json | `pnpm gen:types` 产物随变更提交（ctx_tokens 进 SessionRunRead 类型） |
| 修改 | sillyhub-daemon/tests/interactive/（session-manager-usage-cache.test.ts 等 + 新增用例文件） | turn 重置/ctx 计算/折算/budget 回归用例 |
| 新增 | backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py | ctx_tokens 提取/写回守卫/SSE 两路/close 不覆盖用例 |
| 修改 | backend/app/modules/daemon/tests/test_session_runs_endpoint.py | SessionRunRead.ctx_tokens 序列化与 NULL 历史行用例 |
| 修改 | frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx + session-panel 相关测试 | 环分子口径用例 |
| 修改 | frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx | 旧 Σ 口径断言修正：fixture 补 ctx_tokens（执行期批准的 related_tests 归属，task-09） |

**ctx_tokens 全链路数据流**（防某跳 dormant）：
daemon `_bufferPartial`（message_start 三分量求和，仅 main 桶）→ `PartialFlushBuffer.lastCallCtxTokens` → main 桶 `pendingUsage.ctx_tokens` → flush 消息顶层 `usage` dict → `daemon.ts` usage lift（全名→短名映射点无需改，ctx_tokens 已是短名）→ `hub-client` submitMessages HTTP body → backend `submit_messages` usage 提取（:784 起）→ `AgentRun.ctx_tokens`（last-write-wins）→ ①Redis publish（run channel `messages` summary + session channel `tokens` 事件，字段 `ctx_tokens`）→ SSE → 前端 `lib/daemon.ts` SessionStreamEnvelope 类型（手写，需补字段）→ `onTokens` env / 终态 env → `turn.ctxTokens`；②`SessionRunRead.ctx_tokens` → `GET /sessions/{id}/runs` → `runsMeta` 回填 → `turn.ctxTokens`。两端汇合于 `session-panel.tsx` `usedTokens`（逆序最新非 null）→ `CtxUsageRing`。

## 7. 接口定义

```typescript
// daemon: PartialUsageSnapshot 扩展（session-manager.ts）
interface PartialUsageSnapshot {
  input_tokens: number;         // 轮级：本轮至今（原会话累计）
  output_tokens: number;        // 轮级：本轮至今
  cache_read_tokens: number;    // 不变：最新快照
  cache_creation_tokens: number;// 不变：最新快照
  ctx_tokens?: number;          // 新增：最近一次调用 input+cache_read+cache_creation（仅 main 桶携带；子桶 pendingUsage 无此键，复审 N-it 类型可选）
}
```

```python
# backend: AgentRun 新列（agent/model.py）
ctx_tokens: int | None = Field(default=None, nullable=True)  # 最近一次调用提示词大小

# SessionRunRead（daemon/router.py）
ctx_tokens: int | None = None

# SSE payload（run_sync/service.py publish 两路）
summary_payload["ctx_tokens"] / token_payload["ctx_tokens"]: int  # None 不带
```

写回守卫差异：`input/output/cache_*` 维持"仅增不减 max"；`ctx_tokens` 为 **last-write-wins 直接赋值**（瞬时量可浮动）。

## 7.5 生命周期契约表

本变更涉及 session / agent_run / daemon 生命周期事件，契约如下：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| message_start（stream_event） | SDK | daemon `_bufferPartial` | usage.input_tokens, cache_read_input_tokens, cache_creation_input_tokens | turnInputTokens += input；lastCallCtxTokens = 三分量和；会话累计器照旧累加 |
| message_delta（stream_event） | SDK | daemon `_bufferPartial` | usage.output_tokens（cumulative） | turnOutputTokens += delta（差分）；cache 快照 replace；delta 带 cache 时重算 ctx |
| partial flush（500ms） | daemon | backend `submit_messages` | usage{input_tokens(轮), output_tokens(轮), cache_*, ctx_tokens(仅 main 桶)} | AgentRun.{input,output} 仅增不减写回；ctx_tokens last-write-wins 写回；SSE 两路透传 |
| turn result | daemon | backend `close_interactive_run` | status, is_error, input_tokens(本轮), output_tokens(本轮), cache_*（请求 DTO 不含 ctx_tokens） | run → completed/failed；input/output 终态覆盖；ctx_tokens 保留实时值 |
| session end / fail | daemon | backend | session_id, reason | `_destroyPartialBuffer` 整清（含 turn 级字段） |

## 8. 数据模型

`agent_runs` 加列：

| 列 | 类型 | 可空 | 语义 |
|---|---|---|---|
| ctx_tokens | INT | NULL | 该 run 期间最近一次 API 调用的提示词大小（input+cache_read+cache_creation） |

会话级"当前 ctx" = 该会话最新 run 的 ctx_tokens（前端逆序取，不加后端聚合列，NG-02）。

## 9. 兼容策略

- **老 daemon / 无 ctx 上报**：usage dict 无 `ctx_tokens` key → 列 NULL → 环未知态（`usedTokens` 改可空后 `pct=null` 分支覆盖此场景，见 Phase 3.3），不报错。
- **老前端 / 滚动窗口**：新 backend 的 SSE/payload 多一个 nullable 字段，旧前端忽略即可（JSON 加字段向后兼容）。
- **实时口径变化**（会话累计→本轮）：只影响新产生的实时写回；已落库历史 run 值不动。上线瞬间进行中的轮，实时值会出现一次"从会话累计掉到轮级"的一次性回落（旧轮残留），随后自愈——接受，不补偿。
- **不改变的接口**：路由路径、请求 DTO 形状（close_interactive_run 不加字段）、`AgentRun` 既有列语义。

## 10. 风险登记（Risk）

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | budget 检查误用轮级计数器导致预算漏计 | P0 | 轮级/会话级两套计数器物理分离；daemon 测试显式断言 `_checkBudgetCutoff` 聚合值 = 会话累计（跨多轮用例） |
| R-02 | alembic 并行变更撞 revision 多 head | P2 | 迁移文件 down_revision 锚定执行时唯一 head；nullable 加列无数据回填，冲突概率低（known-issue 惯例） |
| R-03 | gen:types node_modules 半坏假报错 | P2 | 先 `pnpm exec tsc --version` 验证（CLAUDE.md 规则 20） |
| R-04 | ctx_tokens 乱序迟到消息带旧值回退 | P2 | flush 批内保序（现有 pipeline 保序语义）；跨批乱序由下次上报自愈，不做 max 锁死（ctx 合法浮动） |
| R-05 | 子代理 token 并入本轮的路径回归 | P1 | turn 级计数器**不折算**（折算时轮已结束、flush 因无 runId 早退，折算即死代码——审查 B3 修正）；子代理计费量经各自桶 pendingUsage flush 上报 + backend max 聚合实现。daemon vitest 断言口径（复审 N3）：**轮内 run 实时值 ≥ max(主桶上报, 任一子桶上报)**（max 聚合语义，非求和）；终态数值一致性归 R-09 集成验证；会话级折算（budget 数据源）零回归用例保留 |
| R-06 | 运行中轮尚无 ctx（首个 message_start 前）环取到历史轮值 | P2 | 接受：首个 message_start 通常秒级到达即刷新；比求和口径误差小一个数量级 |
| R-07 | HTML 原型跳过 | P2 | 无 UI 布局/交互变化（分级跳过依据，见分段展示设计步）；文案与未知态渲染改动在 verify 阶段对照 design 验收 |
| R-08 | runtimes 用量页 SUM(cache_read) 跨轮重复计（既有偏差） | P2 | 本次不动（NG-01），归档时记入 docs/sillyspec 活跃坑待后续变更 |
| R-09 | SDK result usage 聚合口径与 daemon 轮级累计的一致性仅有单轮实证 | P1 | execute 首个任务跑真实会话对照两路数值（Phase 1.5）；偏差 >5% 启用 fallback：close 终态 input/output 改"仅当 result > 实时值才覆盖"（保大防回跳）；正常一致则维持权威覆盖 |

## 11. 决策追踪

| 决策 | 状态 | 覆盖位置 |
|---|---|---|
| D-001@v1 实时/终态统一=本轮增量 | superseded（Grill X-05/B1：v1 的"必须相等"假设依赖未证的 SDK result 聚合口径） | — |
| D-001@v2 统一=本轮增量；终态 SDK result 权威校准 | accepted | FR-02 / Phase 1.5 / 生命周期契约表 / R-09 |
| D-002@v1 ctx 落库 AgentRun 列 | accepted | FR-01 / Phase 2.1 / §8 |
| D-003@v1 历史会话环显示未知 | accepted | FR-01 / Phase 3.3 / §9（补 usedTokens 可空，审查 X-09） |
| D-004@v1 每轮徽标=本轮计费量 | accepted | FR-02 / Phase 3.4 |
| D-005@v1 方案 A（复用 usage 附带管线） | accepted | §5 总体方案 / §6 数据流 |
| D-006@v1 ctx_tokens 仅 main 桶 | accepted | Phase 1.1/1.3 / 生命周期契约表（审查 B2） |

未解决遗留：R-09（SDK result 口径验证）为 execute 首任务 + 已备 fallback，不阻塞设计。D-005 为 AI 代选（用户未及时作答），设计确认轮用户已确认"确认，继续"，代选已被追认。

## 12. 自审（Self-Review）

- [x] 章节齐全：背景/设计目标/非目标/拆分判断/总体方案/文件变更清单/接口定义/生命周期契约表/数据模型/兼容策略/风险登记/决策追踪/自审 ✅
- [x] 生命周期契约表：涉及 session/agent_run/daemon 关键词，已含 5 事件矩阵（事件×发起方×接收方×必需字段×状态变化）✅
- [x] 文件清单数据流标注：ctx_tokens 为新增对外字段，producer→每跳→consumer 全链路已标注（§6 末尾，含手写 SSE envelope 跳），无 dormant 跳 ✅
- [x] 决策引用：D-001@v2 / D-002~D-006 全部引用且映射到 FR/章节 ✅
- [x] frontmatter：author/created_at/scale=large 齐备 ✅
- [x] 原型跳过原因已记入风险登记 R-07（非静默缺位）✅
- [x] **Design Grill 修订已并入**（独立子代理审查，2026-08-27）：B1→FR-02 措辞降级为"语义级跳变 + 终态权威校准" + Phase 1.5 spike + R-09 fallback；B2→ctx 仅 main 桶（D-006）；B3→turn 级计数器不折算、R-05 重写；X-07→文件清单补 lib/daemon.ts；X-09→usedTokens 可空；X-11→batch 错引连带修正；X-16→floating 无环已定论 ✅
- [x] 原"自审存疑 1"（SDK result 聚合口径）已升级为显式设计项 Phase 1.5 + R-09（非假设风险）✅
- [x] 原"自审存疑 2"（floating-session-host 环组装）已经独立审查核实：无环，Phase 3.6 定论 ✅
- [x] scale=large 判定：跨三模块 + DB 迁移 + SSE 契约扩展 + ~12 文件 → 四件套流程 ✅
