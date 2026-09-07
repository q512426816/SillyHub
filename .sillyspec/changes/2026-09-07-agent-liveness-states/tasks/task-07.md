---
id: task-07
title: 'backend 四列迁移（alembic）+ AgentSessionLogORM/schema 增字段'
title_zh: 'backend 四列迁移（alembic）+ AgentSessionLogORM/schema 增字段'
author: 'qinyi'
created_at: 2026-09-07 13:43:27
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-03]
decision_ids: ['D-001@v1', 'D-003@v1']
allowed_paths:
  - backend/app/modules/platform_sync/model.py
  - backend/app/modules/platform_sync/schema.py
  - backend/migrations/versions/<rev>_agent_liveness_states.py
  - backend/app/modules/platform_sync/tests/test_agent_liveness_states_migration.py
target_files:
  - backend/app/modules/platform_sync/model.py
  - backend/app/modules/platform_sync/schema.py
  - NEW:backend/migrations/versions/<rev>_agent_liveness_states.py
  - NEW:backend/app/modules/platform_sync/tests/test_agent_liveness_states_migration.py
goal: >
  为 platform_agent_logs 补 liveness 状态四列（state/state_derived_at/state_evidence/
  last_event_at）并同步 ORM 与 GET 响应模型，使 daemon 推导状态可落库回溯
  （design §5.3 P1b / FR-03），为 task-08 states 端点与 task-09 通知提供数据基础。
implementation:
  - 'model.py：AgentSessionLogORM（:191，表 platform_agent_logs :221）在 agent_session_id（:323）与 created_at（:331）之间增四列——state String(16)、state_derived_at DateTime(timezone=True)、state_evidence String(200)、last_event_at DateTime(timezone=True)，均 nullable（design §5.3 列型）；类 docstring 增本变更段落'
  - '新建 backend/migrations/versions/<rev>_agent_liveness_states.py：文件名按 alembic revision id 命名替换 <rev>（YYYYMMDDHHMMSS 风格，alembic 实际目录为 backend/migrations/versions/）；upgrade 对 platform_agent_logs 四次 op.add_column（nullable 不回填），downgrade 反序 drop 四列；down_revision 接执行时唯一 head（写卡时为 20260905004300，执行前 alembic heads 实测复核）；注释风格对齐 20260905004300_add_agent_session_task.py'
  - 'schema.py：AgentLogListItem（:317）增 state/state_derived_at/state_evidence/last_event_at 四字段；state 用 validator 把 ORM NULL 归一为 unknown（旧行/未部署 daemon 场景显示 unknown，design §5.3），其余三字段可空直传'
  - '新建迁移测试 test_agent_liveness_states_migration.py：结构断言（迁移文件存在、alembic 单 head 链、upgrade 含四列 add_column、downgrade 对称 drop——先例 backend/tests/test_changes_location_check_migration.py）+ ORM create_all 建表四列与迁移逐列对齐断言（防模型↔迁移漂移）'
acceptance:
  - 'alembic upgrade head 成功；downgrade -1 后四列消失；再次 upgrade head 成功（可升可回滚）'
  - '迁移前已存在的旧行 state 为 NULL，GET /api/agent-logs 响应中该行 state 返回 unknown，其余三字段为 null'
  - '迁移测试与 platform_sync 既有 agent_log 相关测试零回归'
verify:
  - 'cd backend && uv run pytest app/modules/platform_sync/tests -n auto -k liveness'
  - 'cd backend && uv run pytest app/modules/platform_sync/tests -n auto -k agent_log'
  - 'cd backend && uv run alembic upgrade head && uv run alembic downgrade -1 && uv run alembic upgrade head'
  - 'cd backend && uv run ruff check app/modules/platform_sync/model.py app/modules/platform_sync/schema.py && uv run mypy app/modules/platform_sync/model.py app/modules/platform_sync/schema.py'
constraints:
  - '四列全 nullable、不回填存量行（旧行 unknown 由响应层归一，对齐 agent_session_id 列存量不回填先例 R-03 口径）'
  - '不改 (workspace_id, log_path) 唯一键与既有列语义；states 写端点与 agent_blocked 通知属 task-08/09，本卡不做'
  - '时间两列用 DateTime(timezone=True) 而非既有 ISO 原文 String 先例（D-003）——states 端点 derived_at/last_event_at 是 Pydantic datetime 结构化值（design §7 接口定义）'
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
