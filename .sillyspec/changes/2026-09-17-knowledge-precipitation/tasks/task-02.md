---
id: task-02
title: 'add knowledge-write permission enum and role seeding migration'
title_zh: 'KNOWLEDGE_WRITE 权限枚举 + 角色-权限播种 migration'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-17 10:44:49
priority: P0
depends_on: []
blocks: ['task-04', 'task-07']
requirement_ids: [FR-02]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/auth/permissions.py
  - backend/migrations/versions/
  - backend/tests/modules/auth/test_permissions.py
target_files:
  - backend/app/modules/auth/permissions.py
  - NEW:backend/migrations/versions/20260917104400_add_knowledge_write_permission.py
  - backend/tests/modules/auth/test_permissions.py
goal: >
  新增 KNOWLEDGE_WRITE 权限点（knowledge:write）并以 migration 授予存量管理员/
  owner 角色（platform_admin、workspace_owner），为 task-04 写端点 require_permission
  门控与前端权限驱动写按钮提供地基（FR-02；R-06 防权限播种遗漏致 403）。
implementation:
  - permissions.py 照 KNOWLEDGE_READ 先例（Workspace 子菜单 read 权限段，第 68 行附近）增 KNOWLEDGE_WRITE 枚举；knowledge 前缀既有分支自动归 WORKSPACE 组，group 代码零改动
  - 新建 migration——revision 号用当日时间戳前缀（如 20260917104400）防 alembic 撞号，执行时先跑 alembic heads 实测定 down_revision（当前实测单头 20260914100000）
  - upgrade 按 roles.key SELECT 存量角色 id（platform_admin、workspace_owner）后向 role_permissions 插入 knowledge:write 行并幂等（已持有则跳过）；sa.table 类型化桩写法参照 202607251600，但授予存量角色必须 SELECT——该先例的 Python uuid 复用仅适用新建角色
  - migration 内权限字符串用字面量复写不 import app.*（离线 SQL 可生成）；downgrade 显式 DELETE 这些角色上的 knowledge:write 授权行（不依赖 FK CASCADE，roles 本体与其它权限不动）
  - test_permissions.py 增 KNOWLEDGE_WRITE → PermissionGroup.WORKSPACE 参数化用例
acceptance:
  - Permission.KNOWLEDGE_WRITE 枚举存在且导入无误，group 属性返回 PermissionGroup.WORKSPACE
  - alembic upgrade 后 platform_admin 与 workspace_owner 角色持有 knowledge:write 授权行
  - alembic downgrade 可回退（对应 role_permissions 行删除，roles 本体不动）
  - 既有角色其它权限集合零变化（只增授权不删改，brownfield 零回归）
verify:
  - cd backend && uv run pytest tests/modules/auth/test_permissions.py -q
  - cd backend && uv run alembic upgrade head && uv run alembic downgrade -1 && uv run alembic upgrade head
constraints:
  - 不改历史迁移（202605280900 等已部署 DB 不会再跑）；不新建权限组机制、不加 KNOWLEDGE_WRITE 之外的权限点
  - 不动 knowledge router/端点与前端（写端点挂权限归 task-04，权限渲染归 task-05）
  - migration 体内不调 Redis/不做权限缓存失效（对齐 202607251600 范式说明——用户级缓存懒填，迁移是同步部署期动作）
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
