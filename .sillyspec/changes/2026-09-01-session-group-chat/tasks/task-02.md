---
id: task-02
title: 'group chat management service and permission branches'
title_zh: '群管理服务与权限分支'
author: 'qinyi'
created_at: 2026-09-02 00:35:00
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04]
decision_ids: [D-003@v1, D-004@v1, D-009@v1]
allowed_paths:
  - backend/app/modules/daemon/group/router.py
  - backend/app/modules/daemon/group/service.py
  - backend/app/modules/daemon/group/__init__.py
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/permission_service.py
  - backend/app/modules/agent/file_artifacts.py
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/tests/test_group_chat_management.py
  - backend/app/modules/agent/tests/test_group_chat_models.py
goal: >
  群 CRUD/成员管理/上限校验/解散 + _require_group_member 参与者权限分支（单聊路径零改动），为 task-03 群消息管线提供管理面与权限底座。
implementation:
  - 新建 daemon/group 子模块——建群（含群会话 kind='group' 创建）、列表（成员摘要 chips + online_member_ids 占位）、详情、PATCH 设置、解散（end 群会话+全部影子会话+队列清理）
  - 成员 CRUD——昵称全局唯一校验（用户与 agent 共用命名空间）、agent 成员上限 8 与用户成员上限 50、移除 agent 成员联动清理（影子 end+队列清理+群内系统提示）；POST members/{mid}/reset-memory 重置记忆端点（end 影子置 pending 下次触发懒重建）
  - _require_group_member 两段式（成员表命中→workspace admin→404）；集中改造 _get_owned_session_for_update/get_agent_session/list·logs 内联谓词/SSE router 内联校验/permission_service 3 处/file_artifacts 群分支（kind='group' 走成员分支，其余原逻辑不动）；自带 pytest test_group_chat_management.py
acceptance:
  - 成员/非成员/workspace admin 权限矩阵测试通过，非成员 404 不泄露存在性
  - kind 过滤不泄漏 group_member 影子会话进普通会话列表；上限超出与昵称重复均返回 400
  - 解散链清理完整（群会话+全部影子会话+队列 pending 行）
verify:
  - cd backend && uv run pytest -q app/modules/daemon/tests/test_group_chat_management.py
  - cd backend && uv run ruff check app/modules/daemon/group && uv run mypy app
constraints:
  - 单聊（kind='chat'）行为零改动；权限改造仅集中四处，其余经调用链继承
  - 非成员一律 404，不泄露群存在性
expects_from:
  - task-01: session_kind 列、AgentGroupChat/AgentGroupMember 群表模型与 agent 成员六要素字段
provides:
  - contract: '/api/group-chats CRUD 端点与 GroupChatRead/GroupMemberRead DTO'
    fields: [id, title, members, agent_cross_mention, online_member_ids, display_name, shadow_status, reset-memory 端点]
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
