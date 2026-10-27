---
author: flow-machine-draft
created_at: 2026-10-27T02:41:29.576Z
---
# 提案书（Proposal）— 2026-10-27-mobile-chat-visual-round3

## 动机

任务原话转写：用户真机三轮反馈：轮次信息折行难看要单行；会话页顶部加返回会话列表按钮；会话列表卡加 PC 端同款状态提示标。

成功标准：
- RoundDivider mobile 单行不折行：mobile 分支不渲染 detail(开始时刻/历时,最次要)且胶囊 nowrap+truncate 超长省略,desktop 形态不变
- SessionPanel mobile 头部标题左侧加返回按钮(ChevronLeft)：有 workspace_id 跳 /m/workspaces/{wid}/sessions,无则 /m/workspaces;desktop/dialog/悬浮宿主零变化
- mobile 会话列表卡行首加 PC 同款状态标：消费 session-list-panel 导出纯函数 sessionStatusIndicator(status,liveness null,completedUnread false,runStatus undefined,pendingDialogKind=pending_requests[0].kind)——红点失败/绿点完成/问号待答/其余留白,与 PC 单一源同款
- 相关测试面全绿(round-divider/session-panel-variant/page.m-sessions/mobile-session-list 零回归)

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. RoundDivider mobile 单行不折行：mobile 分支不渲染 detail(开始时刻/历时,最次要)且胶囊 nowrap+truncate 超长省略,desktop 形态不变
2. SessionPanel mobile 头部标题左侧加返回按钮(ChevronLeft)：有 workspace_id 跳 /m/workspaces/{wid}/sessions,无则 /m/workspaces;desktop/dialog/悬浮宿主零变化
3. mobile 会话列表卡行首加 PC 同款状态标：消费 session-list-panel 导出纯函数 sessionStatusIndicator(status,liveness null,completedUnread false,runStatus undefined,pendingDialogKind=pending_requests[0].kind)——红点失败/绿点完成/问号待答/其余留白,与 PC 单一源同款
4. 相关测试面全绿(round-divider/session-panel-variant/page.m-sessions/mobile-session-list 零回归)

## 成功标准（可验证）

1. RoundDivider mobile 单行不折行：mobile 分支不渲染 detail(开始时刻/历时,最次要)且胶囊 nowrap+truncate 超长省略,desktop 形态不变
2. SessionPanel mobile 头部标题左侧加返回按钮(ChevronLeft)：有 workspace_id 跳 /m/workspaces/{wid}/sessions,无则 /m/workspaces;desktop/dialog/悬浮宿主零变化
3. mobile 会话列表卡行首加 PC 同款状态标：消费 session-list-panel 导出纯函数 sessionStatusIndicator(status,liveness null,completedUnread false,runStatus undefined,pendingDialogKind=pending_requests[0].kind)——红点失败/绿点完成/问号待答/其余留白,与 PC 单一源同款
4. 相关测试面全绿(round-divider/session-panel-variant/page.m-sessions/mobile-session-list 零回归)
