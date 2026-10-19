---
id: task-01
title: 'Sessions family_id column + alembic migration'
title_zh: '会话族 family_id 列与 alembic 增量迁移'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-16 15:53:07
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/auth/model.py
  - backend/migrations/versions/
  - backend/tests/test_align_platform_change_events_migration.py
target_files:
  - backend/app/modules/auth/model.py
  - NEW:backend/migrations/versions/c3f8a1d6e2b4_add_sessions_family_id.py
  - backend/tests/test_align_platform_change_events_migration.py
goal: >
  sessions 表加 family_id UUID NULL 列建模会话族（FR-01 / D-001@v1），产出 alembic 增量迁移，供族级吊销使用。
implementation:
  - backend/app/modules/auth/model.py Session 增 family_id 字段：Column(Uuid(as_uuid=True), nullable=True)，default None，注释说明族语义与 NULL=存量旧行自成一族（对齐 id 列范式 model.py:113-116）
  - 手写迁移 backend/migrations/versions/c3f8a1d6e2b4_add_sessions_family_id.py：revision=c3f8a1d6e2b4；down_revision="20261016100000"（实测链头）；upgrade 仅 add_column nullable，downgrade drop_column
  - 同步 backend/tests/test_align_platform_change_events_migration.py:98-116 链尾锚：head 断言前移 c3f8a1d6e2b4 + 注释链续写（符号影响扫描发现，漏更即测试挂）
acceptance:
  - cd backend && uv run alembic upgrade head 本地通过，sessions.family_id 存在且可空
  - 新行 family_id 默认 None；未加索引、未加服务端默认值（对齐 D-001@v1 谓词走既有 ix_sessions_user_revoked）
  - ruff check 与 mypy 对改动文件零错
verify:
  - cd backend && uv run alembic upgrade head && uv run alembic heads
  - cd backend && uv run pytest tests/test_align_platform_change_events_migration.py -q
  - cd backend && uv run ruff check app/modules/auth/model.py migrations/versions/ tests/test_align_platform_change_events_migration.py && uv run mypy app/modules/auth/model.py
constraints:
  - 禁回填存量行、禁重置数据（PPM 已上线，CLAUDE.md 规则11 例外不适用）
  - 迁移仅加列，不删改其它列；迁移文件名须与 design.md 文件清单一致（c3f8a1d6e2b4_add_sessions_family_id.py）
  - Windows/Linux/macOS 兼容（CLAUDE.md 规则13）
related_tests:
  - path: backend/tests/test_align_platform_change_events_migration.py
    reason: 链尾 head 锚断言 20261016100000，新迁移前移 head 后必挂（同 task allowed_paths 内同步）
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
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
