---
author: qinyi
created_at: 2026-10-29 11:50:17
generated_by: sillyspec-design-init
scale: small  # 规模评估（Step 8 按定稿实质重判）：全链任务强顺序依赖（契约→三源→透传→消费），唯一可并行簇=三引擎心跳源（3 文件局部增量，单会话上下文吃得下）——Wave 证据不成立，判 small 收编轻量道；早期粗判 large 为文件数轴印象，按反判据不作数
---

# 设计文档（Design）— 2026-10-29-engine-live-perception

## 背景

用户在会话中让 agent 执行大操作（典型：写大文件）时，界面长时间「像死机」——token 输入/输出/缓存三个数字完全不动，只有「待模型响应」计时在走（用户截图实证：Edit 分四段写入期间 1m55s 全静默）。根因（本变更立项前的代码走读钉板）：

- **Claude 引擎**（用户主用）：SDK stream_event 透传的 `input_json_delta`（工具参数流式碎片）在 `sillyhub-daemon/src/interactive/claude-events.ts` 的 partial 桶（只缓冲 thinking_delta/text_delta）中被直接丢弃；usage 只在 `message_start`（流首，input+cache 跳一次）/`message_delta`（流尾，output 跳一次）有值——大工具参数生成期（可达数分钟）daemon 对外完全静默。
- **zcode（智谱）引擎**：usage 仅 `turn.completed` 一次性给出（`sillyhub-daemon/src/interactive/zcode-events.ts:124`）；但 `v4/telemetry` 通知的 `stream.chunk`（仅 chunkLength 遥测）实测可达，当前被忽略（zcode-events.ts:84）。
- **codex 引擎**：已有 `token_usage_updated` 中途权威值→usage_update 事件链（`sillyhub-daemon/src/interactive/codex-app-server-driver.ts:1770-1846`），但未归一到统一实时信号通道。

前端现状：跑马灯等待条目（`frontend/src/components/daemon/turn-live-marquee.tsx:714-781` awaiting 合成条目）只显示计时 + 上次终态 token 值，无「还活着/在干嘛」的实时信号。

## 设计目标

1. 长操作（工具参数生成/等待首字）期间，界面有真实的实时信号：估算产出量按引擎能力分级补显（codex 权威 / Claude·智谱估算标「约」），等待态有具体阶段文案——用户不再误判死机。
2. 估算值与权威 usage 彻底分道：预算软切断、计费聚合、ctx 环（2026-08-27 决策「实时/终态口径必须同类」）零污染。
3. 三引擎归一到同一事件通道，前端单点消费。

## 非目标

- **不做** 缓存 token 的中途数据（cache 是 prefill 期事实，流首已跳一次即止，中途不会变——不伪造）。
- **不做** prefill 进度百分比（无数据源：首包前引擎不给任何进度信号，只有时间维度）。
- **不做** 「生成正文/思考」的心跳细分（Grill 追问④钉板：正文/思考已有可见流——对话流正文 + 跑马灯 thinking 全文流动，心跳价值为零；kind 枚举收敛 awaiting_first_token | generating 两值）。
- **不做** 操作队列可视化、多轮排队视图（YAGNI）。
- **不改** 既有 usage_update / tokens 事件语义与所有 usage 聚合消费方。
- heartbeat（机器级，hub-client 的 runtime 生命周期心跳）不在本变更范围——本变更事件名 **turn_heartbeat** 就是为与它区分（命名防混淆，见决策追踪 D-001 备注）。

## 拆分判断

单变更承载：daemon 三引擎心跳源 + backend 透传 + 前端消费是一个闭环契约（心跳载荷跨三层），拆开会出现「契约半悬空」的中间态（如只做 daemon 不做前端，事件无人消费）。Phase 划分（见总体方案）在变更内部组织顺序，不拆多变更。

## 总体方案

### Phase A — daemon：turn_heartbeat 事件契约 + 三引擎心跳源

**契约**（实现落点：`sillyhub-daemon/src/interactive/driver.ts` 的 `TurnHeartbeatSignal` + `InteractiveDriverCallbacks.onHeartbeat`——**daemon 内部契约，非 AgentEvent 联合成员**，不进归一化事件流/不落库；原稿写 types.ts AgentEvent 为设想形态，实现期修正为更干净的独立通道，语义与载荷不变）：载荷字段：`kind`（`awaiting_first_token` 等待首字 / `generating` 正在生成——Grill 追问④收敛两值，正文细分见非目标）、`est_chars`（本次调用累计字符数，JS string.length 口径，可选）、`est_tokens`（估算值 = est_chars÷3.5 四舍五入，可选）、`precision`（`estimated` / `authoritative`）、`source`（`claude_input_json_delta` / `zcode_telemetry` / `codex_token_usage`）、`parent_tool_use_id`（子代理归属，缺省 main）。节流 1s/条；轮收尾（onTurnEnd/turn_result）停发并清计数器。

**三引擎源**：
1. **Claude**：`claude-events.ts` partial 桶旁新增 tool-args 字符计数器——`content_block_delta` 的 `input_json_delta` 分支累计 `partial_json` 片段字符数（不缓冲内容本体，参数碎片不落任何持久面），节流发 `turn_heartbeat`(kind=generating, estimated)。请求发出→首包前（message_start 未到）由 `claude-sdk-driver.ts` 发 `awaiting_first_token` 心跳（驱动层知道请求已发出）。
2. **zcode**：`zcode-events.ts` 解析 `v4/telemetry` 通知——spike（task-01，见 spike-notes.md）修正：直接消费专用 kind **`tool_input_delta`**（工具参数流式增量，字符计数 estimated 心跳）与 **`usage.delta`**（用量增量信号），替代原案 chunkLength 折算；「降级脉冲」分支删除（信号不涨即无心跳，前端自然回落 awaiting 态——运行时自适应）。`zcode-app-server-driver.ts` 把遥测通知接进归一化器（当前直接忽略）。载荷字段形态按宽松解析（fail-soft），task-03 以实测样本单测钉映射（D-003 先例）。
3. **codex**：`codex-app-server-driver.ts` 既有 `token_usage_updated` 处理点转发一条 `turn_heartbeat`(kind=generating, precision=authoritative, est_tokens=本轮累计 output)——机制已有，只做归一化桥接。

**转发链**：驱动 `onHeartbeat` → `session-manager.ts` `_runConsume` 统一转 `{type:'turn_heartbeat_report'}` 鸭子消息经 `deps.onTurnMessage` 上行（**不进** 事件流 / usage 台账 `liftSessionUsage`/`_turnUsageByParent`/budget 任何聚合——daemon.ts 在事件轨识别之前早返回）；`agent-event-schema.ts` **不动**（心跳非 AgentEvent，实现期修正）。

### Phase B — backend 透传（不落库直发，照抄 turn_phase 已验证模式）

实现路由修正（收编期核实 D-backend-037 先例）：不走 AgentEvent 落库链（sdk_pipeline），照抄 2026-10-26-session-stage-progress 的 `turn_phase` 全链模式——daemon 侧心跳源经 SessionManager 既有 `deps.onTurnMessage` 通道发鸭子类型消息 `{type:'turn_heartbeat_report', ...}`（daemon.ts:4929 同款拦截形态）→ `daemon.ts` 拦截 → `hub-client.ts` POST `turn-heartbeat` 端点（fire-and-forget，失败仅 debug 日志）→ backend `daemon/router/notify.py` 加 `notify_turn_heartbeat` 端点（越权防护照抄 notify_turn_phase :347）→ `publish_json_event` Redis SSE 直发。**不落库、不进 AgentEvent 正式契约（agent-event-schema 不动）、api-types/openapi 仅当 notify 端点注册面要求时同步并跑双侧 gen:types（CLAUDE.md 规则 21）**。SSE 键名三端逐字对齐铁律（D-backend-039）：`kind` / `est_tokens` / `precision` / `source` / `parent_tool_use_id` / `timestamp` 三端同提交，不改名。

### Phase C — 前端等待态分级 + 估算补显

- `session-sse.ts`：解析 `turn_heartbeat` 事件到轮级 live 心跳状态（不进 TurnSegment 段树，防历史回放膨胀）；心跳停止（轮收尾/超时 5s 无心跳）即清。**选主策略（Grill P1-b 修正）**：会话级跑马灯只消费 main 心跳（`parent_tool_use_id` 缺省）；子代理心跳（非空）路由到子代理卡片 inline 跑马灯（2026-10-25-subagent-card-unify-panel 先例）——主/子并发长操作互不抖动，`est_*` 按 parent 键分桶存。
- **lastEventAt 口径（Grill 追问③钉板）**：心跳不刷新 `lastEventAt`（其语义=最后真实内容事件时刻）；心跳三态条目自身从 kind 首次观察起计时，回落态（无心跳）计时口径不变。
- `turn-timeline.tsx` 把心跳状态传 `turn-live-marquee.tsx`，awaiting 条目升级三态：无心跳=「等待模型响应 · Ns」（现状不变）；`awaiting_first_token`=「正在等待模型响应 · 已发送上下文」；`generating`=「正在生成大段内容 · 已产出约 N token」。估算值带「约」+ 弱化灰（text-muted-foreground），与权威值（亮色 tabular-nums）视觉区分；段落结束权威 usage 落定后估算补显消失（心跳停发）。
- 任何心跳态持续 >30s 文案追加「大内容可能需要几分钟」。
- 估算值**不进** tok/s 分子（turn-speed 口径保持权威）、不进任何用量合计。
- 移动端分支（mobile=true）同款生效（LIVE 徽标隐藏逻辑不变）。

### 原型（UI 变更须知）

原型分级：**生成原型（真码）**——新建 `frontend/src/components/prototype/engine-live-perception-view.tsx`（复用生产组件 TurnLiveMarquee + demo-chrome 外壳 + 假 turn_heartbeat 数据驱动三态演示），`pnpm prototype:build` 产 `frontend/prototype-dist/engine-live-perception.html` 并登记复件到变更目录 `prototype-engine-live-perception.html`；视觉对照结论落 visual-evidence.md。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/interactive/claude-events.ts | input_json_delta 字符计数器（不缓冲内容本体）+ 节流 1s 经 onPartialFlush 同款回调链发 turn_heartbeat_report 消息 + onTurnEnd 清零 |
| 修改 | sillyhub-daemon/src/interactive/claude-sdk-driver.ts | 请求发出→首包前发 awaiting_first_token 心跳；首包到达即切 kind |
| 修改 | sillyhub-daemon/src/interactive/zcode-events.ts | v4/telemetry tool_input_delta 解析（字符增量，spike 钉板 kind）产 estimated 心跳 |
| 修改 | sillyhub-daemon/src/interactive/zcode-app-server-driver.ts | 遥测通知接入归一化器（当前忽略路径） |
| 修改 | sillyhub-daemon/src/interactive/codex-app-server-driver.ts | token_usage_updated 处理点桥接 turn_heartbeat（authoritative） |
| 修改 | sillyhub-daemon/src/daemon.ts | 拦截 turn_heartbeat_report 消息（daemon.ts:4929 turn_phase_report 同款形态）→ hub-client POST turn-heartbeat（fire-and-forget）。数据流：producer=三引擎心跳源（onTurnMessage 鸭子消息）→ daemon.ts 拦截 → hub-client POST → backend notify → Redis SSE → consumer=前端 session-sse.ts |
| 修改 | sillyhub-daemon/src/hub-client.ts | POST turn-heartbeat 上报方法（照抄 turn-phase 先例） |
| 修改 | backend/app/modules/daemon/router/notify.py | notify_turn_heartbeat 端点（越权防护照抄 notify_turn_phase :333-351）→ publish_json_event SSE 直发（不落库） |
| 修改 | backend/openapi.json | 仅当 notify 端点注册面要求时同步；同步跑双侧 gen:types |
| 修改 | sillyhub-daemon/src/api-types.ts | gen:types 再生成（仅当 openapi 有变时） |
| 修改 | frontend/src/lib/daemon/session-sse.ts | SessionEventKind 加 turn_heartbeat + 分发 case（D-backend-039 三端键名逐字对齐）→ 轮级 live 心跳状态（不进段树） |
| 修改 | frontend/src/components/daemon/turn-live-marquee.tsx | awaiting 三态文案 + 估算补显（约/弱化/落定即隐）+ >30s 提示 + main 优先选主 |
| 修改 | frontend/src/components/daemon/turn-timeline.tsx | 轮级心跳状态传递 marquee（turnTokens 同路） |
| 新增 | NEW:frontend/src/components/prototype/engine-live-perception-view.tsx | 原型 view（生产组件 + 假心跳数据三态演示） |
| 修改 | frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx | 前端三态/估算补显/落定即隐/超时提示用例（独立文件复现模块初始化异常，并入跑马灯正家） |
| 修改 | sillyhub-daemon/tests/interactive/claude-events.test.ts | 心跳计数/节流/轮收尾清理用例（input_json_delta 计数器面） |
| 修改 | sillyhub-daemon/tests/interactive/zcode-events.test.ts | tool_input_delta 心跳增量/字段缺失无信号用例 |
| 修改 | sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts | token_usage_updated 桥接心跳用例 |

## 接口定义

```ts
// sillyhub-daemon/src/interactive/driver.ts（TurnHeartbeatSignal，daemon 内部契约）
interface TurnHeartbeatPayload {
  // Grill 追问④钉板：kind 收敛两值——正文/思考已有可见流（对话流+跑马灯 thinking 流动），
  // 无需心跳补显，「生成正文」细分进非目标；codex token_usage 不分内容类型，统一 generating。
  kind: "awaiting_first_token" | "generating";
  /** 本次 API 调用累计产出字符数（JS string.length 口径：claude partial_json 片段长 / zcode tool_input_delta 增量累计）；awaiting_first_token 无。 */
  est_chars?: number;
  /** 估算 token（est_chars ÷ 3.5 四舍五入）；codex authoritative 时为本轮累计 output 权威值。 */
  est_tokens?: number;
  precision: "estimated" | "authoritative";
  source: "claude_input_json_delta" | "zcode_telemetry" | "codex_token_usage";
  parent_tool_use_id?: string; // 缺省 main；非空=子代理心跳，前端路由子代理卡片（选主策略见 Phase C）
}
// AgentEvent = ... | ({ type: "turn_heartbeat" } & TurnHeartbeatPayload)
```

前端 SSE 事件类型（session-sse.ts 联合）同形扩展；无 HTTP 端点变更。

## 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| turn_heartbeat | daemon 归一器/驱动（节流 1s） | backend SSE → 前端 | type/kind/precision/source | 无（纯瞬态展示信号，不改变 session/agent_run/lease 任何状态） |
| 轮收尾停发 | daemon 归一器（onTurnEnd/turn_result） | — | — | 心跳计数器清零、心跳状态前端超时自清（5s 无心跳） |

不改变既有 lease/agent_run/session 生命周期（hub-client 机器级 heartbeat 与本事件同名域不同、互不相交）。

## 数据模型

无表结构变更（turn_heartbeat 不落库）；若 openapi AgentEvent 枚举扩展则 api-types 再生成（字段见接口定义）。

## 兼容策略（brownfield 必填）

- **旧 daemon / 历史会话**：无 turn_heartbeat 事件 → 前端无心跳状态 → 等待条目回落现状纯计时（零回归路径）。
- **回退**：daemon 心跳源异常（解析失败/节流器异常）→ fail-soft 静默停发心跳，等同旧态；不影响轮次收敛（turn_result 独立）。
- **不改变**：usage_update/tokens 事件语义、预算软切断、计费聚合、ctx 环、turn-speed tok/s 口径、既有 SSE 端点。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | zcode 遥测 stream.chunk 实测不覆盖工具参数生成期（心跳在 zcode 降级） | P1 | execute 前置 spike 抓包钉板；不覆盖→降级 awaiting_first_token 活跃脉冲（仍优于全静默）；降级结论落 decisions |
| R-02 | 心跳节流器/计数器泄漏（轮结束未清，跨轮残留） | P1 | onTurnEnd/turn_result 双点清理；驱动 consume finally dispose 兜底（对齐 partial 定时器既有先例）；测试覆盖清理路径 |
| R-03 | 估算值误入聚合（预算/计费） | P0 | turn_heartbeat 类型在 liftSessionUsage/aggregateSessionUsage 入口按类型排除（只认 is_partial/text-empty usage 载荷，新类型天然不匹配既有守卫）；评审专项核 |
| R-04 | SSE 事件量增大（1s/条×多会话）；主/子代理并发心跳抖动（Grill P1-b） | P2 | 不落库只透传；前端心跳状态按 parent 键分桶 + main 优先选主（子代理心跳路由子代理卡片，Phase C）；带宽量级（~100B/条）可忽略 |
| R-05 | openapi 类型面遗漏 gen:types 双侧义务 | P2 | Phase B 任务内同变更跑双侧 gen:types 并提交（CLAUDE.md 规则 21；断言面闸门⑨ fail-closed 兜底） |
| 无长驻进程/外部资源，生命周期面不适用（心跳节流器随轮创建随轮清理，见 R-02） | — | — | — |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | Phase A 契约 + Phase B 透传 + Phase C 补显（事件名细化为 turn_heartbeat 防与机器级 heartbeat 混淆；Grill 后 kind 枚举收敛两值、补选主策略与 lastEventAt 口径——均为载荷/消费细节细化，通道决策未变，不升版） | 已覆盖 |
| D-002@v1 | 非目标「不改 usage 语义」+ R-03（rejected 防复潮：估算并入 usage 通道被否决） | 已覆盖（rejected 条目，无需实现覆盖） |
| D-003@v1 | Phase C 前端等待态分级并入实现（rejected 条目：纯前端方案作为 zcode 降级时的兜底形态部分生效，见 R-01 应对） | 已覆盖（rejected 条目） |

无未解决决策；组合裁定推演：D-001（新事件通道）与 R-01 降级路径（zcode 无遥测数据）组合——降级只降 kind 不废通道，契约不变，无死锁格。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale——scale 留 Step 8 落值）
- [x] 引用所有当前版本 D-xxx@v1
- [x] 涉及生命周期关键词（heartbeat/session/daemon）→ 含「生命周期契约表」
- [x] UI 原型分级：生成原型（NEW:engine-live-perception-view.tsx + pnpm prototype:build 真码管线，local.yaml ui_prototype form=real-code 已登记）
- [x] 不确定的问题标注：⚠️ 自审存疑——backend SSE 发布点的具体文件（service.py 分发处 vs 独立 event_publish 模块）在 plan/execute 阶段以锚点定位，风险已记 R-05 相邻面
