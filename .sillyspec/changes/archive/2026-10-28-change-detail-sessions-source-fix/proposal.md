---
author: flow-machine-draft
created_at: 2026-10-27T20:44:07.964Z
---
# 提案书（Proposal）— 2026-10-28-change-detail-sessions-source-fix

## 动机

任务原话转写：变更详情会话区数据源错挂与附件标题修复：概览「会话」区实际取工作区全量最近会话而非该变更关联会话，用户看到无关会话以为是乱关联；附件开局会话标题显示 [附件:uuid 串不可读。

成功标准：
- 桌面变更详情概览「会话」区数据源改为 GET /changes/{id}/sessions（change_session_links 真实关联），不再取工作区全量会话
- 「绑定会话（审批结果将通知此会话）」显示同一关联源最新会话，与后端 _notify_bound_session 注入目标同源
- 会话区状态列显示中文标签（进行中/已结束等），不再裸显英文 active/completed
- 附件开局会话标题剥离 [附件:...] 内联标记后取首个非空文本，纯附件消息回退可读文案，不再显示 [附件:uuid 前缀
- 标题剥离在 change/agent/daemon 三处标题提取端点同步落地，口径一致
- 触及文件的相关测试通过（前端组件测试 + 后端三处标题测试），无 schema 改动故无需 gen:types

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. 桌面变更详情概览「会话」区数据源改为 GET /changes/{id}/sessions（change_session_links 真实关联），不再取工作区全量会话
2. 「绑定会话（审批结果将通知此会话）」显示同一关联源最新会话，与后端 _notify_bound_session 注入目标同源
3. 会话区状态列显示中文标签（进行中/已结束等），不再裸显英文 active/completed
4. 附件开局会话标题剥离 [附件:...] 内联标记后取首个非空文本，纯附件消息回退可读文案，不再显示 [附件:uuid 前缀- 标题剥离在 change/agent/daemon 三处标题提取端点同步落地，口径一致- 触及文件的相关测试通过（前端组件测试 + 后端三处标题测试），无 schema 改动故无需 gen:types

## 成功标准（可验证）

1. 桌面变更详情概览「会话」区数据源改为 GET /changes/{id}/sessions（change_session_links 真实关联），不再取工作区全量会话
2. 「绑定会话（审批结果将通知此会话）」显示同一关联源最新会话，与后端 _notify_bound_session 注入目标同源
3. 会话区状态列显示中文标签（进行中/已结束等），不再裸显英文 active/completed
4. 附件开局会话标题剥离 [附件:...] 内联标记后取首个非空文本，纯附件消息回退可读文案，不再显示 [附件:uuid 前缀- 标题剥离在 change/agent/daemon 三处标题提取端点同步落地，口径一致- 触及文件的相关测试通过（前端组件测试 + 后端三处标题测试），无 schema 改动故无需 gen:types
