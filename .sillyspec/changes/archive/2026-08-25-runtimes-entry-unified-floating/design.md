---
author: qinyi
created_at: 2026-08-25 15:30:00
scale: large
risk_level: unit-sufficient
# 风险等级声明：纯前端变更（frontend/src 8 改 3 删），零 backend/daemon 进程侧
# 改动；daemon/backend/lease/agent_run/session 关键词来自模块名与既有能力引用
# （listAgentSessions runtime_id 过滤参），非跨进程/状态机改动。证据等级=vitest
# 组件/存储测试 + tsc 回归，无真实集成证据需求。
---
# 设计文档（Design）— /runtimes 会话入口统一为智能会话助手（锁定 runtime）+ 抽屉列表换工作区树

生命周期契约：无/N/A——本变更纯前端交互重组，零 lease/agent_run/daemon 生命周期事件与状态迁移改动，零 backend/daemon 协议改动。

## §1 背景与问题

`/runtimes` 机器卡上的「会话」按钮目前打开 `RuntimeSessionDialog`（`frontend/src/components/daemon/runtime-session-dialog.tsx`）：左侧 `SessionListLayout` 紧凑列表（仅标题+状态+提供方·轮数+时间，无边框贴边），右侧 `SessionPanel mode="dialog"`。2026-08-25-unified-floating-session 已上线全局悬浮「智能会话助手」（`FloatingSessionHost`），但：

1. /runtimes 入口仍走旧弹窗，与悬浮助手形态割裂（同一业务两个入口两种 UI）。
2. 悬浮助手抽屉左侧是「最近 10 条」扁平列表，与 `/sessions` 页的工作区树（搜索+两层筛选+分组+紧凑两行条目+批量操作）样式/能力不一致——用户要求对齐。

## §2 需求（用户已拍板）

- **FR-01**：/runtimes 某 runtime 点「会话」→ 唤起全局悬浮会话助手（不再渲染 RuntimeSessionDialog），抽屉头部出现「🔒 {机器名} · {智能体}」锁定徽标。
- **FR-02**：抽屉左侧列表只看当前 runtime 的会话（跨工作区按组展示）；新建会话钉死该 runtime（不可换机器/换智能体，不再弹 PreSessionPicker 两步浮层兜底）。
- **FR-03**：抽屉左侧列表换成 /sessions 页同款工作区树 `SessionListPanel`——搜索（回车应用）/状态下拉/机器+智能体两层筛选 tab（锁定态）/分组手风琴/机器小节/紧凑两行条目/归档/批量删除/展开记忆全保留。
- **FR-04**：抽屉加宽至约 960px（树 320px + 面板自适应），给全功能树留足空间；`tailwind md:` 断点是视口级非容器级——树嵌入抽屉用固定列宽 grid，**不用**响应式前缀（知识库坑：侧栏内嵌禁 md:）。
- **FR-05**：`?session=` URL 恢复保持可用——打开抽屉并选中该会话（若其 runtime 与来源 runtime 一致则进锁定态，否则按全局态打开）；不再有「弹窗默认态 attach」行为。

## §3 方案（用户选定方案A：全树复用 + runtimeId 锁定）

### 数据流

```
/runtimes RuntimeCard「会话」 onOpenSession(runtime)
  → page.handleOpenSession(runtime)
     useFloatingSessionStore.openRuntimeSession({
       runtimeId: runtime.id,          // 新增壳态字段
       machineLabel, providerLabel      // 仅展示用
     })
       → open=true, minimized=false, sessionId=null,
         preContext=null, lockedRuntime={id, machineLabel, providerLabel}

FloatingDrawerBody
  ├─ 头部：lockedRuntime && <锁定徽标>
  ├─ 左栏：SessionListPanel scope={ kind:"runtime", runtimeId }   ← 新增 scope 变体
  │        onNewInGroup 被禁（锁定态新建走顶部唯一入口）
  ├─ 右栏：sessionId ? SessionPanel(mode="page")
  │        : preContext ? SessionPanel(mode="page", preContext={runtimeId 钉死})
  │        : 空态「新建会话开始提问」按钮 → startPreSession({runtimeId, workspaceId:null})
  └─ 新建按钮：lockedRuntime 时直接 startPreSession（不弹 PreSessionPicker）
```

### 关键改动点

| # | 文件 | 改动 |
|---|---|---|
| 1 | `frontend/src/stores/floating-session.ts` | 壳态 +`lockedRuntime: {id; machineLabel; providerLabel} \| null`；+`openRuntimeSession(lock)` action（open+清 sessionId/preContext）；`closeDrawer`/`selectSession`/`startPreSession`/`preSessionCreated` 时**不自动清 lockedRuntime**（锁定随抽屉关闭经 `closeRuntimeLock` 或下次 openRuntimeSession 覆盖） |
| 2 | `frontend/src/components/sessions/session-list-panel.tsx` | `SessionListScope` 联合 +`RuntimeScope = { kind:"runtime"; runtimeId: string }`；`listAgentSessions` 查询条件 +`runtime_id`（后端端点已支持该过滤参——复用 D-003@v2 机制）；runtime scope 下分组逻辑不变（仍按 workspace_id 分组），组头「＋」禁用（锁定态新建归宿主头部按钮） |
| 3 | `frontend/src/components/floating/floating-session-host.tsx` | ①抽屉宽 `max-w-[620px]`→`w-[min(960px,92vw)]`；②左栏 CompactSessionList 替换为 `SessionListPanel scope=runtime`（lockedRuntime 时）或保持原紧凑列表（无锁时——**v1 决策：无锁也换树，三入口零分叉**，与 ql-20260823-003 用户「三入口一致」裁决对齐）；③头部 + 锁定徽标；④新建按钮：lockedRuntime → 直接 `startPreSession({runtimeId, workspaceId:null})`；⑤右栏 SessionPanel 的 preContext 携带锁定 runtimeId |
| 4 | `frontend/src/app/(dashboard)/runtimes/page.tsx` | `handleOpenSession` 改为 `useFloatingSessionStore.getState().openRuntimeSession({...})`；删除 `dialogRuntime`/`initialSessionId` state + `RuntimeSessionDialog` 渲染 + `handleCloseDialog`/`clearSessionParam`（?session= 恢复改为 store.selectSession） |
| 5 | `frontend/src/components/daemon/runtime-session-dialog.tsx` | **删除**（死代码，ql 先例 quick 不能删文件——本变更走完整流程可删；若被删文件审计拦截则留空壳导出并标注 deprecated） |

### 互斥协议不变

pathname 命中门户三路由 → FloatingSessionHost 整体不渲染（含锁定态）。/runtimes 不在互斥清单，抽屉正常唤起。

### 非目标（Non-Goals）

- 不改 backend/daemon 任何协议与端点（`listAgentSessions` 的 `runtime_id` 过滤参为既有能力）。
- 不改 `SessionPanel` 内核（复用 mode="page"）。
- 不做悬浮↔门户会话迁移（v2 课题，沿用 2026-08-25-unified-floating-session §2.1 结论）。
- 不做 `ChangeSessionSection` 同款改造（change 详情页会话区保持现状）。

## §4 风险登记（Risk）

| 风险 | 对策 |
|---|---|
| SessionListPanel 嵌入 320px 抽屉列时 md: 视口断点失效致布局挤崩 | 已核实：session-list-panel.tsx 全文零 md:/sm:/lg: 前缀（grep 实证），树嵌入固定 320px 列安全；抽屉列宽用固定 grid 非响应式（知识库坑规避） |
| runtime_id 过滤参后端不支持 | 已核实：`AgentSessionListParams.runtime_id`（lib/daemon.ts:1669）+ `listAgentSessions` 真值下发（:1703）+ 后端 SQL 精确匹配（既有能力），零后端改动 |
| 删除 runtime-session-dialog.tsx 被 quick/change 审计拦截 | 完整流程允许删文件；若仍拦截，保留文件但改导出为空壳+@deprecated 注释 |
| ?session= 恢复与 lockedRuntime 不一致 | 恢复时校验会话 runtime_id===lockedRuntime.id，不一致则按全局态打开并清锁定 |
| 多 agent 并行改 session-list-panel.tsx | Edit 前重读最新态（CLAUDE.md 规则 16） |

## §5 测试策略

- vitest：
  - `floating-session.test.ts`：openRuntimeSession 置锁定+开抽屉；closeDrawer 保留锁定；startPreSession 携带锁定 runtimeId。
  - `floating-session-host.test.tsx`：lockedRuntime 时渲染锁定徽标 + SessionListPanel 收到 scope=runtime props；新建按钮不再弹 PreSessionPicker。
  - `session-list-panel.test.tsx`：scope=runtime 时查询带 runtime_id 参 + 组头「＋」不渲染。
  - `runtimes/page.test.tsx`：点「会话」按钮调 store.openRuntimeSession（不再渲染 RuntimeSessionDialog）。
- 回归：`pnpm -C frontend tsc` + 受影响目录既有测试（floating/sessions/runtimes 三组）。

## §6 自审（Self-Review）

1. **runtime scope 与 change scope 是否冲突？**——判别联合互斥，同一时刻仅一种 scope；宿主按 lockedRuntime 决定传 runtime scope，无叠加。
2. **无锁定时抽屉也换树是否超范围？**——用户要求「弹窗左侧会话列表按 /sessions 样式展示」，未区分有无锁定；且 ql-20260823-003 已有「三入口一致」先例裁决，统一换树避免再次分叉。锁定只是树的数据过滤+新建钉死，不改变树形态。
3. **SessionListPanel 数据量**：runtime scope 复用 limit=500 拉取+客户端分组，与全局同款，无新增后端压力。
4. **?session= 恢复简化是否丢功能？**——旧弹窗恢复=打开弹窗+attach；新恢复=打开抽屉+选中会话，语义等价且更统一（门户同款深链）。

## 文件变更清单（File Changes）

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/stores/floating-session.ts | +lockedRuntime/+openRuntimeSession/+closeRuntimeLock |
| 修改 | frontend/src/stores/floating-session.test.ts | 锁定壳态测试 |
| 修改 | frontend/src/components/sessions/session-list-panel.tsx | +RuntimeScope / runtime_id 过滤 / 组头＋锁定禁用 |
| 修改 | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | runtime scope 测试 |
| 修改 | frontend/src/components/floating/floating-session-host.tsx | 抽屉加宽/锁定徽标/左栏换树/新建钉死 |
| 修改 | frontend/src/components/floating/floating-session-host.test.tsx | 锁定渲染与新建行为测试 |
| 修改 | frontend/src/app/(dashboard)/runtimes/page.tsx | 按钮接线改 store，删 dialog 状态与渲染 |
| 修改 | frontend/src/app/(dashboard)/runtimes/page.test.tsx | 按钮行为测试改断言 store |
| 删除 | frontend/src/components/daemon/runtime-session-dialog.tsx | 死代码（旧弹窗） |
| 删除 | frontend/src/components/daemon/runtime-session-dialog.test.tsx | 随组件删除 |
| 删除 | frontend/src/components/daemon/__tests__/runtime-session-dialog-reconnect.test.tsx | 随组件删除 |
