---
author: qinyi
created_at: 2026-09-03 17:10:00
---
# 模块影响分析（Module Impact）— 群聊归档与删除

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| backend:agent-model | 修改 | AgentGroupChat 加 archived_at 可空时间戳列（与 ended_at/deleted_at 正交，模型注释预告语义的首次消费） |
| backend:agent-schema | 修改 | GroupChatRead 暴露 archived_at（列表项/详情读体经继承自动携带） |
| backend:daemon-group-service | 修改+新增 | archive_group/unarchive_group/delete_group 三方法（_get_group_locked 行锁 + 群主/admin 双门 + 幂等 + SSE 信号）；delete 复用 end_group 收口链 + 群行/群时间线会话双置软删 + 影子日志解析分支旁路封堵；list_groups archived 三态过滤 |
| backend:daemon-group-router | 修改+新增 | POST /{id}/archive、POST /{id}/unarchive、DELETE /{id} 三端点（204）+ 列表 archived Query（HTTP 默认 False 防泄漏） |
| backend:daemon-group-tests | 修改+新增 | test_group_chat_management.py 增补归档/删除/过滤/权限/SSE/旁路封堵用例 |
| frontend:lib-daemon | 修改 | archiveGroupChat/unarchiveGroupChat/deleteGroupChat 三函数 + listGroupChats archived 参数（向后兼容） |
| frontend:group-chat-panel | 修改 | presence 查询显式 archived:null（已归档群绿点不回归） |
| frontend:sessions-list-panel | 修改 | 群行 hover 三操作 + 已归档徽标/降调 + 归档视图数据源（queryKey 视图维度、「＋」隐藏）+ Modal/toast |
| frontend:sessions-portal | 修改 | 群回调接线（invalidate ["groupChats"] + 清选中态） |
| frontend:sessions-tests | 修改+新增 | session-list-panel.test.tsx 增补 + create-group-wizard.test.tsx 回归锚点 |

## 未匹配文件

| 文件 | 处置说明 |
|---|---|
| backend/migrations/versions/20260903170000_add_group_chat_archived_at.py | 新增迁移，task-01 创建（versions 目录） |
| backend/openapi.json、frontend/src/lib/api-types.ts | 生成物，task-05 跑 pnpm gen:types 再生成，不手改 |
| frontend/src/components/mobile/mobile-session-list.tsx | 零改动——HTTP 默认 False 使无参调用天然只看未归档群（design §8） |

## 关联任务

task-01（数据层）、task-02（service）、task-03（router）、task-04（后端测试）、task-05（前端类型与 lib）、task-06（前端交互）、task-07（前端测试）。

## 更新结果

| 目标 | 操作 | 状态 |
|---|---|---|
| （首版于 plan 阶段生成；execute/verify 阶段更新，archive 终审） | — | — |
