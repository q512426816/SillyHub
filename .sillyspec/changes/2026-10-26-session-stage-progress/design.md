---
author: qinyi
created_at: 2026-10-26 03:27:05
generated_by: sillyspec-design-init
scale: large  # 跨 backend/daemon/frontend 三端 10+ 文件，事件协议定稿后三端任务簇可真并行（backend 派发段零 daemon 依赖；daemon 上报只依赖端点契约；frontend 只依赖 SSE 事件契约），三端测试面合计单上下文吞吐偏重——Wave 编排有真并行收益
---

# 设计文档（Design）— 会话阶段化进度展示

<!-- 依据链：调研报告（链路见背景）+ decisions.md D-001~D-013 + 原型 prototype-session-stage-progress.html（用户已确认；Grill 两轮：首轮 3 阻断+4 gap 已修复，增量复审 pass） -->

## 背景

用户在 Web 会话发送消息后，若响应慢（实测新会话首轮冷启动最长约 40 秒），页面只有笼统的「执行中 + 思考中」，无法区分「正在启动 AI 进程」「正在同步规范文件」还是「卡死了」，体验差。

链路调研（2026-10-26，Explore 子代理全链核实）确认了三段「零信号盲区」：

1. **消息转发段**：backend 收到消息 → WS 下发 daemon（控制指令状态机 pending→delivered→acked，仅落库不上前端）；
2. **启动准备段**（仅新会话首轮）：daemon 领取租约后依次执行 skills 链接 / spec bundle 拉取 / MCP 预取 / Claude SDK spawn——各步骤在 `sillyhub-daemon/src/daemon.ts` 的 `_startInteractiveSession` 内有完善的分步计时（`endStep` → `interactive_create_step` 日志），**但只写 daemon 本地日志，从不上报**；
3. **首响间隙**（全部轮）：inject 注入到首个 AI 事件之间（正常 1-2s，异常由 90s 看门狗兜底但前端无感知）。

前端现状（`frontend/src/components/daemon/turn-status-bar.tsx`）：状态标签只有 `pending=排队中 / running=执行中`，`deriveTurnActivity` 终级兜底「思考中」；**无任何 phase/stage 概念**。

现有可复用基建（均已生产验证）：`agent_session:{id}` Redis Pub/Sub + SSE 透传通道（`backend/app/modules/agent/service.py` `stream_session_logs` 对任意 event 透明转发）；daemon→backend HTTP 上报模式（`backend/app/modules/daemon/router/notify.py` `notify_bash_status` 系）；控制指令三段式状态机（`backend/app/modules/daemon/control_commands.py`）。

## 设计目标

1. 用户发消息后的等待期间，会话状态条显示**当前具体阶段**（9 个阶段词表，见总体方案），替代笼统「思考中」。
2. 覆盖全部三类盲区：转发段（backend 发布，零 daemon 依赖）、启动准备段（daemon 上报）、首响间隙（daemon 上报）。
3. 单阶段停留 ≥30s 时状态条切警示样式并显示已等待秒数，区分「正常慢」与「卡死了」。
4. AI 干活期间（思考/工具/输出间隙）统一纳入同一文案体系（客户端从已有事件映射，不新增事件）。
5. 阶段展示为纯增强：任何上报/展示失败都不影响会话主流程，无信号的轮与现状展示完全一致（零回归）。

## 非目标

- 不做阶段轨迹历史回看/持久化（用户已选轻量单行形态，D-001；阶段快照入心跳留作后续演进，见 D-006 复潮条件）。
- 不做异常告警系统（弹窗/通知/独立告警面板）——超时仅状态条变色提示（D-003）。
- 不新增 daemon↔backend WS 消息类型（双侧契约测试 + 断言面闸门成本高，D-004）。
- 不改 SSE 透传层、不改现有事件（`log`/`tokens`/`bash_status` 等）语义、不改任何表结构。
- 不做服务端超时阈值配置/设置项（前端常量，D-007）。
- 不覆盖子代理目录、群聊 typing 等旁路展示位（首版仅主轮状态条）。

## 拆分判断

三端（backend/daemon/frontend）由同一事件协议强耦合：协议词表（9 个 phase 值）与 SSE 载荷形状是共同契约，拆成多个变更会出现「协议半成品」（某端先行发布、对端无消费）。本变更单变更内按 Phase 顺序实现（backend 端点与发布点 → daemon 上报点 → frontend 消费点），execute 阶段协议定稿后三端任务可真并行（Wave 依据见 frontmatter）。

## 总体方案

### 阶段词表（本变更核心契约，三端共同遵守）

| phase 值 | 状态条文案 | 发布方 | 发布点位 | 覆盖场景 |
|---|---|---|---|---|
| `dispatched` | 已发送 · 等待执行器领取 | backend | 控制指令 enqueue 下发成功点（`control_commands.py` `enqueue_and_push`）；daemon 离线待补拉时照发（pending-for-pull 语义兼容） | 全部轮 |
| `delivered` | 执行器已接收 | backend | **daemon ack 回执点**（`control_commands.py` ack 处理，非 mark_delivered 的 WS push 成功点——两者是状态机不同时刻，daemon 离线补拉时差可达分钟级；「已接收」以 daemon 真实确认为准） | 全部轮 |
| `skills_sync` | 正在准备技能环境 | daemon | `_startInteractiveSession` skillsStep 起止 | 新会话首轮 |
| `spec_sync` | 正在同步规范文件 | daemon | specStep 起止 | 新会话首轮 |
| `mcp_prefetch` | 正在加载工具配置 | daemon | mcpStep 起止 | 新会话首轮 |
| `spawning` | 正在启动 AI 进程 | daemon | `SessionManager.create` 调用前 | 新会话首轮 |
| `ready` | 已就绪 · 等待 AI 响应 | daemon | create 成功后（`notifySessionReady` 同点位） | 新会话首轮 |
| `inject_received` | 消息已送达 AI | daemon | `turn-control.ts` inject 的 InputQueue push 后 | 追问轮 |
| `first_event` | AI 开始响应 | daemon | `events.ts` onMessage 撤看门狗处（每轮一次） | 全部轮（末站，前端此后由活动摘要接管） |

### Phase 1：backend——转发段发布 + 上报端点（转发器）

1. **新增上报端点**：`POST /api/daemon/sessions/{session_id}/turn-phase`（`router/notify.py`，结构照抄 `notify_bash_status`：daemon 鉴权依赖 → 会话归属校验 → 发布）。DTO `TurnPhaseReportRequest` 进 `schema.py`（进 OpenAPI → 按仓库规则同步 `pnpm gen:types`，frontend 与 daemon 两处）。
2. **发布 helper**：`run_sync/service/publish.py` 新增 `publish_turn_phase_event`（结构对齐 `publish_session_event`，复用 `daemon/event_publish.py::publish_json_event` 底座：异常吞噬 + warning）。
3. **派发段零 daemon 依赖**：`control_commands.py` 状态机翻转点直接调用 helper 发布 `dispatched` / `delivered`——老版本 daemon 不升级也能看到前两段。

### Phase 2：daemon——启动阶段上报（信号源）

1. `hub-client.ts` 新增 `notifyTurnPhase(sessionId, runId, phase, detail?)`（照抄 `notifyBashStatus` 模式：HTTP POST，失败仅记日志不抛出）；`runId` 恒带（冷启动段用 `firstRunId`，`daemon.ts:9522` 守卫后必非空）。
2. `daemon.ts` `_startInteractiveSession`：既有 **endStep 计时闭包**（无 beginStep——起信号在三 step 闭包首行新插一行）边界处调用上报（skills/spec/mcp 三步 + spawn 前后）；**上报失败不影响会话创建主流程**（try-catch 吞噬，D-009）。SWR 命中跳过 specStep 时不发 `spec_sync`（跳过=瞬间完成，无用户可感知阶段）。
3. `turn-control.ts` inject 处上报 `inject_received`；`events.ts` onMessage 首事件处上报 `first_event`——防重键为 `(session_id, run_id)`（run 级标志，新 AgentRun 自然重置）。

### Phase 3：frontend——阶段消费与状态条文案（展示层）

1. `lib/daemon/session-sse.ts`：`SessionEventKind` 加 `"turn_phase"`；`SessionStreamEnvelope` 加可选字段 `phase` / `detail`（`timestamp` 复用既有字段名——三键与 payload 逐字对齐，SSE 载荷不在 OpenAPI，手写信封直接扩展）。
2. `lib/daemon/session-stream.ts`：switch 加 case（handlers 加可选 `onTurnPhase`），写入轮状态 `currentPhase: { phase, at }`（`session-panel/turn-state.ts` 类型扩展，占位轮/替换轮透传）；`turn_phase` 加入 run_id 必填白名单（既有 288-301 行机制，缺失即丢弃=D-013 防御丢弃的实现点）；`at` 时钟源 = 客户端本地 `Date.now()`（**事件到达时刻**，规避服务端/客户端时钟偏移）。接线链：session-panel-page/dialog 注册 handler 写轮状态 → turn-timeline 透传 `currentPhase` 给 TurnStatusBar（渲染点 :2370）。
3. **轮终态清理**：`turn_completed`（及 failed/killed 等终态）处理处清空该轮 `currentPhase`——防止断线错过 `first_event` 的轮在终态后仍挂「正在启动 AI 进程 · 已等待 N 秒」假警示（R-01「不显示陈旧值」承诺的兑现点）。
4. `components/daemon/turn-status-bar.tsx`：
   - Props 加可选 `currentPhase`；有值时状态标签位显示 `PHASE_LABEL[phase]`（词表见上），无值时保持现有「排队中/执行中」（零回归）；
   - 超时检测：复用组件既有每秒 tick，`now - currentPhase.at ≥ 30_000` 时整条切警示样式（`border-warning/40 bg-warning/10` + `text-warning`，token 铁律）并追加「已等待 N 秒」；
   - `first_event` 之后：阶段标签让位，右侧活动摘要接管（`deriveTurnActivity` 既有派生链零改动，D-008）。
5. 断线/刷新后 `currentPhase` 未知 → 回退现状文案（D-010）。

### 并行阶段展示边界（冷启动三步并发）

skills/spec/MCP 三步在 `_startInteractiveSession` 内 `Promise.all` 并行（`daemon.ts:10018`），事件到达顺序与词表串行轴可能交错，覆盖式刷新会亚秒级跳动。裁决：**保持三阶段独立上报、前端覆盖式刷新原样展示**——跳动是亚秒级真实进度，聚合文案（如「正在准备执行环境」）会引入前端合并逻辑复杂度，违背轻量形态；spec_step SWR 命中跳过时不发 `spec_sync`（Phase 2 已定），词表轴自然缩短。

### 原型（已产出并经用户确认）

`prototype-session-stage-progress.html`（变更目录，真码管线产物：源 `frontend/src/components/prototype/session-stage-progress-view.tsx` + `frontend/scripts/prototype-build.mjs` VIEWS 注册，`pnpm prototype:build` 编译；素材来源：生产 token `themes.ts`、状态条 DOM 对齐 `frontend/src/components/daemon/turn-status-bar.tsx:414`、`.sh-typing-dots` 生产 utility；双击离线可看，含三主题切换）。execute 阶段按批准稿接线，不重新翻译。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/daemon/schema.py | 新增 `TurnPhaseReportRequest`（`run_id: uuid` **必填**、`phase: Literal[7 值枚举]`、`detail: str \| None`）。producer=daemon `notifyTurnPhase` → HTTP POST body → consumer=`router/notify.py` 校验后经 `publish_turn_phase_event` 发布 `agent_session:{id}`，SSE 透传 → consumer=前端 `session-sse.ts` envelope |
| 修改 | backend/app/modules/daemon/router/notify.py | 新增 `POST /api/daemon/sessions/{session_id}/turn-phase` 端点：daemon 鉴权 → 会话归属校验 → `publish_turn_phase_event`；对齐 `notify_bash_status`（同文件既有模式） |
| 修改 | backend/app/modules/daemon/run_sync/service/publish.py | 新增 `publish_turn_phase_event(session_id, run_id, phase, detail)` helper：组装 `turn_phase` 事件 payload（键 `phase`/`detail`/`timestamp`，与前端信封逐字对齐）→ `publish_json_event` 发布 |
| 修改 | backend/app/modules/daemon/control_commands.py | `enqueue_and_push` 下发成功点发布 `phase=dispatched`（待补拉照发）、**daemon ack 回执点**发布 `phase=delivered`（非 mark_delivered 的 push 成功点——「已接收」以 daemon 真实确认为准）（producer=控制指令状态机 → Redis `agent_session:{id}` → consumer=前端 SSE）；发布失败不阻断指令状态机本身 |
| 新增 | NEW:backend/app/modules/daemon/tests/test_turn_phase_events.py | 端点鉴权/归属校验/发布断言 + 状态机翻转点发布断言 + 发布失败不阻断 |
| 修改 | sillyhub-daemon/src/hub-client.ts | 新增 `notifyTurnPhase` 方法（照抄 `notifyBashStatus`：HTTP POST 新端点，非 2xx 仅 warn 日志，producer=`daemon.ts`/`turn-control.ts`/`events.ts` 上报点 → consumer=backend turn-phase 端点） |
| 修改 | sillyhub-daemon/src/daemon.ts | `_startInteractiveSession` 既有步骤边界（skillsStep/specStep/mcpStep 起止、create 前后）调用 `notifyTurnPhase` 上报 5 个冷启动阶段；try-catch 吞噬保主流程 |
| 修改 | sillyhub-daemon/src/interactive/session-manager/turn-control.ts | inject 的 InputQueue push 后上报 `inject_received`（同样吞噬） |
| 修改 | sillyhub-daemon/src/interactive/session-manager/events.ts | onMessage 首事件（撤看门狗处）上报 `first_event`，每轮一次（turn 级标志位防重） |
| 修改 | sillyhub-daemon/src/api-types.ts | `pnpm -C sillyhub-daemon gen:types` 重生成（新端点 DTO 进 OpenAPI；仓库规则 21 同变更义务） |
| 新增 | NEW:sillyhub-daemon/tests/turn-phase-report.test.ts | 各上报点调用断言 + 失败静默（不抛出）断言 |
| 修改 | frontend/src/lib/daemon/session-sse.ts | `SessionEventKind` 加 `"turn_phase"`；`SessionStreamEnvelope` 加可选 `phase`/`detail`（`timestamp` 复用既有字段名——三键与 payload 逐字对齐；producer=backend Redis 发布 → SSE 透传 → consumer=`session-stream.ts` 分发） |
| 修改 | frontend/src/lib/daemon/session-stream.ts | switch 加 `turn_phase` case：解析后写入轮状态 `currentPhase={phase, at: Date.now()}`（本地到达时刻）；缺失/null run_id 防御性丢弃 |
| 修改 | frontend/src/components/daemon/session-panel/turn-state.ts | 轮状态类型加 `currentPhase?: { phase: string; at: number } \| null`（占位轮创建/`replacePlaceholderTurn`/attach 对账路径透传；**turn_completed/failed/killed 终态分支清空 currentPhase**——防断线场景假超时警示） |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | 注册 `onTurnPhase` handler：phase 事件写入轮状态 `currentPhase`（经 turn-state helper）；轮终态清空（producer=session-stream 分发 → consumer=轮状态） |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-dialog.tsx | 同 page 双消费方接线（`onTurnPhase` handler 同款，design §Phase 3 第 2/3 条） |
| 修改 | frontend/src/components/daemon/turn-timeline.tsx | TurnStatusBar 渲染点（:2370）透传 `currentPhase` prop（从 turn 对象取） |
| 修改 | frontend/src/components/daemon/turn-status-bar.tsx | Props 加可选 `currentPhase`；新增 `PHASE_LABEL` 词表映射；≥30s 超时警示样式（warning token）；`first_event` 后标签退位规则；无 phase 完全走现状分支 |
| 修改 | frontend/src/lib/api-types.ts | `pnpm gen:types` 重生成（新端点 schema；仓库规则 21） |
| 新增 | NEW:frontend/src/components/daemon/__tests__/turn-status-bar-phase.test.tsx | PHASE_LABEL 映射 / 超时警示切换 / phase 缺失兜底（现状不变）/ first_event 退位 |
| 新增 | NEW:frontend/src/lib/daemon/__tests__/session-stream-turn-phase.test.ts | SSE `turn_phase` 事件消费 → currentPhase 写入断言 |
| 新增 | frontend/src/components/prototype/session-stage-progress-view.tsx | 真码原型视图（brainstorm 阶段已落盘，批准即冻结） |
| 修改 | frontend/scripts/prototype-build.mjs | VIEWS 注册原型视图（已落盘） |

## 接口定义

### daemon → backend 上报（新增，唯一新 REST 端点）

```python
class TurnPhaseReportRequest(BaseModel):
    run_id: uuid.UUID                     # 必填：daemon 恒带（冷启动段用 firstRunId，daemon.ts:9522 守卫后必非空；前端对缺失 run_id 的 phase 事件丢弃防御）
    phase: Literal[
        "skills_sync", "spec_sync", "mcp_prefetch", "spawning", "ready",
        "inject_received", "first_event",
    ]                                     # dispatched/delivered 由 backend 自产，不收上报
    detail: str | None = None             # 可选补充（如 spec bundle 版本、降级原因）
```

`POST /api/daemon/sessions/{session_id}/turn-phase`：daemon 鉴权（对齐 notify 系既有依赖）→ 会话归属校验（404 口径对齐同文件）→ `publish_turn_phase_event` → `{"ok": true}`。

### backend → 前端 SSE 事件（新增 event kind）

payload 键名前后端**逐字一致**（SSE 透传层原样转发不改名——`agent/service.py` transparent passthrough 已实证，键名不一致则字段必丢）：

```json
{
  "event": "turn_phase",
  "session_id": "<uuid>",
  "run_id": "<uuid>",
  "phase": "spec_sync",
  "detail": null,
  "timestamp": "2026-10-26T03:30:00Z"
}
```

经 `agent_session:{id}` 频道 → `stream_session_logs` 透传（SSE 层零改动）→ 前端 `SessionStreamEnvelope`（新增可选字段 `phase` / `detail` / `timestamp`——`timestamp` 复用既有信封字段名，`phase`/`detail` 为本事件新增，与 payload 键名逐字对齐）。

## 生命周期契约表

本变更不改变既有生命周期状态机（session/lease/agent_run 状态流转零改动），仅新增**观测性事件**挂靠在既有状态机翻转点上：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| turn_phase 上报（冷启动段/轮内段） | daemon | backend | session_id(path), phase, run_id(必填), detail(可选) | 无状态变化（纯事件发布） |
| turn_phase 发布 dispatched | backend(control_commands 下发成功点) | 前端(SSE) | session_id, run_id, phase="dispatched", timestamp | （既有）控制指令 pending→已下发，无新状态 |
| turn_phase 发布 delivered | backend(control_commands **ack 回执点**，非 mark_delivered 的 push 成功点) | 前端(SSE) | session_id, run_id, phase="delivered", timestamp | （既有）控制指令 acked 翻转，无新状态 |

契约对账：三事件的必需字段均已出现在 `TurnPhaseReportRequest`（上报向）与 `publish_turn_phase_event` payload（发布向）接口定义中；每个事件对应代码任务（Phase 1/2）与测试任务（`test_turn_phase_events.py` / `turn-phase-report.test.ts` / `session-stream-turn-phase.test.ts`）。

## 数据模型

无 schema 变更（无新表、无列变更、无 Alembic migration）；阶段不落库，仅经 Redis Pub/Sub 瞬时发布。

## 兼容策略（brownfield 必填）

- **未升级 daemon**：backend 派发段（`dispatched`/`delivered`）照常发布——前端已能显示前两段；冷启动段/轮内段缺信号 → 前端回退现状文案，展示退化为「部分生效」而非报错。
- **无 phase 信号的运行中轮**（老版本、上报失败、断线重连后）：状态条渲染路径与现状**完全一致**（`currentPhase` 缺省分支 = 现有代码路径），零回归。
- **不改变的 API**：现有全部端点、既有 SSE 事件（`log`/`tokens`/`bash_status`/`bash_chunk`/`turn_completed` 等）语义与载荷不动；新增端点为独立增量。
- **不改变的表结构**：零 migration。
- **回退路径**：前端对未知 `phase` 值（未来版本新增词表项）按「未知阶段」显示原始 phase 字符串并可一键回退兜底文案；后端发布点与端点可独立下线（前端对事件缺失天然兼容）。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | SSE 无历史：断线/刷新错过 phase 事件后阶段展示空白或过期 | P2 | 回退现状兜底文案（D-010 已裁决）；过期 phase 由新事件覆盖式刷新，不显示陈旧值 |
| R-02 | 老版本 daemon 不上报冷启动段，用户看到前两段后「断档」 | P2 | 接受为灰度语义（部分生效）；前端断档时保持最后已知阶段+超时提示自然兜底；daemon 随平台分发自动升级 |
| R-03 | 阶段事件频率失控（理论上每边界一次，异常路径重复报） | P2 | 词表封闭枚举（9 值）+ `first_event` run 级防重键 (session_id, run_id)（D-013④）+ 复用既有 100ms 节流通道语义；execute 补一条重复上报幂等断言 |
| R-04 | `gen:types` 重生成暴露与本次无关的旧测试债（历史惯例坑） | P1 | 按仓库规则 21：顺手补字段修好，不为躲报错回退手写；execute 首个 gen:types 任务即验证 |
| R-05 | 阶段标签与右侧活动摘要双文案并存造成语义冲突 | P2 | D-008 退位规则钉死：`first_event` 后标签位回退为「执行中」、摘要接管；原型 ⑤ 区已按此呈现并经用户确认 |
| R-06 | 多会话并行/群聊场景 phase 串扰（A 会话事件写到 B 轮） | P2 | 事件载荷带 `session_id`+`run_id`，前端分发按轮归属过滤（`session-stream.ts` 既有 run_id 归属路由复用）；子代理目录首版不消费 phase |
| R-07 | daemon 上报点代码在 god 文件（daemon.ts 4047 行）内改动引发回归 | P1 | 上报调用点收敛为独立小函数（上报聚合在一个私有 helper），边界处单行调用；daemon 聚焦测试跑 `_startInteractiveSession` 相邻用例 |
| R-08 | 冷启动三步 `Promise.all` 并行，阶段事件到达交错、覆盖式刷新亚秒级跳动 | P2 | 接受：跳动是真实进度且亚秒级；聚合文案引入合并逻辑复杂度违背轻量形态（「并行阶段展示边界」节已裁决）；SWR 跳过步不发事件自然缩短词表轴 |

## 非功能生命周期

无长驻进程、无后台任务、无外部资源持有：daemon 上报是请求内 HTTP 调用（无重试队列）；前端超时计时复用 `TurnStatusBar` 既有每秒 `setInterval`（组件卸载即清理，既有模式）；backend 发布复用既有 Redis 连接池。生命周期面不适用。

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | 非目标第 1 条；Phase 3 状态条单行形态（不新增区域） | 已覆盖 |
| D-002@v1 | 设计目标 1/2/4；阶段词表全表（盲区三段+轮内映射） | 已覆盖 |
| D-003@v1 | 设计目标 3；Phase 3 超时警示样式 | 已覆盖 |
| D-004@v1 | 总体方案三 Phase 架构；接口定义（新增 SSE event kind 走既有通道；不新增 WS 消息类型） | 已覆盖 |
| D-005@v1 | 落选方案存档（推断式），防复潮——本设计与之无交集 | 已覆盖 |
| D-006@v1 | 落选方案存档（心跳轮询），防复潮——快照能力列入非目标与后续演进 | 已覆盖 |
| D-007@v1 | Phase 3 超时阈值 `30_000` 前端常量；非目标第 5 条（不做配置项） | 已覆盖 |
| D-008@v1 | Phase 3 第 3 条退位规则；R-05 应对 | 已覆盖 |
| D-009@v1 | Phase 1 端点发布吞噬、Phase 2 daemon try-catch 吞噬；兼容策略 | 已覆盖 |
| D-010@v1 | 兼容策略第 2 条；R-01 应对；非目标第 1 条（不做持久化） | 已覆盖 |
| D-011@v1 | 词表 delivered 行 + 生命周期契约表：挂 **ack 回执点**（非 mark_delivered push 成功点）——Grill 阻断①修复 | 已覆盖 |
| D-012@v1 | 接口定义 + Phase 3 第 1 条：SSE 键名三端逐字对齐（`phase`/`detail`/`timestamp`）——Grill 阻断②修复 | 已覆盖 |
| D-013@v1 | Phase 3 第 2/3 条：`at`=本地到达时刻、run_id 必填+防御丢弃、轮终态清 currentPhase、first_event 防重键 (session_id, run_id)、并行阶段边界——Grill 阻断③+四 gap 修复 | 已覆盖 |

无未解决决策。多裁定组合推演：D-003（超时警示）×D-008（退位规则）×D-010（断线回退）×D-013（终态清理）组合状态——超时仅作用于「有 phase 且未到 first_event」窗口，退位后超时计时器随之失效，断线回退与轮终态清空 phase 互斥可达、无死锁格（Phase 3 实现顺序：先判 phase 存在性 → 再判退位 → 再判超时；终态清空在轮状态层先行，状态条不感知终态后 phase）。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/拆分判断/总体方案/文件变更清单/接口定义/生命周期契约表/数据模型/兼容策略/风险登记/非功能生命周期/决策追踪/自审）
- [x] frontmatter 字段齐全（author/created_at/scale=large 附 Wave 证据）
- [x] 引用所有当前版本 D-001@v1~D-013@v1（决策追踪表逐行覆盖）
- [x] 涉及生命周期关键词（session/daemon/lease）→ 含「生命周期契约表」（三事件，观测性事件定性，必需字段与 DTO 对账）
- [x] UI 原型分级：必须生成档 → 真码管线产物 `prototype-session-stage-progress.html` 已落变更目录（源 `frontend/src/components/prototype/session-stage-progress-view.tsx`，`pnpm prototype:build` 编译，素材来源已声明，用户已确认）
- [x] 文件清单路径已逐一核验存在（15 个已有文件 OK；新建 4 个带 NEW: 前缀）
- [x] 不确定的问题：无「⚠️ 自审存疑」项——全部设计点均有 D-xxx 裁决或调研实证支撑
