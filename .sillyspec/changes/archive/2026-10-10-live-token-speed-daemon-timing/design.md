---
author: brainstorm
created_at: 2026-10-10T19:45:00.000Z
scale: large
tier: independent
---
# 设计记录 — 2026-10-10-live-token-speed-daemon-timing

## 背景与目标

上变更 2026-10-10-session-turn-token-speed 交付了**终态**轮的 tok/s 生成速度
（输出词元 ÷ AgentRun.duration_api_ms），但两个缺口明确留档：

1. **运行中不显示**——实时 usage 事件只有 token 数，无时长分母；
2. **仅 Claude 系引擎有数据**——duration_api_ms 来自 Claude SDK 结果元数据，
   codex / pi / cursor 恒 NULL。

本变更目标：daemon 侧建立**逐模型调用计时**，把"轮内累计 API 生成时长"沿既有
usage 管线实时上报，使前端在**轮运行中**即可显示 tok/s；同时让 codex / pi 引擎
在终态也有速度数据。口径对齐 deepseek-harness：分母只含模型生成窗口、**不含
工具执行时间**（墙钟估速被上变更 design 否决的稀释问题不复现）。

## 现状与依据（代码事实）

- **claude**：`interactive/claude-events.ts` `_bufferPartial`（:945-1092）按
  parentKey 桶处理 SDK 流式事件：`message_start`（:952，记 message.id + usage
  起始值）、`content_block_delta`、`message_delta`（:1013，usage 差分累加 →
  `buf.pendingUsage` :1062-1070）；`message_stop` 流经此处但被跳过（:941 注释）。
  per-call 边界完整可锚。
- **codex**：`interactive/codex-app-server-driver.ts` 每条
  `thread/tokenUsage/updated` 通知 = 一次 API 调用收口（:1713 `_extractTokenUsage`、
  :1755 `turnApiCallCount += 1`），通知**无时间戳**；`item/started` /
  `item/completed`（agentMessage / reasoning 分型）可切出生成窗口。
- **pi**：`interactive/pi-rpc-driver.ts` 每条 assistant `message_end`（带 usage）
  = 一次调用（:1381-1408 `accumulatePiUsage`），帧无时间戳；有
  `tool_execution_start/end` 可扣工具窗口。
- **cursor**：usage 仅轮末 result 帧（cursor-events.ts:290-306），无逐调用点 →
  v1 不接（如实不显示，见"风险与死路"）。
- **usage 透传**：`AgentEventUsage`（types.ts:88-110）为显式字段白名单，
  `usageToEventUsage`（claude-events.ts:1285-1307）逐字段守卫透传；
  `AgentEvent.usage`（types.ts:135-136）任意型事件可携带，partial flush 实时
  上报（D-003@v1），schema 校验在 agent-event-schema.ts（与接口一字段对齐）。
- **后端**：`run_sync/service/submit_steps.py:348-379` 从 message 顶层 usage dict
  提取五项（max 累积 / last-write-wins 先例），状态字段 :57 区、重置 :115 区；
  写回在 `submit_commit.py:253-254`（ctx_tokens 同款）；`AgentRun.duration_api_ms`
  列已存在，close 时结果元数据覆盖写（close_run_steps.py:313-314，
  `if not None` 守卫——无值引擎不覆盖，实时累积值天然保留）。
- **下发**：`publish.py` tokens 事件（:201-221）+ run channel summary（:123-144）
  键 None 不带（design §9 兼容先例）；`turn_completed` 已带 duration_api_ms
  （上变更 FR-01）。
- **前端**：`session-sse.ts` envelope.duration_api_ms 已声明（上变更，注释限定
  turn_completed 语义需更新）；`turn-speed.ts` `turnTokenSpeedText` 门控为
  「终态 + 双值」（TERMINAL_SPEED_STATUSES）；onTokens 接线点 page/dialog 既有
  （ctxTokens 先例）。

## 非目标（Non-goals）

- cursor 引擎计时、会话级聚合速度、TTFT 单独展示、新 SSE 事件类型/REST 端点/前端轮询（同 proposal 不在范围清单）。

## 方案总览（五段）

1. **计时（daemon）**：各引擎在其"逐调用边界"用 `Date.now()` 维护
   `turnApiDurationMs`（轮内累计）：
   - claude：partial 桶加 `callStartMs` + `turnApiDurationMs`——`message_start`
     先折叠上一调用（`callStartMs` 非空则 `+= now - callStartMs`）再锚新值；
     `message_delta` 刷新活窗口（`pendingUsage.api_duration_ms` =
     已折叠累计 + 当前活窗口），使**生成期间数值实时增长**；轮收尾由 result
     折叠残段（防 message_stop 缺失）。
   - codex：driver 维护 `generatingSince`——`item/started`(agentMessage|reasoning)
     空时锚定；`item/completed`(agentMessage|reasoning) 折叠并清空；usage 事件
     构造点搭车 `api_duration_ms`。负值钳 0、无锚不折叠。
   - pi：assistant `message_end` 收口折叠（锚=本调用首个 assistant 内容事件，
     实现时若无内容级锚点事件则**降级 v1 不接**并如实留档——不伪造）。
   - cursor：v1 不接。
2. **携带（daemon 契约）**：`AgentEventUsage` += `api_duration_ms?: number`
   （轮级累计 ms）——types.ts + agent-event-schema.ts + `usageToEventUsage`
   守卫透传 + 各引擎 usage 事件构造点赋值。
3. **入库（backend）**：submit_steps 提取 `usage.api_duration_ms` →
   `st.latest_api_duration_ms`（**max 累积**，与 tokens 同款乱序防御）→
   submit_commit 写回 `AgentRun.duration_api_ms`；close 结果元数据非 None 时
   覆盖（Claude SDK 权威终值；codex/pi 无值 → 保留实时累积值）。
4. **下发（backend）**：publish intent 增 `duration_api_ms`（照 ctx_tokens
   先例全链装配），tokens 事件 + run channel summary 增键（None 不带键）。
5. **前端**：envelope.duration_api_ms 注释更新（tokens/turn_completed 均携带）；
   page/dialog `onTokens` 写 `turn.apiDurationMs`（?? 链同 ctx 先例）；
   `turnTokenSpeedText` 门控放宽为「**双值可得即显示（任意状态）**」——取代
   上变更「仅终态」语义（运行中实时速度即本变更核心诉求；pending/无数据自然
   不显示，不伪造原则不变）；相关测试同步改写。

## 接口契约

- `AgentEventUsage.api_duration_ms?: number`（daemon 内部事件契约 + schema 校验
  同步；跨引擎可选，缺省=该引擎未计时）。
- message 顶层 `usage.api_duration_ms`（daemon → backend submit_messages，既有
  usage dict 新键；旧 backend 忽略新键零影响）。
- SSE `tokens` 事件 + run channel messages summary：新增可选键
  `duration_api_ms: number | null`（None 不带键；旧前端忽略零影响）。
- REST / SSE 契约零新增端点；`AgentRun.duration_api_ms` 列复用（语义从
  "SDK 结果上报"扩为"实时累积 + close 权威覆盖"，close 覆盖语义不变）。
- 前端 `turnTokenSpeedText` 语义变化：`status` 参数保留但不再门控（签名不变，
  行为变化由测试固化）；`apiDurationMs` 字段/回填/显示链路签名不变。

## 边界与并发（盲维四问）

1. **乱序/迟到**：usage 事件按 parentKey 桶内单调（引擎流序）；backend max
   累积防御任何乱序回退（0 不拉低非零值，tokens 同款）；折叠负值钳 0。
   message_start 迟到重复锚定只折叠一次（折叠后置空 callStartMs 幂等）。
2. **并发写**：桶按 parentKey 隔离（main / 子代理 tool_use_id），计时字段随桶
   私有；子代理桶**同样计时并携带**（usage 按桶上报，backend run 级 max 累积
   口径下子代理与主桶互不覆盖——与 tokens 既有口径一致：max 取轮内最大瞬时
   累计值。**注意**：多桶并发时 max 累积的是单桶最大值而非跨桶求和——与
   tokens 完全同构，口径一致性优先，轮级速度语义不受影响（主桶占绝对大头））。
   SessionManager FIFO 串行化保证 result 折叠不与流事件交错。
3. **切换/生命周期**：桶随 turn 销毁（partial 缓冲既有清理链），计时字段随桶
   存亡无泄漏；会话 destroy 走既有台账回收；daemon 重启后半轮不续算（新轮
   从零），速度字段如实缺失。
4. **作用域**：字段随 usage 按会话/run 隔离；群聊影子流不经此管线（cursor 引擎
   v1 不接，影子会话引擎独立）；跨工作区无共享面。

## 风险与死路

- **最大风险：打点误差**。窗口锚点粒度受引擎事件节流影响（claude 500ms flush
  节流不影响锚点时点——锚点在事件处理时同步记，flush 只影响上报时机）；
  codex 生成窗口若被 tool item 打断（同轮 tool_call 在 assistant 消息内），
  窗口可能跨工具——守卫：仅 agentMessage/reasoning 边界折叠，跨型 item 不清锚，
  误差上界=单次调用内工具时长，可接受并留档。
- **pi 降级路径**：若实现时确认 pi 无内容级锚点事件，v1 不接（design 允许的
  显式降级，非静默缩水——收口时在 requirements/verify 留档）。
- **cursor 不接的理由**：usage 仅轮末一处，逐调用 tok/s 不可得；轮末
  `duration_ms − ΣexecutionTime` 是推导估算值（含其它等待，口径混杂），违背
  「不伪造」原则——留待 cursor 事件流提供逐调用 usage 后再接。
- **放弃方案**：① 前端墙钟差分（上变更已否决，稀释）；② daemon 新增独立计时
  上报通道（SSE 新事件类型）——零必要：usage 搭车链路现成且 tokens 事件消费方
  就位；③ 只做终态（方案 C）——放弃实时核心诉求。

## 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
| --- | --- | --- | --- | --- |
| usage（partial flush 搭车） | driver/归一化器 → SessionManager → submit_messages | backend submit_steps | usage.api_duration_ms（轮内累计 ms，可选） | st.latest_api_duration_ms max 累积 |
| turn_result / result 元数据 | driver（onTurnResult） | daemon → hub-client → close_interactive_run | duration_api_ms（仅 claude SDK 有；codex/pi 无） | close 覆盖写列（if not None 守卫；codex/pi 保留实时累积值） |
| tokens（SSE，每次 submit_messages） | backend publish | 前端 onTokens | duration_api_ms（None 不带键） | turn.apiDurationMs ?? 链写入 |
| turn_completed（SSE，轮终态） | backend close_run_steps | 前端 onTurnCompleted | duration_api_ms（既有，上变更） | 轮终态 + apiDurationMs 终值收敛 |
| daemon 重启（半轮） | daemon 进程 | 无 | —— | 计时随进程丢失，新轮从零；半轮无速度数据（如实缺失，不续算） |

## 自审

- 链路事实核：五交叉点经独立 Grill 子代理审查（review.json 在 .sillyspec/.runtime/stage-reviews/brainstorm-review-2026-10-10-194708/），specVerdict=pass / qualityVerdict=pass，两个 gap（路径更正、按桶措辞）与 P2（写回仅增不减款）已回写本文。
- 口径自检：分母=模型生成窗口（工具时间排除）与 deepseek-harness decode 口径的近似关系（含 TTFT）已在方案总览与上变更留档，无新增夸大承诺。
- 可测性自检：FR-01/02/03 均给出可判定场景（数值量级/窗口排除/折叠求和），测试绑定逐 FR 落文件。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 改 | sillyhub-daemon/src/types.ts | AgentEventUsage += api_duration_ms |
| 改 | sillyhub-daemon/src/agent-event-schema.ts | schema 同步 |
| 改 | sillyhub-daemon/src/interactive/claude-events.ts | 桶计时 + pendingUsage 搭车 + usageToEventUsage 透传 |
| 改 | sillyhub-daemon/src/interactive/codex-app-server-driver.ts | 生成窗口计时 + usage 事件搭车 |
| 改 | sillyhub-daemon/src/interactive/pi-rpc-driver.ts | message_end 折叠（含降级判定） |
| 改 | backend/app/modules/daemon/run_sync/service/submit_steps.py | 提取 + latest_api_duration_ms max 累积 |
| 改 | backend/app/modules/daemon/run_sync/service/submit_commit.py | 写回 AgentRun.duration_api_ms |
| 改 | backend/app/modules/daemon/run_sync/service/publish.py | PublishIntent 增字段 + tokens/summary 增键 |
| 零改动 | backend/app/modules/daemon/run_sync/service/__init__.py | 计划期判为 intent 装配链——实际 PublishIntent 在 submit_commit.py 直接构造（__init__ 仅委托壳），零改动（QA 已核） |
| 改 | frontend/src/lib/daemon/session-sse.ts | envelope 注释更新（语义扩 tokens 事件） |
| 改 | frontend/src/components/daemon/turn-speed.ts | 门控放宽（任意状态双值即显示） |
| 改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | onTokens 写 apiDurationMs |
| 改 | frontend/src/components/daemon/session-panel/session-panel-dialog.tsx | 同上 |
| 改 | frontend/src/components/daemon/__tests__/turn-speed.test.ts | 门控语义改写 |
| 改 | frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx | 运行中实时显示用例 |
| 增/改 | sillyhub-daemon/tests/interactive/claude-events.test.ts（既有文件内增用例） | claude 计时单测（fixture 流 + 可控时钟） |
| 增/改 | sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts（既有文件内增用例） | codex 生成窗口单测（工具窗口排除） |
| 增/改 | sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts（既有文件内增用例） | pi message_end 折叠单测（含降级判定） |
| 增/改 | backend/app/modules/daemon/tests/（submit/publish 相关既有文件内增用例） | 提取/写回/下发断言 |
