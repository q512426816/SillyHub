---
id: task-01
title: '迁移三步走——agent_session_queued_messages 加 position 列（nullable → CTE ROW_NUMBER(created_at,id) 回填 → NOT NULL），down_revision=20260831120000'
title_zh: '迁移三步走——agent_session_queued_messages 加 position 列（nullable → CTE ROW_NUMBER(created_at,id) 回填 → NOT NULL），down_revision=20260831120000'
author: 'qinyi'
created_at: 2026-08-31 04:15:00
priority: P0
depends_on: []
blocks: [task-02]
requirement_ids: [FR-04]
decision_ids: [D-002, D-010]
allowed_paths:
  - backend/migrations/versions/20260831130000_add_queued_message_position.py
provides:
  - 'DB 列 agent_session_queued_messages.position INT NOT NULL（迁移 20260831130000，存量行按 (created_at, id) 升序回填 1..n）——task-02 模型字段的运行时前置'
goal: >
  为 agent_session_queued_messages 新增 position 派发序号列，迁移按三步走
  （nullable 加列 → CTE ROW_NUMBER(created_at,id) 回填 → SET NOT NULL），
  为 FR-04 拖拽排序提供持久化排序键。
implementation:
  - 新建 backend/migrations/versions/20260831130000_add_queued_message_position.py：revision="20260831130000"、down_revision="20260831120000"（当前唯一 head，20260831120000_add_agent_sessions_ctx_window_tokens）、branch_labels=None、depends_on=None，文件结构与头注释格式对齐 20260827230000_add_agent_runs_ctx_tokens.py
  - upgrade 第①步：op.add_column("agent_session_queued_messages", sa.Column("position", sa.Integer(), nullable=True))
  - upgrade 第②步回填：op.execute CTE——WITH ranked AS (SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn FROM agent_session_queued_messages) UPDATE agent_session_queued_messages q SET position = r.rn FROM ranked r WHERE q.id = r.id（对齐 202607240900_add_user_username.py:30-44 先例；UPDATE 内联 ROW_NUMBER() 窗口函数非合法 Postgres 语法，必须走 CTE，D-010）
  - upgrade 第③步：op.alter_column("agent_session_queued_messages", "position", existing_type=sa.Integer(), nullable=False)
  - downgrade 对称删列：op.drop_column("agent_session_queued_messages", "position")
  - 文件 docstring 注明 change=2026-08-31-session-queue-ux / FR-04 / D-002 / D-010、三步走原因与不加唯一约束原因（D-002），author/created_at 对齐模板
acceptance:
  - 在含存量排队行的库上 upgrade 成功后，position 全部非空且值 == 按 (created_at, id) 升序的 1..n（ROW_NUMBER 起点 1）
  - 列最终定义为 INT NOT NULL；未添加唯一约束或索引（D-002：并发插入由会话行锁串行，排序键带 created_at 次序，重复不破坏正确性）
  - downgrade 后列被完整移除（对称可回滚）
  - down_revision="20260831120000"，alembic heads 唯一指向 20260831130000，无分叉
verify:
  - cd backend && uv run python -m py_compile migrations/versions/20260831130000_add_queued_message_position.py
  - cd backend && uv run alembic heads（单 head = 20260831130000）
  - cd backend && uv run alembic upgrade head --sql（离线 SQL 生成无错；实际库应用与 Docker Postgres 冒烟归 task-13）
constraints:
  - 迁移三步走不可合并（D-010）：nullable → CTE 回填 → SET NOT NULL；禁止 UPDATE 内联窗口函数
  - 不加唯一约束/索引（D-002）；不迁移历史数据语义（NG-04，回填仅按 created_at,id 序一次完成）
  - 迁移本体不在 pytest 覆盖面（测试库走 create_all 建表不跑 Alembic，design §6/§8）——静态审查 + task-13 部署冒烟兜底，本卡不写测试
  - 仅允许新建该迁移文件：不动 model.py（task-02 范围）、不动既有迁移、不动 daemon 侧任何代码
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
