---
id: task-06
title: '后端测试（CRUD/403/422/审计/孤儿容忍/种子迁移断言）'
title_zh: '后端测试（CRUD/403/422/审计/孤儿容忍/种子迁移断言）'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-09-18 14:46:09
priority: P0
depends_on: ['task-03', 'task-04', 'task-05']
blocks: []
requirement_ids: [FR-01, FR-02, FR-05]
decision_ids: [D-002@v1]
expects_from:
  task-05:
    - needs: [put_override 与 delete_override 端点已挂载可调（GET/PUT/DELETE 可请求）]
allowed_paths:
  - NEW:backend/tests/modules/admin/test_menu_overrides.py
  - backend/migrations/versions/
  - backend/app/modules/admin/
target_files:
  - NEW:backend/tests/modules/admin/test_menu_overrides.py
goal: >
  为 menu-overrides 端点与种子迁移写后端测试——CRUD 链 / 403 门控 / 422 参数校验 / 审计落库 /
  孤儿 key 容忍 / 迁移种子授全角色断言，锁住 task-03/04/05 的行为契约（FR-01/02/05）。
implementation:
  - 测试骨架照 tests/modules/admin/test_roles_router.py 惯例——pytest.mark.asyncio + 根 conftest 的 client/auth_headers/db_session，自建无 menu:admin 的普通用户 token fixture
  - CRUD 链——PUT upsert 新建与二次更新、字段置 null 清除回默认、GET 列表含新行、DELETE 后 204 且 GET 不再含
  - 门控与校验——无 menu:admin 用户 PUT/DELETE 得 403 而 GET 仍 200；label 空串或 31 字符、sort_order 1000 或负数得 422（文案中文）
  - 审计断言——PUT/DELETE 后 select(AuditLog) 新增行计数与 action 匹配（范式 tests/core/test_audit_hooks_effective.py:98）
  - 孤儿容忍与种子断言——PUT 注册表不存在的 menu_key 仍 200（后端不校验注册表 R-01）；照 tests/test_platform_deleted_hidden_migration.py 范式加载迁移模块断言 4 新权限 key 对全部现存角色的种子 INSERT
acceptance:
  - 上述六类用例全部存在且通过——CRUD/403/422/审计/孤儿/种子
  - 种子断言覆盖 4 新 key × 全部 roles 行（含 disabled 角色）且幂等不重复插
verify:
  - cd backend && uv run pytest -q tests/modules/admin/test_menu_overrides.py
constraints:
  - 禁跑全量测试（CLAUDE.md 规则 0），仅跑本文件相关用例
  - 测试暴露实现 bug 时回 task-03/04/05 的文件修，不许改测试迁就实现
  - 403/422 断言用中文文案与 resp.json() 的 code 字段（对齐 test_roles_router 风格）
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
