---
id: task-01
title: '后端迁移与模型——user_workspace_orders 表 + UserWorkspaceOrder 模型 + 唯一/排序索引'
title_zh: '后端迁移与模型——user_workspace_orders 表 + UserWorkspaceOrder 模型 + 唯一/排序索引'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-14 14:04:23
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1, D-011@v1]
allowed_paths:
  - backend/app/modules/workspace/model.py
  - NEW:backend/migrations/versions/<rev>_create_user_workspace_orders.py
target_files:
  - backend/app/modules/workspace/model.py
  - NEW:backend/migrations/versions/<rev>_create_user_workspace_orders.py
goal: >
  建立每人一套（user-scoped）拖拽顺序的数据底座：新增 user_workspace_orders 表
  （UserWorkspaceOrder 模型 + 手写 Alembic 迁移 + 唯一/排序双索引），为 task-03
  move 服务与 task-04 列表排序提供 per-user sort_position 存储（FR-01，
  D-001@v1/D-011@v1 方案 A 落地第一步）。
implementation:
  - model.py 仿 Workspace 显式 sa_column 风格新增 UserWorkspaceOrder(BaseModel, table=True)——id（Uuid 主键 default_factory=uuid.uuid4）、user_id（Uuid NOT NULL FK users.id）、workspace_id（Uuid NOT NULL FK workspaces.id）、sort_position（Float NOT NULL，对应 DDL DOUBLE PRECISION）、created_at/updated_at（DateTime(timezone=True) NOT NULL，写法照抄 Workspace 同名字段）；表名 user_workspace_orders，__table_args__ 声明 ux_uwo_user_workspace 唯一索引 (user_id, workspace_id) 与 ix_uwo_user_position 普通索引 (user_id, sort_position)
  - 手写迁移 backend/migrations/versions/<rev>_create_user_workspace_orders.py（仿 p0la1ud1t006_create_policy_audit_log.py 的手写结构；revision id 执行时确定且避开已占用值，down_revision 指向当时 head 保持单链）——upgrade 用 op.create_table 按 design「数据模型」DDL 落 6 列（id/user_id/workspace_id/sort_position=sa.Float/created_at/updated_at=sa.DateTime(timezone=True)）+ op.create_index ux_uwo_user_workspace（unique=True）与 ix_uwo_user_position；downgrade 按逆序 drop_index 再 drop_table
  - 模型与迁移的列名/索引名严格一致（注释与实现一致）；不写任何存量数据回填（首拖惰性物化归 task-03，D-006@v2）
acceptance:
  - 表结构与 design「数据模型」DDL 一致——6 列齐全、sort_position 为双精度浮点非空、ux_uwo_user_workspace 唯一索引 (user_id, workspace_id)、ix_uwo_user_position 索引 (user_id, sort_position)
  - 迁移 upgrade/downgrade 在 SQLite 与 PostgreSQL 双方言均可执行（Uuid/Float/DateTime(timezone=True) 均为跨方言 sa 类型）
  - workspaces 等既有表零改动；既有 workspace 模块测试回归全绿
verify:
  - cd backend && uv run ruff check app/modules/workspace/model.py
  - cd backend && uv run mypy app/modules/workspace/model.py
  - cd backend && uv run pytest -q --no-cov app/modules/workspace/tests/test_model.py（既有模型测试回归；新表行为断言归 task-05）
  - cd backend && uv run alembic upgrade head（本地栈验证迁移可执行、表可建）
constraints:
  - 禁止跑全量测试（CLAUDE.md 规则 0），仅跑上述模块内相关测试
  - 不物化任何排序行、不回填存量数据（惰性物化归 task-03）
  - 不碰 service.py/router.py/schema.py/tests（本 task 仅数据层）；迁移手写不用 autogenerate，避免混入无关差量
  - 迁移 rev 执行时确定并避开已占用 revision id，down_revision 对齐当时 head
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
