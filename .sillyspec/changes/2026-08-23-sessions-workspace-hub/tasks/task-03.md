---
id: task-03
title: 'session-panel-pre-session-mode'
title_zh: 'SessionPanel 预会话态（同构空态+守卫+首句创建）'
author: qinyi
created_at: 2026-08-23 04:52:00
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-101@v1, D-102@v1, D-104@v1]
allowed_paths:
  - frontend/src/components/daemon/session-panel.tsx
  - frontend/src/components/daemon/__tests__/
goal: >
  SessionPanel 支持 sessionId=null 预会话态：与真会话同构的空态聊天界面（用户硬约束"不要独立页面"），
  首句发送才 createSession 原地接管；SSE/查询/队列等副作用 effect 全部 null 守卫（R-01）。
implementation:
  - page 分支 :203 sessionId null 防御性 return null 改为渲染预会话空态（同面板头/空时间线"发送第一句话开始对话"/完整输入区含附件；顶部锁定上下文行 📂🖥⚡ 完全只读 D-104）
  - SessionPanelPage（:224）sessionId 窄化放宽 string | null
  - props 加 preContext?: SessionPreContext（design §7：workspaceId/changeId?/runtimeId；sessionId=null 必传；change 入口显式双传 X-13）
  - null 守卫清单（Grill X-04 逐项）：page detailQuery+refetchInterval 轮询（:428-436，不发 getAgentSession(null)）；page fetchPendingDialogs+fetchSessionDialogHistory 恢复 effect（:708-736，对齐 dialog 版 :2129/:2157 守卫）；SSE 建流 effect（useEffect 起 :523）不建流；useMessageQueue 激活/投递（先例 dialog ?? "" + sessionActive=false 不投递 :2279）；team missions/attach 轮询已有守卫（:302-315/:2048）回归验证
  - 首句创建链路（复用 dialog idle 先例 :2359-2421，两处改造 Grill X-02）：createSession 传 runtime_id（非 dialog 的 provider）；失败保留输入（dialog :2360 先清后建失败即丢——改为成功后才清空，失败内联错误+重试 R-02）；成功 session_id 就位状态机自然接管，onPreSessionCreated 回调父层（门户接线归 task-06）
acceptance:
  - 预会话态渲染与真会话同构（同结构断言：面板头/时间线容器/输入区均在，仅内容空+多上下文行）
  - R-01 专项测试：sessionId=null 时 detailQuery/getAgentSession/建流/dialogs 恢复/队列投递逐项零调用
  - 首句 createSession 参数含 runtime_id+prompt（+可选 workspace_id/change_id）；成功清空输入原地接管；失败输入保留+可重试
  - 上下文行不可编辑（无任何可交互元素）
verify:
  - pnpm exec vitest run src/components/daemon/__tests__/（新增 session-panel-pre-session.test.tsx + 既有 dialog 系列零回归）
  - pnpm typecheck
constraints:
  - 不动 dialog 模式行为（零回归）；不动 lib/daemon.ts 契约
---

# task-03 补充说明
守卫清单与复用链路改造点行号均经 Grill 独立审查源码核实（review-2026-08-23-041902 X-01/X-02/X-04）。
