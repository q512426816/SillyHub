---
schema_version: 1
doc_type: module-card
module_id: app-sessions-pages
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 智体会话门户页（app-sessions-pages）

## 定位
智能体会话门户页（`src/app/(dashboard)/sessions/page.tsx`，2026-08-22-workspace-sessions-portal 起薄壳化——仅渲染 `<SessionsPortal />`），路由 `/sessions`，跨工作区的会话总入口（一级菜单，2026-08-14-sessions-portal 落地）。2026-08-22-workspace-sessions-portal 起门户三入口统一：本页（全局 scope）+ `/workspaces/[id]/sessions`（workspace scope）+ `/workspaces/[id]/changes/[cid]/sessions`（change scope 新路由）三页均为 SessionsPortal 薄壳；左栏会话列表 + 右栏两态面板（未选 = 新建会话表单，选中 = `<SessionPanel mode="page">`）与页级数据注入全部在 SessionsPortal 内——SSE 实时流、注入排队、配置切换、权限弹窗、上下文用量全部下沉 components-daemon 的 SessionPanel。变更详情入口卡（change-sessions-card）经 `?session=` 深链直达本门户选中态。

## 契约摘要
- `SessionsPortalPage` 布局：左 320px `<SessionListPanel>`（筛选 + 虚拟滚动 + 紧凑两行条目，components-sessions）；右两态——
  - 未选会话：`<NewSessionForm>`（机器 / 档案 / 供应商 / 模型四选择器），`onCreated` 切入选中态。
  - 选中会话：`<SessionPanel mode="page">`（components-daemon 共享组件，key=sessionId 重挂载）：TurnTimeline + SessionInputBar + MessageQueueBar（排队条）+ CtxUsageBar + SessionConfigBar；发送统一入 useMessageQueue 队列（running/reconnecting 可输入排队，turn 完成自动投递，D-001~D-004）。
- 数据流：
  - 会话详情：`getAgentSession`（react-query，pending/reconnecting 态 1.5s 轮询；切换配置/结束/重开后 invalidate 刷新）。
  - 历史 turn：attach 时预取 `getAgentSessionLogs → logsToTurns` 先渲染（防 SSE 订阅前窗口期丢事件）。
  - 实时 turn：`streamSession` 单条 SSE 贯穿（turn_started / log / turn_completed / tokens / session_ended / permission_*，处理逻辑对齐 `interactive-session-panel.tsx`，即 /runtimes 弹窗）。
  - 发送 `injectSession`；结束/中断/重开 `endSession` / `interruptSession` / `reopenSession`；弹窗轮询 `fetchPendingDialogs` / `fetchSessionDialogHistory`。
- whoLine（每轮"谁在答"标注，gap-fix FR-07/D-008）：attach 时并发拉 `listSessionRuns`（run 级轮次快照），渲染按 `realRunId??runId` 匹配注入——profileName 取 `agent_profile_snapshot.name`、providerName 对照供应商列表（`llm_provider_id` null = 本机默认）、agentName 取 `config_snapshot.agent_name` / runtime 名兜底；快照缺键如实显示"未指定"不编造；每轮 turn_completed 后刷新快照，切换配置后的新轮跟随新快照、历史轮不跟随。
- 上下文用量（FR-08/R-06）：`CtxUsageBar` 累计 = 实时 turn input_tokens 前端求和；SSE 未覆盖的历史轮由 `run.input_tokens` 回填（`??` 链保序，实时 SSE 值优先）。
- 外围数据：机器列表 `useDaemonMachines`；供应商 `listProviders`（含 role mapping）。

## 关键逻辑
```
attach 序:  预取 logs → logsToTurns 立即渲染历史 → 再挂 SSE（续 cursor）
            （顺序颠倒会丢订阅前窗口期事件）
whoLine:    runs 快照按 turn 的 realRunId??runId 匹配注入；
            新轮跟新快照, 历史轮保持原样（D-008）
配置切换:   SessionConfigBar 点选即切换（无确认行）；空 prompt 切换
            静默化——不产生消息与模型回应（ql-20260817-009/010）
```

## 注意事项
- 弹窗（权限审批 / AskUser）不在本页重复实现，沿用 components-permissions / components-admin 既有通道；SSE 事件语义改动须评估 `interactive-session-panel.tsx` 同步。
- 会话行为（切换静默化、点选即切换）经多次 quick 迭代（ql-20260817-009/010），改注入/切换逻辑先查本页近期 change 记录。
- 面板本体已在 components-daemon/session-panel.tsx（本变更完成下沉）；本页只留外壳，新增会话能力优先改 SessionPanel 或下沉共享子组件，勿再往 page.tsx 堆逻辑。
- 路由在 DashboardLayout 工作区白名单内（平台级跨工作区视图）；SSE 走 `/api/daemon/sessions/[sessionId]/stream` 中继（app-api-routes）。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
