---
author: qinyi
created_at: 2026-09-14 10:21:45
generated_by: sillyspec-design-init
scale: large
---

# 设计文档（Design）— 会话上下文压缩（平台级 /compact）

> v3（2026-09-14 复审 fail 后返工）：P0-3「控制命令结果回传机器不存在」（ack 全链 ids-only，复审实证）→ 定案 pi/codex 走 **ws RPC 请求-结果通道**（backend ws_hub.send_rpc backend/app/modules/daemon/ws_hub.py:502-560 等 daemon:rpc_result、超时/离线/远端错误异常齐备 + daemon registerRpcHandler 注册表 sillyhub-daemon/src/daemon.ts:6438-6456 既有 list_dir/get_spec_bundle 四先例）——砍掉 v2 的 SESSION_COMPACT 控制机器全部三件套（backend protocol.py/control_commands.py + daemon protocol.ts/daemon.ts 三点接线），「无 schema 迁移/control-dispatcher 零改动」断言在 v3 下为真；P1-1 claude 路 DaemonSessionTurnConflict 竞态异常映射补进 FR-02。v2 已闭环项（首轮 X-a/X-f）保持。

## 背景

会话页上下文环上线后（2026-09-13-ctx-usage-all-providers），用户能看见四引擎的上下文占用爬升，但**没有任何手段回收**——Claude Code CLI 用户习惯用 `/compact` 压缩重置上下文，平台上没有对应能力，长会话只能看着环变红或弃用会话。

调研实证（2026-09-14，两路 Explore + Design Grill 独立审查，全部源码/文档锚点核过）：

- **claude**：SDK 官方支持 prompt 文本分发 slash 命令（sdk.d.ts AgentSpec 文档 + Agent SDK docs）——**backend 既有 inject 链路原样复用即可**（inject 服务原生建 run：response 带 run_id，turn 正常收敛，会话流天然出现 /compact 轮，与 CLI 原生体验一致）。压缩发生时下行 `compact_boundary` 系统帧（sdk.d.ts L3191-3213，带 `compact_metadata.pre_tokens/post_tokens/duration_ms`），现被 `sillyhub-daemon/src/interactive/claude-events.ts:605` 白名单外静默丢弃——**v1 不透传**（NG-04，呈现已由压缩轮本身承载）。
- **pi**：原生 RPC 命令 `{"type":"compact","customInstructions"?}`（pi 包 docs/rpc.md:374-411；rpc-mode.js L415-421）——**结构化回执**（response data 含 `tokensBefore/estimatedTokensAfter/summary`）+ `compaction_start/compaction_end` 事件。driver `_sendCommand`（sillyhub-daemon/src/interactive/pi-rpc-driver.ts:1732-1769）stdin 独立通道 + id→pending 关联 + stdout 监听常挂循环外（:1417）——**Grill X-b 实核：空闲态 consume 停在 inputIt.next()（:1444）时命令 response 照常 resolve，interrupt()/get_state 即同款先例，可行**。引擎的 compaction_* 事件维持现状吸收不透传（sillyhub-daemon/src/interactive/pi-events.ts:245-249?）——回执走控制命令结果（见下）。
- **codex**：app-server 方法 `thread/compact/start {threadId}`（0.147 二进制 strings + 开源 common.rs:723-727）+ 完成通知 `thread/compacted`。**Grill X-c 实核：driver 现无按 id 等 response 机制（turn/start 等全部 fire-and-forget :1578-1593）——「等 response」需新建 id→pending map（照 pi h.pending 先例，如实标注为新增机制并配测试）**；受理响应为空对象（无数量回执）。
- **cursor**：无任何通道（CLI 无 compact flag/子命令；每轮 respawn 无长驻控制通道）——如实不支持。
- **平台 RPC 通道（v3 定案）**：backend→daemon 的请求-结果机器**实存且先例干净**——`ws_hub.send_rpc(daemon_id, method, params, timeout)`（backend/app/modules/daemon/ws_hub.py:502-560：发 daemon:rpc 等 daemon:rpc_result，DaemonRuntimeOffline/DaemonRpcTimeout/DaemonRpcRemoteError 异常全集 + 动态默认超时）；daemon 侧 `ws.registerRpcHandler(method, handler)` 注册表（sillyhub-daemon/src/daemon.ts:6476：list_dir/list_roots/get_spec_bundle/host_fs.stat 四先例，handler 返回对象即 RPC result）。**压缩走该通道**：backend 端点 send_rpc(daemon_id, 'session_compact', {session_id}, timeout=15) → daemon 注册 session_compact handler → sessionManager.compact → CompactResult 即 RPC result。v2 曾设想的 SESSION_COMPACT 控制命令机器被复审证伪（ack 全链 ids-only、表无 result 列、handlers 无返回值通道），全部弃用。
- **呈现链关键事实（Grill X-f）**：task_notification 瞬时通道在 daemon 消费侧被三重拦截（sillyhub-daemon/src/interactive/session-manager/background-tasks.ts:201-202/:211-219/:227-232）+ 误触发唤醒注入（:253-261）；前端瞬时 SSE 不渲染为会话流行（frontend/src/lib/daemon/session-stream.ts:318）、[SYSTEM:] 落库行被 assembler 丢弃（frontend/src/components/daemon/session-log-assembler.ts:297）——**会话流系统提示行路线不可行，呈现改为端点响应回执**。
- **前端挂点**：CtxUsageRing Popover（frontend/src/components/sessions/ctx-usage-bar.tsx:204-239?）编辑器行后插按钮行；可选回调 `onCompact?` 模式（照 onWindowOverrideChange :120）；caps 门控参照（:439）；预会话态（frontend/src/components/daemon/session-panel/session-panel-page.tsx:2722?）无 sessionId 不渲染；turn running 派生现成（`running = turnState.currentRunId != null` :1451）。环分子 `latestCtxTokens` 逆序最新非 null（frontend/src/components/daemon/session-panel/page-helpers.tsx:546）——**压缩后下一次调用 usage 到达即自然回落，零改动**。

## 设计目标

- **FR-01（caps 第 12 键）**：ProviderCaps 加 `compact: boolean`（claude/pi/codex=true、cursor=false、未知回退 false），三端生成 + 双守护测试 + pre-session-picker 同步——防遗漏契约第三次兑现。
- **FR-02（backend 统一端点 + 引擎分路）**：`POST /api/daemon/sessions/{id}/compact`：校验归属 + provider caps（false 拒绝）+ 会话状态（running/reconnecting 拒绝——对齐 inject 守卫三态 sillyhub-daemon/src/interactive/session-manager/turn-control.ts:157）；**claude → 复用 inject 服务**（prompt="/compact"，建 run，响应含 `{run_id, queued}`；DaemonSessionTurnConflict 锁内竞态异常捕获映射进响应 error 字段——复审 P1-1）；**pi/codex → ws_hub.send_rpc(daemon_id, 'session_compact', {session_id}, timeout=15)**（DaemonRpcTimeout/Offline/RemoteError 各自映射响应 error；旧 daemon 无该 handler 时 RemoteError →「daemon 未支持压缩」）。
- **FR-03（claude 分路）**：backend 侧对 claude 直接走既有 inject 通道发 `/compact` 文本——零 daemon 改动、run 归属明确（inject 原生建 run）、会话流出现 /compact 轮（与 CLI 原生一致）；SDK 处理 slash 命令。
- **FR-04（pi 分路）**：daemon SESSION_COMPACT → session-manager compact 守卫 → `PiRpcDriver.compact()` = `_sendCommand {"type":"compact"}` 等 response，回执 `{tokensBefore, estimatedTokensAfter}` 经控制命令结果回传 backend。
- **FR-05（codex 分路）**：`CodexAppServerDriver.compact()` = 新建 id→pending response 机制（pi 先例）发 `thread/compact/start {threadId}` 等 response（空对象=受理）；结果回传同 FR-04。
- **FR-06（前端按钮）**：环浮层「压缩上下文」按钮——caps.compact 门控（false 不渲染）+ turn running 禁用（tooltip「轮运行中」）+ 预会话不渲染；点击调新端点。
- **FR-07（呈现，v2 重写）**：反馈通道 = **端点响应 + 前端通知**：pi 成功通知带数字（「已压缩：45,200 → 约 8,300 tokens」）、codex「已触发上下文压缩」、claude「已发送 /compact（压缩轮运行中）」；claude 的流程可见性由 /compact 轮本身承载（用户轮 + result 既有渲染）；pi/codex 引擎内部 compaction 通知维持现状（不透传，回执已由控制结果承载）。环下一轮自然回落。
- **FR-08（真机验证）**：pi（结构化回执）+ claude（slash 通道——官方文档口径成立但仓内无实测锚点）+ codex（参数命名/空闲前置）真机各压一轮：通知出现、claude 会话流出现压缩轮、下一轮环回落。

## 非目标

- **NG-01**：自动压缩配置管理（pi set_auto_compaction/claude autoCompactThreshold/codex AutoCompactTokenLimit 维持引擎默认，二期，D-001）。
- **NG-02**：轮中强制压缩（D-002；backend/session-manager 双守卫）。
- **NG-03**：cursor 压缩（无通道，caps=false）。
- **NG-04**：压缩边界事件透传与压缩摘要内容展示（claude compact_boundary 帧、pi compaction_* 事件维持现状丢弃/吸收——Grill X-f 证实现有通道不可行，呈现改由 FR-07 响应回执承载；摘要文本留在引擎会话内）。
- **NG-05**：不改环分子口径与分母链。
- **NG-06**：自定义压缩指示输入框（pi customInstructions 通道预留不透传）。
- **NG-07**：会话流系统提示行呈现（Grill X-f 否决，见 FR-07）。

## 拆分判断

caps 键 → backend 端点（双分路）→ daemon 控制链（pi/codex）→ 前端按钮为同一条功能链；单变更一次贯通，走 large 四件套。

## 总体方案

### Wave A — caps 第 12 键三端贯通（FR-01）

样板照 ctx_usage 第 11 键八步（Grill X-e 核对通过）：providers.ts 接口/表（claude/pi/codex=true、cursor=false）/回退 + gen-provider-caps.mjs（CAPS_KEYS + 双端模板接口体/回退 + 「12 键」文案）+ 跑生成 + alignment EXPECTED+len==12×2 + provider-registry twelveKeys + pre-session-picker 两 toEqual + provider-adapter-registry 注释。

### Wave B — backend 端点（FR-02）

1. `session_crud.py` 新端点：SessionDep + TaskRunAgentUser（同 inject 口径）；service 层：归属/caps/状态三校验 → 分路：
   - claude：调既有 inject 服务（prompt="/compact"）→ 映射 `{accepted, provider, run_id, queued}`；捕获 DaemonSessionTurnConflict → error 映射（P1-1）。
   - pi/codex：`ws_hub.send_rpc(runtime 对应 daemon_id, 'session_compact', {session_id}, timeout=15)` → RPC result（CompactResult dict）→ 映射 `{accepted, provider, tokens_before?, estimated_tokens_after?, error?}`；DaemonRpcTimeout/Offline/RemoteError → 对应 error 文案。
2. schema.py：`SessionCompactRequest`（custom_instructions 预留）/`SessionCompactResponse`；`pnpm gen:types`。
（v3：无需 protocol.py 常量与 control_commands.py KIND——RPC 通道零新协议常量。）

### Wave C — daemon RPC handler 与 driver（FR-04/05）

1. daemon.ts：`ws.registerRpcHandler('session_compact', handler)`（挂进既有注册组 :6438 附近，同 list_dir 形态）→ handler 校验 session_id → `sessionManager.compact(sessionId)` → 返回 CompactResult 对象（即 RPC result）；session 不存在/异常 → throw（backend 收 RemoteError）。
2. `driver.ts`：`InteractiveDriver` 加可选 `compact?(handle): Promise<CompactResult>`（可选方法先例 :221 close?()）+ `CompactResult {ok, tokensBefore?, estimatedTokensAfter?, error?}`。
3. session-manager 新 `compact()`：守卫 status ∈ {running, reconnecting} 拒绝 + ended/failed 拒绝 + driver 无 compact 方法/caps false 拒绝 → 调 driver.compact 返回结果。
4. `PiRpcDriver.compact()`：`_sendCommand({"type":"compact"})` 等 response → CompactResult（回执数字）；超时 10s 返回 error。
5. `CodexAppServerDriver.compact()`：**新增 id→pending response 等待机制**（handle 加 pending map，response 分支按 id resolve——pi 先例移植，复审 X-c 如实标注新代码并配测试）→ 发 `thread/compact/start {threadId: h.threadId}` 等 response（空对象=受理，ok=true 无数字）。
6. claude：**daemon 零改动**（backend 直接走 inject）。
（v3：无 protocol.ts 新消息类型、无控制三点接线、control-dispatcher.ts 零改动——RPC 注册一处。）

### Wave D — 前端（FR-06/07）

1. `ctx-usage-bar.tsx`：CtxUsageRingProps 加 `onCompact?/compactDisabled?/compactTooltip?`（提供 onCompact 且 caps.compact 才渲染按钮行；antd Button disabled + tooltip）；CtxUsageBar 透传。
2. `session-panel-page.tsx`：`useSessionCompact` mutation（成功按响应分型通知：pi 带数字/codex 受理/claude 已发送；失败 notify error + 响应 error 文案如 pi "Nothing to compact"）；`compactDisabled = running`（:1451 现成派生）；预会话不传；dialog 版面板同款。
3. `lib/daemon/sessions.ts`：`compactSession()` → POST compact。
4. vitest：caps false 不渲染 / running 禁用 / 点击调用与三型通知。

### Wave E — 验证（FR-08）

1. daemon vitest：session-manager compact 四守卫 + pi/codex driver compact（命令形态/回执/超时）+ codex pending map 机制单测 + caps 守护。
2. backend pytest：端点鉴权/caps 拒绝/状态拒绝/claude 分路复用 inject 断言/pi-codex 分路控制派发与结果轮询（含超时）/DTO。
3. frontend vitest：按钮三分支 + API 客户端。
4. 真机：三引擎各压一轮（FR-08 三验点）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/interactive/providers.ts | ProviderCaps 第 12 键 compact（FR-01） |
| 修改 | sillyhub-daemon/scripts/gen-provider-caps.mjs | CAPS_KEYS + 双端模板 + 12 键文案（FR-01） |
| 修改 | frontend/src/lib/provider-caps.ts | @generated 重生成（FR-01） |
| 修改 | backend/app/modules/agent/provider_caps.py | @generated 重生成（FR-01） |
| 修改 | backend/app/modules/agent/tests/test_provider_caps_alignment.py | EXPECTED + len==12 ×2（FR-01） |
| 修改 | sillyhub-daemon/tests/interactive/provider-registry.test.ts | 契约键清单 12（FR-01） |
| 修改 | frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx | 两处 toEqual 补 compact（FR-01） |
| 修改 | sillyhub-daemon/tests/provider-adapter-registry.test.ts | 键数注释（FR-01） |
| 修改 | backend/app/modules/daemon/router/session_crud.py | POST /sessions/{id}/compact 双分路（claude=inject 复用+冲突映射 / pi·codex=ws RPC，FR-02） |
| 修改 | backend/app/modules/daemon/router/__init__.py | _ENDPOINT_ORDER 表加 compact_session（执行期机械必改：import 期硬校验不变量，不加则 daemon 全测试崩——task-02 review 留痕） |
| 修改 | backend/app/modules/daemon/schema.py | CompactRequest/Response DTO（FR-02） |
| 新增 | NEW:backend/app/modules/daemon/session/service/compact.py | compact 服务：三校验 + claude 复用 inject_session + pi/codex ws RPC 派发与结果映射（FR-02/03，照 inject.py 先例落点） |
| 修改 | backend/openapi.json + frontend/src/lib/api-types.ts | gen:types 产物（新端点） |
| 修改 | sillyhub-daemon/src/daemon.ts | registerRpcHandler('session_compact') 挂进既有注册组 → sessionManager.compact（FR-02 daemon 侧，v3 单点） |
| 修改 | sillyhub-daemon/src/interactive/driver.ts | InteractiveDriver 可选 compact?() + CompactResult（FR-02 契约） |
| 修改 | sillyhub-daemon/src/interactive/session-manager.ts（+子模块） | compact()：running/reconnecting/ended/failed/非 caps/driver 无方法六守卫 + 分派 + 结果 ack（FR-02/04/05） |
| 修改 | sillyhub-daemon/src/interactive/pi-rpc-driver.ts | compact()：_sendCommand + 回执 + 超时（FR-04） |
| 修改 | sillyhub-daemon/src/interactive/codex-app-server-driver.ts | compact() + **新增 id→pending response 等待机制**（FR-05，新代码配测试） |
| 修改 | frontend/src/lib/daemon/sessions.ts | compactSession()（FR-06） |
| 修改 | frontend/src/components/sessions/ctx-usage-bar.tsx | onCompact/compactDisabled/compactTooltip props + 按钮行（FR-06） |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | useSessionCompact + running 禁用 + 挂载（FR-06/07） |
| 修改 | frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx | 按钮三分支用例扩展（caps false 不渲染/running 禁用/点击调用） |
（dialog 版面板无 ctx 环挂点不改造——plan-review 核实 dialog 用 SessionUsageBar 非 CtxUsageBar，v1 page-only）
| 修改 | docs/agent-provider-onboarding.md | compact 能力接入指引（可选 driver 方法 + caps 键 + 三分路形态）（收尾） |
| 新增 | NEW:sillyhub-daemon/tests/interactive/session-compact.test.ts | 守卫与分派测试 |
| 修改 | sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts | compact() 命令形态/回执/超时断言 |
| 修改 | sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts | compact() + pending response 机制断言 |
| 新增 | NEW:backend/app/modules/daemon/tests/test_session_compact_endpoint.py | 端点三校验/双分路/异常映射断言 |

**字段数据流标注**：①`POST /compact` 请求→响应：producer=前端 compactSession → backend service（三校验+分路）→ claude 路=inject 服务（建 run，`{accepted, provider, run_id, queued}`）；pi/codex 路=ws_hub.send_rpc(daemon_id, 'session_compact', {session_id}, timeout=15)（发 daemon:rpc 等 daemon:rpc_result）→ daemon registerRpcHandler → session-manager.compact → driver.compact → CompactResult 即 RPC result 回传 → 端点映射 `{accepted, provider, tokens_before?, estimated_tokens_after?, error?}` → gen:types 进 api-types.ts → 前端通知。②caps `compact` 键：providers.ts 单源 → gen 脚本 → frontend 按钮门控 + backend 端点 caps 校验。③claude `/compact` 轮：前端按钮 → inject 通道（既有全链零新增）→ SDK slash 处理 → 既有 turn/run 生命周期。④环回落：压缩后下一次调用 usage → 既有 ctx_tokens 链（零改动）。

## 接口定义

```ts
// driver.ts（可选契约，cursor 不实现即不支持）
export interface CompactResult {
  ok: boolean;
  tokensBefore?: number;        // pi 回执
  estimatedTokensAfter?: number; // pi 回执
  error?: string;
}
export interface InteractiveDriver {
  // …既有…
  /** 上下文压缩（turn 空闲态；caps.compact=true 的引擎实现）。 */
  compact?(handle: InteractiveDriverHandle): Promise<CompactResult>;
}

// providers.ts ProviderCaps 追加（第 12 键）
compact: boolean;

// frontend ctx-usage-bar.tsx CtxUsageRingProps 追加
onCompact?: () => void;
compactDisabled?: boolean;
compactTooltip?: string;
```

```python
# backend schema.py
class SessionCompactRequest(BaseModel):
    custom_instructions: str | None = None  # v1 预留不透传
class SessionCompactResponse(BaseModel):
    accepted: bool
    provider: str
    run_id: str | None = None        # claude 路（inject 形态）
    queued: bool | None = None       # claude 路
    tokens_before: int | None = None      # pi 路
    estimated_tokens_after: int | None = None  # pi 路
    error: str | None = None
```

## 生命周期契约表

生命周期契约：无/N/A（pi/codex 为纯瞬时控制命令零状态迁移；claude 完整复用既有 inject→turn→run 生命周期语义（run 由 inject 服务既有流程创建），无新增迁移或字段语义变化；D-002 守卫为入口前置校验非状态机变更）。

## 数据模型

无 schema 迁移（结果回传走 ws RPC 通道零存储；caps 为内存常量+生成产物；claude 压缩轮复用既有 run 表）。

## 兼容策略（brownfield 必填）

- **旧 daemon**：未注册 'session_compact' handler → RPC 远端错误 → DaemonRpcRemoteError 映射响应 error「daemon 未支持压缩，请升级 daemon」；daemon 离线 → DaemonRuntimeOffline「daemon 离线」；15s 无响应 → DaemonRpcTimeout「daemon 未响应压缩命令」（send_rpc 异常三态齐备 backend/app/modules/daemon/ws_hub.py:502-560）。
- **cursor/未知引擎**：caps.compact=false → 前端不渲染按钮 + backend 端点拒绝（caps 校验）+ session-manager 守卫三道防线。
- **不改变的 API/表结构**：既有 inject/queue 端点与语义零变化（claude 分路是调用方复用非修改）；AgentEvent schema 零改动（NG-04 不透传）；环链零改动。
- **压缩失败**：pi/codex driver 返回 error（超时/引擎报错如 "Nothing to compact"）→ 控制结果 → 端点响应 error → 前端通知原文呈现；会话与环状态不受影响。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | claude `/compact` 经 SDK 注入实测（官方文档口径成立仓内无锚点；v1.0.58 slash bug 已修） | P1 | Wave E 真机首验；不生效则 claude caps 降 false（按钮消失），通道问题留后续 |
| R-02 | pi compact 与 driver 收敛时序（compact 先 abort；空闲守卫已前置，但异常态时序未验） | P1 | 空闲守卫 + compact 只等命令 response 不等 settled + 10s 超时降级 + 真机验证 |
| R-03 | codex 参数命名（开源宏 snake_case vs TS schema camelCase）与空闲前置条件未验证 | P1 | 按 driver 现用 camelCase 先试（turn/start 同形成立）；错误响应如实回传；真机验证 |
| R-04 | （v3 已消）结果回传定案 ws RPC（send_rpc/registerRpcHandler 先例现成）；残余：RPC handler 与 turn 状态竞态（handler 执行时恰起跑） | P2 | session-manager.compact 内守卫为最终防线（RPC 到达再检一次）；窗口极窄且后果=压缩被拒重试即可 |
| R-05 | 压缩期间用户发消息（pi isCompacting 窗口） | P2 | v1 不特殊处理，真机确认如实呈现；必要时二期禁用窗口 |
| R-06 | codex pending map 新机制引入回归面（response 分支按 id 分流的侵入性） | P2 | 独立单测（与既有 fire-and-forget 路径隔离）+ 既有 codex 套件全绿兜底 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | NG-01（自动压缩二期）；FR 全集仅手动 | 已覆盖 |
| D-002@v1 | FR-02 backend 状态校验 + FR-06 前端禁用；NG-02 | 已覆盖 |
| D-003@v2 | 总体方案 Wave A-E（claude=backend inject 复用建 run / 呈现=响应通知）；supersedes v1 task_notification 呈现（X-f 否决）与 driver 内 claude 入队（X-a 定案 backend 分路） | 已被 v3 取代（回传机制部分） |
| D-003@v3 | pi/codex 结果回传定案 **ws RPC**（send_rpc + registerRpcHandler 先例实证，复审 P0-3 修复）：砍 SESSION_COMPACT 控制机器三件套，无 schema 迁移/control-dispatcher 零改动为真 | 已覆盖 |
| D-004@v1 | FR-07（v2）：呈现=端点响应回执 + 前端通知三分型；claude 流可见性=/compact 轮本身；NG-04/NG-07 | 已覆盖 |

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本 D-001@v1/D-002@v1/D-003@v2/D-004@v1
- [x] 生命周期关键词命中 → 紧邻豁免短语「生命周期契约：无/N/A」+ 括注（claude 复用既有 run 生命周期；pi/codex 瞬时命令）
- [x] UI 原型分级核对：跳过——环浮层内一行按钮（组件级局部增量；用户 step 5 已确认）
- [x] 复审 P0-3 已闭环：结果回传定案 ws RPC（send_rpc/registerRpcHandler 先例实证），v2 控制机器三件套全弃用；P1-1 DaemonSessionTurnConflict 映射补入 FR-02
- [x] Grill v1 两 P0 已闭环：X-f→FR-07 响应回执呈现（NG-07 记否决）；X-a→D-003@v2 claude=backend inject 分路（run 归属明确）；P1 三项（清单补两文件/三点接线/reconnecting）全部吸收；codex pending map 如实标注（R-06）；claude compact_boundary 数字事实已修正（背景节）
