---
id: task-01
title: 'Add platform_deleted and hidden columns (migration + ORM)'
title_zh: 'alembic migration 两列 + ORM 字段（platform_deleted / hidden）'
author: 'qinyi'
created_at: 2026-08-29 12:57:58
priority: P0
depends_on: []
blocks: ['task-02', 'task-04', 'task-05']
requirement_ids: [FR-04, FR-03b]
decision_ids: [D-006@v1]
allowed_paths:
  - backend/migrations/versions/20260829130000_add_platform_deleted_and_quicklog_hidden.py
  - backend/app/modules/spec_workspace/model.py
  - backend/app/modules/platform_sync/model.py
  - backend/tests/test_platform_deleted_hidden_migration.py
goal: >
  单 revision 为 spec_file_manifest 加 platform_deleted、quicklog_entries 加 hidden
  （均 BOOLEAN NOT NULL DEFAULT FALSE）并同步 ORM 字段，为 task-02/task-04/task-05
  的防复活拦截与 quicklog 软隐藏提供数据基础（design §9，FR-04 / FR-03b）。
implementation:
  - 新建 migration backend/migrations/versions/20260829130000_add_platform_deleted_and_quicklog_hidden.py（单 revision，revision id 照 20260821130000 时间戳惯例）；down_revision 接执行时唯一 head（写作时为 4766d997cf09，动手前用 alembic heads 复核，R-05）
  - upgrade 两条 op.add_column：spec_file_manifest.platform_deleted 与 quicklog_entries.hidden，均 sa.Boolean() + nullable=False + server_default=sa.false()；downgrade 对应两条 op.drop_column；不做数据回填（存量行默认 FALSE 即目标态）
  - backend/app/modules/spec_workspace/model.py 的 SpecFileManifest（:109-164，exists 字段 :157-160 之后）加 platform_deleted 字段，default=False + Column(Boolean, nullable=False)，照同文件 exists 字段写法
  - backend/app/modules/platform_sync/model.py 的 QuicklogEntryORM（:120-180，updated_at 之前）加 hidden 字段，default=False + Column(Boolean, nullable=False)
  - 新建 backend/tests/test_platform_deleted_hidden_migration.py：照 tests/test_session_agent_session_id_migration.py 范式（_load_migration 按 revision id 匹配文件名）断言 revision/down_revision 链、upgrade/downgrade 可调用、两条 add_column 的目标表/列/类型/server_default
acceptance:
  - cd backend && uv run alembic heads 输出仅一个 head（R-05 单头约束）
  - 迁移测试通过：单头链断言 + 两条 add_column 的表名/列名/类型/server_default=sa.false() 断言
  - SpecFileManifest.platform_deleted 与 QuicklogEntryORM.hidden 默认值 False，构造新行无需显式传参
  - 仅加列零语义变化（两列全 FALSE 时行为与现状一致），spec_workspace/platform_sync 相关既有测试零回归
verify:
  - cd backend && uv run pytest tests/test_platform_deleted_hidden_migration.py -q
  - cd backend && uv run alembic heads
  - cd backend && uv run pytest app/modules/spec_workspace/tests/test_sync_incremental.py app/modules/platform_sync/tests/test_quicklog_push.py -q
constraints:
  - 单 revision 加两列，禁止拆两个 revision、禁止制造 merge head（R-05，design §9）
  - 不加索引、不动其它表、不写任何使用方逻辑（拦截/拒收/过滤分别归 task-02/task-04/task-05）
  - 遵守 CLAUDE.md 规则 0：只跑本任务相关测试，全量留 CI
  - SQLite 单测方言跑不了 op.upgrade 时照既有迁移测试用元数据断言范式；PG 侧 upgrade head 留 manual verify
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
