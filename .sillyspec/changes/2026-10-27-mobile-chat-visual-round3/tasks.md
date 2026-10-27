---
author: flow-machine-draft
created_at: 2026-10-27T02:41:29.576Z
---
# 任务注册表（Tasks）— 2026-10-27-mobile-chat-visual-round3

- [x] task-01: RoundDivider mobile 单行不折行：mobile 分支不渲染 detail(开始时刻/历时,最次要)且胶囊 nowrap+truncate 超长省略,desktop 形态不变
- [x] task-02: SessionPanel mobile 头部标题左侧加返回按钮(ChevronLeft)：有 workspace_id 跳 /m/workspaces/{wid}/sessions,无则 /m/workspaces;desktop/dialog/悬浮宿主零变化
- [x] task-03: mobile 会话列表卡行首加 PC 同款状态标：消费 session-list-panel 导出纯函数 sessionStatusIndicator(status,liveness null,completedUnread false,runStatus undefined,pendingDialogKind=pending_requests[0].kind)——红点失败/绿点完成/问号待答/其余留白,与 PC 单一源同款
- [x] task-04: 相关测试面全绿(round-divider/session-panel-variant/page.m-sessions/mobile-session-list 零回归)
