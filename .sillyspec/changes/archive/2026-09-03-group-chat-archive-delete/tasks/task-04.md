---
id: task-04
title: 'backend 测试——归档/取消归档幂等与权限、删除收口双置位与旁路封堵、列表三态过滤（HTTP 默认防泄漏锚点）、SSE 信号用例'
title_zh: 'backend 测试——归档/删除/过滤/权限/SSE/旁路封堵全覆盖'
author: 'qinyi'
created_at: '2026-09-03 16:55:15'
priority: P0
depends_on: ['task-02', 'task-03']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05]
decision_ids: ['D-01@v1']
allowed_paths:
  - backend/app/modules/daemon/tests/test_group_chat_management.py
goal: >
  在既有群管理测试文件增补归档/删除全链用例（照文件内既有建群/权限/SSE
  断言模式），覆盖 design §9 后端清单。
implementation:
  - 归档/取消归档：置位→默认列表消失→archived=true 视图出现→取消归档恢复；
    重复调用幂等（第二次 204 且 archived_at 不变）；已解散群可归档
  - 权限：普通成员 POST archive/unarchive/DELETE → 403（中文文案断言）；
    非成员 → 404
  - 删除：活跃群（含 agent 成员）删除后——影子会话 status=ended、群时间线
    AgentSession.status=ended、群行+时间线行 deleted_at 双非空、群列表消失、
    GET /group-chats/{id} 404、影子日志解析分支 404（旁路封堵回归）；
    已解散群删除跳过收口直接双置位；属主 GET /api/daemon/sessions/{时间线id}
    404（旁路封堵断言，deleted_at IS NULL 过滤）
  - 三态过滤：无参（HTTP 默认）不含已归档群（防泄漏锚点用例）；
    ?archived=true 仅已归档；?archived=null 全量（含已归档+未归档）
  - SSE 信号：archive → sessions 事件流 status_changed（audience 含全部用户
    成员）；delete → deleted（照文件内既有群事件断言方式，若有 Redis 依赖则
    照既有测试的 publish mock/stub 模式）
  - 跑法：cd backend && uv run pytest app/modules/daemon/tests/test_group_chat_management.py
    -n auto（仅本文件，全量留 CI）
acceptance:
  - 本文件全绿（含既有用例零回归）
  - 上述每条用例存在且断言到 DB 行状态而非仅 HTTP 状态码
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_group_chat_management.py -n auto（含新增用例全绿）
constraints:
  - 纯测试卡——不改 group/service.py / router.py（实现缺陷回 task-02/03 修复后复跑）
  - 断言到 DB 行状态（deleted_at/archived_at/ended_at/shadow_status）而非仅 HTTP 码
---
