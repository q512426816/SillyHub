---
id: task-02
title: 'backend service——archive_group/unarchive_group/delete_group（_get_group_locked 行锁 + 幂等 + SSE 信号）+ delete 双置位与影子日志分支旁路封堵 + list_groups archived 三态过滤'
title_zh: 'backend service——归档/取消归档/删除三方法（行锁+幂等+SSE）+ 删除双置位与旁路封堵 + 列表三态过滤'
author: 'qinyi'
created_at: '2026-09-03 16:55:15'
priority: P0
depends_on: ['task-01']
blocks: ['task-03', 'task-04']
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05]
decision_ids: ['D-01@v1']
allowed_paths:
  - backend/app/modules/daemon/group/service.py
goal: >
  GroupChatService 新增归档/取消归档/删除三个服务方法（design §5），照
  archive_session/unarchive_session/delete_agent_session 逐段镜像：行锁取群、
  群主/admin 双门、幂等早退、SSE 列表信号；delete 复用 end_group 幂等收口链
  后对群行+群时间线会话双置 deleted_at，并封堵影子日志解析分支的软删旁路；
  list_groups 扩展 archived 三态过滤。
implementation:
  - 新增 _get_group_locked(group_id) 变体：同 _get_group 查询 + .with_for_update()
    （design §5.1——_get_group 现状无锁，group/service.py:1807-1822；仅归档/删除
    三方法使用，其余路径零改动）
  - archive_group(group_id, user)：_get_group_locked → _require_group_member →
    _require_group_owner → 已归档幂等早退（rollback 释放行锁 + return）→
    group.archived_at = now(UTC) → commit →
    _publish_group_sessions_changed(group, "status_changed")。已解散群不拒绝
    （ended_at 非空可归档，design §5.1）
  - unarchive_group(group_id, user)：对称清除 archived_at；未归档幂等早退；
    信号同 status_changed
  - delete_group(group_id, user)：_get_group_locked → 权限双门 →
    `await self.end_group(group_id, user)`（未解散走完整收口：end 影子+队列清理+
    群时间线 ended+群行 ended_at+session_ended 广播；已解散幂等早退直接回读，
    group/service.py:2462-2465）→ 重新 _get_group_locked 取最新行 →
    群时间线 AgentSession.deleted_at = now(UTC)（严格镜像
    delete_agent_session:6578 的会话行软删置位，封堵属主 GET /sessions/{id}
    旁路）→ group.deleted_at = now(UTC) → commit →
    _publish_group_sessions_changed(group, "deleted")
  - 旁路封堵（design §5.2 Grill X2）：get_group_chat_by_session 邻域
    （group/service.py:1688-1702）影子日志解析分支的 db.get(AgentGroupChat)
    补 AgentGroupChat.deleted_at IS NULL 过滤（改 db.get 为带过滤的 select 或
    取行后判 deleted_at，照 1588-1598 get_group_chat_by_session 先例）
  - list_groups(user, *, archived: bool | None = False)：False → 追加
    archived_at IS NULL；True → IS NOT NULL；None → 不过滤（注释锚定 HTTP
    默认 False 的防泄漏理由，会话侧 ql-20260831-015 教训前移）
  - 全部新方法 docstring 中文，注释引用 design 章节 + 会话先例行号
acceptance:
  - 三方法幂等（重复归档/取消归档无操作；已删群 404）
  - delete 后：群行+群时间线会话双 deleted_at 非空；活跃群删除前影子会话/队列
    收口（end_group 语义零改动）
  - 非 _require_group_owner 用户 → GroupChatForbidden（403 中文文案）；
    非成员 → GroupChatNotFound（404）
  - 影子日志解析分支对已删群不再放行
  - list_groups(None) 行为与现状完全一致（默认视图零回归锚点）
verify:
  - cd backend && uv run ruff check app/modules/daemon/group/service.py && uv run mypy app/modules/daemon/group/service.py
  - cd backend && uv run pytest app/modules/daemon/tests/test_group_chat_management.py -n auto（既有用例零回归；新增链路用例归 task-04）
constraints:
  - delete_group 必须复用 end_group 收口链，禁止重写 _end_group_for_delete 私有
    方法（design §5.2 实现取舍）
  - _get_group_locked 仅新三方法使用，既有 _get_group 调用点零改动
  - 测试暴露实现缺陷回本卡修复后复跑，禁止弱化断言迁就实现
---
