---
id: task-03
title: 'backend router——POST /group-chats/{id}/archive、POST /{id}/unarchive、DELETE /{id} 三端点（204）+ 列表 archived Query（HTTP 默认 False）'
title_zh: 'backend router——归档/取消归档/删除三端点 + 列表 archived 三态过滤参数'
author: 'qinyi'
created_at: '2026-09-03 16:55:15'
priority: P0
depends_on: ['task-02']
blocks: ['task-04', 'task-05']
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05]
decision_ids: ['D-01@v1']
allowed_paths:
  - backend/app/modules/daemon/group/router.py
goal: >
  group router 挂三个薄端点（权限/业务全在 service，照 daemon/router.py:3236-3275
  会话三端点先例）+ 群列表端点加 archived 三态 Query 参数（HTTP 默认 False，
  design §4 有意分歧说明）。
implementation:
  - POST /{group_id}/archive → 204：await GroupChatService(session).
    archive_group(group_id, user)，docstring 注释照 archive_session 端点
    （daemon/router.py:3249-3262）风格，标注 2026-09-03-group-chat-archive-delete
  - POST /{group_id}/unarchive → 204：对称
  - DELETE /{group_id} → 204：软删（docstring 说明活跃群先 end 收口再双置位，
    权限归 service）
  - GET ""（list_group_chats）加 archived: bool | None = Query(default=False)
    透传 svc.list_groups(user, archived=archived)；注释锚定「默认 False 防三处
    无参消费点泄漏（design §4，会话侧 Query 默认 None 的教训前移）；显式 null
    =全量 admin debug」
  - 端点排序放在「群 CRUD」区（end_group 之后、成员管理之前），tags 不变
acceptance:
  - openapi.json 再生成后三端点 + archived 参数出现（task-05 消费）
  - 端点为薄层（无业务逻辑、无直接 ORM）
  - 204 语义与 pinned/read 等 204 端点一致
verify:
  - cd backend && uv run ruff check app/modules/daemon/group/router.py && uv run mypy app/modules/daemon/group/router.py
  - cd backend && uv run pytest app/modules/daemon/tests/test_group_chat_management.py -n auto（既有用例零回归）
constraints:
  - 端点薄层——权限/业务全在 service，禁止 router 内写 ORM/业务逻辑
  - archived Query 默认 False 是有意分歧（design §4），不得照抄会话侧默认 None
---
