---
author: WhaleFall
created_at: 2026-07-31T11:06:13
revised_at: 2026-07-31T11:11:20
scale: large
risk_level: unit-sufficient
revision_note: "Design Grill 反馈修订(B1 page.tsx 误读→无需改 / B2 dialog runtime stale→从 runtimes 重查 / B3 SSE 离线状态契约 / 行号修正 / RunErrorItem 已守卫)。risk_level=unit-sufficient:纯前端呈现改动,不改 daemon↔backend 集成/状态机(D-004 后端0改),前端组件测试+typecheck 足够验证,覆盖 session/daemon 关键词误判。"
---

# 设计文档（Design）— /runtimes 离线只读浏览会话

> 变更 `2026-07-31-offline-session-readonly` · 方案 A（panel 加 offlineReadOnly prop + active 保持只读态）

## 1. 背景

`/runtimes` 页面当 daemon/runtime **离线**时，会话功能整个看不见——用户无法进入会话界面查看历史会话与消息内容。

调研确诊根因（`frontend/src/components/daemon/runtime-card.tsx:90-92`）：

```ts
const canOpenSession =
  runtime.status === "online" &&
  (runtime.provider === "claude" || runtime.provider === "codex");
// line 242：{canOpenSession ? <会话按钮> : null}
```

离线时 `canOpenSession=false` → 会话按钮**不渲染**。这是"看不见"的唯一入口阻断（v1 误读 page.tsx URL 恢复已修正，见下）。

**关键事实**（离线只读其实已大半具备，均已核对源码）：
- 会话列表 `listAgentSessions`（backend `session/service.py:1318` / `router.py:1662`）、历史 `getAgentSessionLogs`（`session/service.py:1680` / `router.py:2065`）都是 **DB 查询**（`select(AgentSession)` / `AgentRunLog`，user_id 隔离，无 runtime online 检查）→ 离线本就能拉到数据。
- 发送链路已有 `!hasOnlineProvider` 守卫：`handleSend`（`interactive-session-panel.tsx:651`）、`handleResend`（`:726`，覆盖 RunErrorItem "重新发送"）、`sendingDisabled`（`:891-898`）。
- ended/failed 会话离线 reopen 失败已"静默降级只读历史"（`runtime-session-dialog.tsx:216-219`）。
- **page.tsx URL 恢复（`?session=`）已支持离线 runtime**：`page.tsx:789-808` 降级条件是 `matched === null`（runtime 不存在/已删除/不在当前页），**不是 matched 离线**——离线但存在的 runtime（matched 非空）已 `setDialogRuntime(matched)` 正常开弹窗。注释"已离线/删除"是泛指，非离线即降级。→ **本轮无需改动 page.tsx URL 恢复**（B1 修正）。

## 2. 设计目标

- 离线时 `/runtimes` 会话按钮仍可见可点 → 进入弹窗只读浏览**会话列表 + 历史消息**。
- 离线禁用需在线的操作：**新建会话、结束会话、打断、发送**（4 个；RunErrorItem 重新发送已守卫）。
- active（进行中）会话离线时**保持 active 只读态** + 顶部"运行时离线，只读浏览"提示 + 4 操作禁用；runtime 重连自动恢复可操作（不污染 status 机制）。
- **不改后端**（API 已 DB 查询离线可用）；**不波及 changes 页会话区**（共用 panel 用 prop 隔离）。

## 3. 非目标（Non-Goals）

- ❌ 不改后端 API / schema（列表/历史已 DB 查询）
- ❌ 不改 page.tsx URL 恢复（已支持离线 matched 开弹窗，B1）
- ❌ 不改 changes 页 `change-session-section`（共用 panel 通过 prop 隔离，默认行为不变）
- ❌ 不改 ended/failed 会话离线 reopen 降级逻辑（现有，符合只读语义）
- ❌ 不实现"离线编辑后重连同步"等新能力（YAGNI）
- ❌ 不改 daemon 侧（离线本身由心跳/状态机决定，本轮只改前端呈现）

## 4. 总体方案（方案 A）

InteractiveSessionPanel 加可选 `offlineReadOnly?: boolean` prop，**RuntimeSessionDialog 从实时 `runtimes` prop 重查 `runtime.status` 派生 `runtimeOffline`**（非 stale `runtime` prop，B2）传入。离线时 panel：顶部渲染离线横幅、4 操作按钮 disabled、active 态保持（不转 ended）、**attach 时不建 SSE 直接进只读态显示 initialTurns（B3）**。runtime-card 会话按钮离线仍显示。共享 panel 的 prop 默认不启用 → change-session-section 原行为不变。

### 4.1 各文件改动

**runtime-card.tsx**：`canOpenSession`（:90-92）放宽为 `provider === 'claude' | 'codex'`（去掉 `status === 'online'` 与运算）；离线时按钮（:242-252）title 改"运行时离线，点击只读浏览会话历史"，可加 `WifiOff` 图标 + 灰色调暗示只读（仍可点）。

**runtime-session-dialog.tsx**：派生 `runtimeOffline` —— **从实时 `runtimes` prop 重查**（dialog 收到 `runtimes={allRuntimes}` 实时，page.tsx:1075），而非 stale `runtime` prop（B2 修正）：
```ts
// runtime prop 是 page state 快照（setDialogRuntime 时设一次，不随 machines 轮询更新）；
// runtimes prop 是 allRuntimes 实时（machines 15s 轮询刷新）。从 runtimes 重查才能让重连生效。
const liveRuntime = runtimes.find((r) => r.id === runtime?.id);
const runtimeOffline = (liveRuntime?.status ?? runtime?.status) !== "online";
// 透传 panel：<InteractiveSessionPanel offlineReadOnly={runtimeOffline} ... />
```
列表 reload / 历史 logs / URL 恢复逻辑不变（DB 查询，离线照常）。

**interactive-session-panel.tsx**：
- 加 `offlineReadOnly?: boolean` prop（默认 undefined/false）。
- 顶部：`offlineReadOnly` 时渲染黄色横幅"⚠️ 运行时离线，当前为只读浏览（发送/打断/结束/新建已禁用），重连后自动恢复"。
- 4 按钮 disabled 统一加 `|| offlineReadOnly` 守卫（行号已核对）：新建会话（`:982`）、发送（按钮 `:1202`，走 `sendingDisabled:891-898`）、打断（`:1026`）、结束（`:1037`）。注：`:1001` 是 provider select 的 disabled（非发送，v1 张冠李戴已修正）。
- **RunErrorItem "重新发送"无需叠加**：走 `handleResend`（`:724`）已有 `!hasOnlineProvider`（`:726`）守卫，离线时 hasOnlineProvider 多半 false，已挡住（R3 闭环）。
- active 态保持：不因离线改 `view.status`；历史 `initialTurns`（DB logs）照常渲染。
- **SSE/attach 状态契约（B3）**：attach effect（`:444-461` 的 `establishStream`）加 `if (offlineReadOnly) return` 守卫跳过建流；跳过后 panel **直接以 initialTurns（DB logs）渲染只读态，不进 reconnecting 卡 15s 超时轮询**。离线 daemon 不会产生新增量，initialTurns 快照已足够展示历史；重连（offlineReadOnly→false）后 effect 重跑建 SSE 恢复实时。

**page.tsx**：**无需改动**（URL 恢复已支持离线 matched 开弹窗，B1）。

## 5. 文件变更清单（File Changes）

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/components/daemon/runtime-card.tsx | `canOpenSession` 去 online 与运算（:90-92），离线按钮仍渲染 + title/图标只读提示（:242-252） |
| 修改 | frontend/src/components/daemon/runtime-session-dialog.tsx | 从实时 runtimes 重查派生 runtimeOffline 透传 panel（B2，:145-164 附近） |
| 修改 | frontend/src/components/daemon/interactive-session-panel.tsx | 加 offlineReadOnly prop + 离线横幅 + 4 按钮 disabled（:982/:1202/:1026/:1037）+ attach 不建 SSE 直接只读（B3，:444-461） |
| 新增 | frontend/src/components/daemon/__tests__/*.test.tsx + runtimes/__tests__ | runtime-card 离线按钮渲染、dialog 离线只读、active 离线保持 + 重连恢复、change-session-section 回归 |

（page.tsx 不改：URL 恢复已支持离线。）

## 6. 接口定义

```ts
// interactive-session-panel.tsx —— 新增可选 prop
type InteractiveSessionPanelProps = {
  // ... 既有 props
  /** 运行时离线时只读模式：禁用 4 操作 + 顶部离线横幅 + attach 不建 SSE 直接只读。
   *  由 RuntimeSessionDialog 据（实时 runtimes 重查的）runtime.status !== 'online' 传入。
   *  change-session-section 不传（默认 false）→ 原行为不变。 */
  offlineReadOnly?: boolean;
};
```

## 7. 生命周期契约

生命周期契约：不涉及/N/A。本次只改 `/runtimes` 前端**离线呈现**（会话按钮显隐 + 弹窗只读态 + dialog 派生 offline），**不涉及 lease / session / agent_run / runtime 的状态机或状态转换**，不改心跳/lease 协议字段。active 会话离线"保持 active 只读"是纯前端 UI 态（不改后端 session.status）；runtime 重连后由既有心跳/状态（machines 轮询刷新 runtimes）驱动 dialog 重算 runtimeOffline → panel 自动切回在线态，不新增生命周期事件。

## 8. 风险登记（Risk）

- **R1（中）active 离线 SSE 断开**：缓解（B3）—— attach effect 加 `offlineReadOnly` 守卫跳过 `establishStream`，直接以 initialTurns（DB logs）只读渲染，不进 reconnecting 卡超时；离线 daemon 不产生新增量，快照够用。
- **R2（中）runtime 重连恢复**：缓解（B2）—— dialog 从**实时 `runtimes` prop** 重查 status 派生 runtimeOffline（非 stale `runtime` prop）；machines 15s 轮询刷新 runtimes → runtimeOffline 自动 false → panel 切回在线（去横幅 + 启用按钮 + attach effect 重跑建 SSE）。
- **R3（低，已闭环）RunErrorItem 重新发送**：走 `handleResend`（:724）已有 `!hasOnlineProvider`（:726）守卫，离线已挡住，无需叠加 offlineReadOnly。
- **R4（低）change-session-section 共用 panel**：prop 默认 false，change-session-section 不传（显式确认，:212-225）；回归测试。其自有 `hasOnlineProvider`（:107-118）是平行路径，离线时与 offlineReadOnly 语义一致不冲突。

## 9. 自审（Self-Review）

- ✅ 覆盖需求：离线看会话列表 + 历史（DB 查询本就可用）+ 禁用 4 操作 + active 保持只读重连恢复
- ✅ 改动集中：3 前端文件（runtime-card + dialog + panel）+ 后端 0 改动 + page.tsx 0 改动（B1）+ change-session-section prop 隔离
- ✅ 复用现有：列表/历史 DB API、ended/failed 离线降级、发送 !hasOnlineProvider 守卫（含 RunErrorItem）
- ✅ 不污染 status 机制（active 保持）
- ✅ 生命周期契约不涉及（纯前端呈现）
- ✅ Design Grill B1/B2/B3 已消化（page.tsx 无需改 / dialog runtimes 重查 / SSE 离线状态契约）
- ⚠️ 待 execute 确认：attach effect 跳过 establishStream 后 panel 状态机确切走向（应以 initialTurns 只读，不卡 reconnecting）；runtime 重连时序（machines 轮询 → runtimes 刷新 → runtimeOffline 翻转 → panel + effect 响应）

## 10. 决策与方案选择（Decision Tracking）

| 决策 ID | 标题 | 选项（✅采纳 / ❌否决） | 覆盖位置 |
|---|---|---|---|
| D-001@v1 | 离线只读实现：panel 加 offlineReadOnly prop（方案 A） | ✅ panel 加可选 prop + dialog 据 runtime.status 传入 + active 保持 + 4 按钮 disabled + attach 不建 SSE；❌ 方案 B（转 ended，status 污染）；❌ 方案 C（dialog 离线纯只读视图，重复实现） | §4、FR-01~03 |
| D-002@v1 | active 会话离线态：保持 active 只读 + 横幅（非转 ended） | ✅ 保持 active + 顶部横幅 + 重连无缝恢复；❌ 转离线只读态（重连需 reopen） | §4.1、FR-02 |
| D-003@v1 | 范围：只 /runtimes，共享 panel 用 prop 隔离 changes | ✅ runtime-card + dialog + panel（prop 默认 false，change-session-section 不传）；❌ 同步改 changes 页 | §3、§6、FR-04 |
| D-004@v1 | 后端 0 改动 | 列表/历史 API 是 DB 查询，离线本就可用 | §1、§3 |
| D-005@v1 | dialog 派生 runtimeOffline 从实时 runtimes 重查（非 stale runtime prop） | ✅ `runtimes.find(r=>r.id===runtime?.id)?.status`（实时，重连生效）；❌ 用 stale `runtime?.status`（重连后不翻转，R2 失效） | §4.1、§8 R2（Design Grill B2） |
