---
author: flow-machine-draft
created_at: 2026-10-23T02:21:05.382Z
---
# 提案书（Proposal）— 2026-10-23-askuser-history-live-sync

## 动机

任务原话转写：AskUser 问答历史实时回显（用户实测 bug 修复）

动机：dialogHistory（问答历史，驱动对话/进度视图内容流穿插渲染）仅在 sessionId 变化时 REST 拉取一次；SSE permission_request（提问到达）与 permission_resolved（回答收口）均不更新它——待答卡原在时间线内容流内可见时该缺口被掩盖，2026-10-22-askuser-dock-inputbar 迁至输入框位置后完全暴露：用户实测提问/回答均不实时回显到对话与进度内容，需刷新页面才显示。修复：page 与 dialog 两挂载点在两个 SSE 回调处重拉 dialogHistory（序号防乱序覆盖）。

成功标准：
- SSE permission_request（dialog_kind 存在）到达时，对话与进度内容流实时出现该提问记录（无需刷新页面）
- SSE permission_resolved 到达时，对应问答记录实时更新为已答态（答案/答题人来自后端落库数据），待答卡同步移除
- session-panel-page 与 session-panel-dialog 两挂载点同款行为
- 重拉并发防乱序（仅最新一次拉取结果生效）
- 受影响测试全绿，tsc 零错

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. SSE permission_request（dialog_kind 存在）到达时，对话与进度内容流实时出现该提问记录（无需刷新页面）
2. SSE permission_resolved 到达时，对应问答记录实时更新为已答态（答案/答题人来自后端落库数据），待答卡同步移除
3. session-panel-page 与 session-panel-dialog 两挂载点同款行为
4. 重拉并发防乱序（仅最新一次拉取结果生效）
5. 受影响测试全绿，tsc 零错

## 成功标准（可验证）

1. SSE permission_request（dialog_kind 存在）到达时，对话与进度内容流实时出现该提问记录（无需刷新页面）
2. SSE permission_resolved 到达时，对应问答记录实时更新为已答态（答案/答题人来自后端落库数据），待答卡同步移除
3. session-panel-page 与 session-panel-dialog 两挂载点同款行为
4. 重拉并发防乱序（仅最新一次拉取结果生效）
5. 受影响测试全绿，tsc 零错
