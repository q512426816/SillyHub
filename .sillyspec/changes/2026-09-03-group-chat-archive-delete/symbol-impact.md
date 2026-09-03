---
author: qinyi
created_at: 2026-09-03 17:20:00
---
# 符号影响面报告（Symbol Impact）— 群聊归档与删除

> 结论总览：全部签名级变更均为**新增符号或带默认值的可选参数扩展**，无破坏性
> 变更；受影响调用点全部在任务范围内或经默认值天然兼容。

| task | 签名级变更 | 类型 | 受影响调用点 | 是否在范围内 |
|---|---|---|---|---|
| task-01 | `AgentGroupChat.archived_at: datetime \| None` 新字段 | ORM 列新增 | 无直接调用点（读体经 from_attributes 序列化）；`GroupChatRead` 消费 | 是（本卡加 model+schema） |
| task-01 | `GroupChatRead.archived_at: datetime \| None = None` | DTO 字段新增（可选） | `GroupChatListItemRead` / `GroupChatDetailRead` 继承自动携带；前端 api-types 再生成（task-05） | 是 |
| task-02 | `GroupChatService._get_group_locked(group_id)` 新私有方法 | 方法新增 | 仅本卡三新方法调用；既有 `_get_group` 零改动 | 是 |
| task-02 | `GroupChatService.archive_group/unarchive_group/delete_group` 新方法 | 方法新增 | task-03 router 调用（范围外签名消费者已列入 task-03 allowed_paths） | 是 |
| task-02 | `list_groups(user, *, archived: bool \| None = False)` | keyword-only 可选参数（带默认值 False） | 唯一既有调用点 group/router.py:219 `svc.list_groups(user)`——位置参数兼容，不传 archived 走默认（行为=仅未归档，与会话侧默认一致） | 是（router 在 task-03 范围） |
| task-02 | 影子日志解析分支补 `deleted_at IS NULL` 过滤 | 查询谓词变更（非签名） | `get_group_accessible_session` 群分支（group/service.py:1688-1702）行为收窄：已删群 → 404 | 是（design §5.2 旁路封堵） |
| task-03 | `POST /group-chats/{id}/archive`、`POST /{id}/unarchive`、`DELETE /{id}` | 端点新增 | 前端 task-05 lib 函数消费 | 是 |
| task-03 | `GET /group-chats` 加 `archived: bool \| None = Query(default=False)` | 查询参数新增（带默认值） | 既有三消费点无参调用（session-list-panel:818 / mobile-session-list:245 / group-chat-panel:767）——默认 False 行为「仅未归档」，存量群 archived_at 恒 NULL → 返回集不变，零回归 | 是（回归锚点 create-group-wizard.test.tsx 在 task-05 范围） |
| task-04 | 纯测试卡 | 无签名级变更 | — | — |
| task-05 | `listGroupChats(opts?: { archived?: boolean \| null })` | 可选参数扩展（undefined=不传） | 三处无参调用点零改动；apiFetch 调用形态不变（无 opts 时不拼 query） | 是 |
| task-05 | `archiveGroupChat/unarchiveGroupChat/deleteGroupChat` 新函数 | 函数新增 | task-06 portal 回调消费 | 是 |
| task-06 | `SessionListPanel` 新可选 props `onArchiveGroup/onUnarchiveGroup/onDeleteGroup`；`GroupChatSection/GroupChatRow` 透传 props + `isArchivedView` | 组件 props 可选扩展 | 唯一消费点 sessions-portal.tsx（同卡范围）；悬浮助手等其它消费点未传新 props → 零渲染零行为变化 | 是 |
| task-07 | 纯测试卡 | 无签名级变更 | — | — |
