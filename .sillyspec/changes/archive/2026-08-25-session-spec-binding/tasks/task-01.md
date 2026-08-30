---
id: task-01
title: 'QuicklogSessionLink 模型 + alembic 迁移（建表+存量播种）'
title_zh: 'QuicklogSessionLink 模型 + alembic 迁移（建表+存量播种）'
author: 'qinyi'
created_at: 2026-08-25 22:54:07
priority: P0
depends_on: []
blocks: [task-02, task-03, task-04]
requirement_ids: [FR-02]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - backend/app/modules/change/model.py
  - backend/migrations/versions/20260825230000_add_quicklog_session_links.py
  - backend/app/modules/change/tests/test_quicklog_session_links.py
provides:
  - contract: QuicklogSessionLink
    fields: [workspace_id, ql_id, session_id, created_at]
  - contract: ChangeSessionLinksSeeded
    fields: [change_id, session_id]
goal: >
  建 quicklog_session_links 多对多绑定表（自然键 D-001@v1）并把存量 AgentSession.change_id
  单 FK 关系一次性播种进 change_session_links（D-002@v1），为 W2 各任务提供数据层地基（FR-02）。
implementation:
  - change/model.py 新增 QuicklogSessionLink（对齐 ChangeSessionLink L246 风格）字段为 id UUID PK、
    workspace_id FK→workspaces.id CASCADE、ql_id String(128) 自然键、session_id FK→agent_sessions.id
    CASCADE、created_at timestamptz server_default now()，无 FK 到 quicklog_entries（D-001@v1）
  - 唯一约束 uq_quicklog_session_link_pair(workspace_id, ql_id, session_id) + 双索引
    ix_quicklog_session_link_ql(workspace_id, ql_id) 与 ix_quicklog_session_link_session(session_id)
  - 新迁移 20260825223000 建表（dialect 无关 create_table/create_index 对齐 20260814090000 先例，
    down_revision 接当前 alembic head）
  - 存量播种为 INSERT INTO change_session_links (id, change_id, session_id, created_at)
    SELECT gen_random_uuid(), change_id, id, now() FROM agent_sessions WHERE change_id IS NOT NULL
    ON CONFLICT (change_id, session_id) DO NOTHING（幂等重跑不重复，D-002@v1）
  - downgrade 仅 drop quicklog_session_links，播种行保留无害（docstring 说明，design §9）
  - 新建 test_quicklog_session_links.py 覆盖建行、唯一约束幂等、播种幂等与存量全量命中
acceptance:
  - upgrade 后表结构与唯一约束/双索引齐全且与模型一致
  - 存量 change_id 非空会话全部有 link 行且重复 upgrade 不重复播种
  - 同 (workspace_id, ql_id, session_id) 重复插入被唯一约束拦截；downgrade 后播种行保留
verify:
  - cd backend && uv run pytest app/modules/change/tests/test_quicklog_session_links.py -q
constraints:
  - change_session_links 表结构不动（只 INSERT 播种，沿用 2026-08-14 D-007 结构）
  - AgentSession.change_id 列保留不删除（D-002@v1 冻结为冗余提示）
  - gen_random_uuid 为 PG 函数（测试基建走 create_all 不跑 alembic），SQLite 断言播种幂等时 id 生成需兼容处理
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
