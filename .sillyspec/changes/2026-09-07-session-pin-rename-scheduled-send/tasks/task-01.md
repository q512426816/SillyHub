---
id: task-01
title: 'session-model-and-migration-pinned-at-scheduled-table'
title_zh: '后端模型与迁移——AgentSession 置顶列与索引、定时消息新表、alembic 迁移'
author: 'qinyi'
created_at: 2026-09-07 23:32:13
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-04, FR-07]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - backend/app/modules/agent/model.py
  - backend/migrations/versions/
target_files:
  - backend/app/modules/agent/model.py
  - NEW:backend/migrations/versions/20260907231000_add_session_pin_title_scheduled.py
provides:
  - contract: AgentSession
    fields: [pinned_at]
    consumers: [task-02]
  - contract: AgentSessionScheduledMessage
    fields: [id, agent_session_id, sender_user_id, prompt, attachment_ids, agent_profile_id, llm_provider_id, dispatch_at, status, error_code, error_message, created_at, dispatched_at, cancelled_at]
    consumers: [task-03, task-04]
goal: >
  为会话置顶与定时发送打数据底座——AgentSession 加 pinned_at 可空列与索引、新增 AgentSessionScheduledMessage 表并出 alembic 迁移接当前 head，供 task-02/03/04 消费。
implementation:
  - agent/model.py 的 AgentSession（行 586 起）照 archived_at 列（行 799）形态新增 pinned_at 列（DateTime(timezone=True)、nullable、default None，NULL 语义为未置顶），并在 __table_args__ 索引块（行 607-634）对齐 ix_agent_sessions_archived_at 声明惯例补 Index("ix_agent_sessions_pinned_at", "pinned_at")，附 2026-09-07 变更来源与排序用途注释（照既有索引注释惯例，防 autogenerate 漂移）
  - agent/model.py 在 AgentSessionQueuedMessage（行 1029）相邻位置新增 AgentSessionScheduledMessage 表模型（design §数据模型）——__tablename__ 为 agent_session_scheduled_messages，__table_args__ 带 Index("ix_agent_ssm_session_status_dispatch", "agent_session_id", "status", "dispatch_at")；列依次为 id 主键、agent_session_id 与 sender_user_id 两个 FK 均 ondelete CASCADE、prompt Text 非空、attachment_ids JSON 可空（str 列表快照）、agent_profile_id 与 llm_provider_id 均 String(64) 可空、dispatch_at 与 created_at 均 DateTime(timezone=True) 非空、status String(16) 默认 pending（取值 pending/dispatched/cancelled/failed）、dispatched_at 与 cancelled_at 可空审计时间线、error_code String(64) 可空与 error_message Text 可空；docstring 对齐 AgentSessionQueuedMessage 注释密度，注明 sweeper 派发契约与 at-least-once 权衡（R-02）
  - 新建迁移 20260907231000_add_session_pin_title_scheduled.py（revision 20260907231000，down_revision 接当前唯一 head 20260907141041 即 agent_liveness_states）——upgrade 依次加列 agent_sessions.pinned_at（可空）、建索引 ix_agent_sessions_pinned_at、建表 agent_session_scheduled_messages（含复合索引与两个 FK CASCADE），downgrade 逆序 drop；文件头注释与写法照 20260907141041_agent_liveness_states.py 惯例
acceptance:
  - 全新库与既有库 alembic upgrade head 均成功——agent_sessions 出现可空 pinned_at 列与 ix_agent_sessions_pinned_at 索引，agent_session_scheduled_messages 表结构与 design §数据模型逐列一致
  - 纯 DDL 无数据回填（FR-07）——存量行 pinned_at 恒 NULL 时排序谓词恒真，agent 模块既有测试零回归
verify:
  - cd backend && uv run alembic upgrade head
  - cd backend && uv run pytest app/modules/agent -q --no-cov -n auto
constraints:
  - 只改 agent/model.py 与迁移文件，不碰 daemon 侧 schema/router/service（归 task-02/03 的 allowed_paths）
  - 不写新测试文件（backend 测试归 task-06），不动既有列、索引与表定义
  - 迁移只做 DDL 不回填数据，写法兼容 aiosqlite/PG 双方言（对齐既有迁移惯例）
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
