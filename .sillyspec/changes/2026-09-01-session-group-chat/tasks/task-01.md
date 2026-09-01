---
id: task-01
title: 'add group chat data models and migration'
title_zh: '群聊数据模型与迁移'
author: 'qinyi'
created_at: 2026-09-02 00:35:00
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: [D-007@v1, D-008@v1, D-009@v1]
allowed_paths:
  - backend/app/modules/agent/model.py
  - backend/app/modules/agent/schema.py
  - backend/migrations/versions/
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
goal: >
  AgentSession 加 session_kind 列、AgentRunLog 加 metadata 列、新增 agent_group_chats/agent_group_members 两表与 alembic 单文件迁移，DTO 与前端类型同步，为群聊全链路打数据底座（task-02/03 均依赖本卡）。
implementation:
  - model.py 给 AgentSession 加 session_kind 列（String(16)、NOT NULL、server_default 'chat'、索引 ix_agent_sessions_session_kind），给 AgentRunLog 加 metadata JSON NULL 列（投影行身份承载，存量行 NULL）
  - 新增 AgentGroupChat/AgentGroupMember 模型——UNIQUE(group_id, display_name) 群内昵称全局唯一，agent 成员六要素列 runtime_id/workspace_id/provider/llm_provider_id/agent_profile_id/config_snapshot，加 shadow_session_id 反向指针与 shadow_status
  - alembic 单文件迁移（一列两表 + metadata 列）——revision 用 20260902xxxx 时间戳保证唯一，down_revision 接当前 head 20260831150000，迁移前先 alembic heads 确认单 head
  - schema.py 群 DTO（群/成员/六要素读写体）；跑 pnpm gen:types 重生成 frontend/src/lib/api-types.ts 并随 backend/openapi.json 一并提交
acceptance:
  - 迁移 upgrade 与 downgrade 均可执行，session_kind 默认 'chat' 存量行不受影响
  - UNIQUE(group_id, display_name) 约束生效，同群同名插入被拒
  - 群 DTO 出现在 openapi.json 与重生成的 api-types.ts 中
verify:
  - cd backend && uv run alembic heads（确认单 head）
  - cd backend && uv run pytest -q tests/test_migrations.py -k group（或对应新增迁移测试）
  - cd frontend && pnpm gen:types && git diff --stat frontend/src/lib/api-types.ts
constraints:
  - 存量行为零变更——新列 nullable 或带 default，不碰既有表语义
  - 迁移 revision 时间戳唯一，防并行撞 head
  - 模型与迁移兼容 Windows、Linux 与 macOS
provides:
  - contract: AgentGroupChat/AgentGroupMember 模型与群 DTO
    fields: [session_kind, display_name, member_type, runtime_id, workspace_id, provider, llm_provider_id, agent_profile_id, shadow_session_id, shadow_status, agent_cross_mention, context_window]
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
