---
id: task-01
title: 'Add User.avatar column + alembic migration'
title_zh: 'User.avatar 列 + alembic 迁移'
author: 'qinyi'
created_at: 2026-09-10 19:10:51
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/auth/model.py
  - NEW:backend/migrations/versions/20260910160000_users_avatar.py
target_files:
  - backend/app/modules/auth/model.py
  - NEW:backend/migrations/versions/20260910160000_users_avatar.py
goal: >
  为 users 表新增 avatar 列（String(512) nullable，存文件中心 /api/file/{id} 或外链，NULL=未设置），
  并补对称可逆的 alembic 迁移（D-001@v1），供 task-03 端点写入与 task-04 群聊回落读取。
implementation:
  - model.py User 在 display_name/employee_no 邻域（model.py:50 后）加 avatar 字段，写法 Field(default=None, sa_column=Column(String(512), nullable=True))，行注释风格对齐 employee_no（用途 + nullable 语义）
  - 新建迁移 backend/migrations/versions/20260910160000_users_avatar.py，revision="20260910160000"、down_revision="20260910120000"（接当前链头），文件头 docstring 写法照 20260910120000_add_auto_resume_origin_and_run_metadata.py
  - upgrade 用 op.add_column("users", sa.Column("avatar", sa.String(512), nullable=True))，downgrade 对称 op.drop_column；无索引、无默认值、不回填
  - 既有 User(...) 构造点零改动（default=None 兜底），SQLite create_all 自动带新列，测试 fixture 不受影响
acceptance:
  - alembic heads 唯一且为 20260910160000（down_revision=20260910120000，无分叉）
  - upgrade head 后 users.avatar 列存在（String(512) NULL）；downgrade -1 后列消失、再 upgrade 可恢复
  - User.avatar ORM 属性默认 None；不传 avatar 的既有构造与 auth 测试零回归
verify:
  - cd backend && uv run alembic heads && uv run alembic upgrade head && uv run alembic downgrade -1 && uv run alembic upgrade head
  - cd backend && uv run pytest tests/modules/auth/test_change_password.py -q --no-cov
constraints:
  - 仅加列 + 迁移；schema/router/service 不动（task-02/03 范围），不加索引不加默认值
  - 语义铁律：NULL=未设置，本列永不存空串（清除由 task-03 端点置 NULL 保证）
  - 迁移 SQLite/PG 双兼容、Windows/macOS/Linux 可跑（CLAUDE.md 规则 13）；仅跑相关测试禁全量（规则 0）
provides:
  - contract: users.avatar
    fields: [users.avatar]
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
