---
id: task-05
title: '新增 auth 判定链收紧专项测试 test_rbac_workspace_scope.py'
title_zh: '新增 auth 判定链收紧专项测试 test_rbac_workspace_scope.py'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-09-20 18:03:09
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-01, FR-02, FR-05, FR-06]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - backend/app/modules/auth/tests/test_rbac_workspace_scope.py
  - backend/app/modules/auth/tests/__init__.py
target_files:
  - NEW:backend/app/modules/auth/tests/test_rbac_workspace_scope.py
goal: >
  判定链收紧的专项测试：直接对 has_permission 断言新语义（非成员+平台级任意权限→False；
  platform:admin→True；is_platform_admin→True；workspace_id=None 入口语义不变），
  覆盖全权限无白名单（D-002@v1）。
implementation:
  - 新建 backend/app/modules/auth/tests/（含 __init__.py，对齐各模块 tests 布局）与 test_rbac_workspace_scope.py
  - 夹具：建 user + 平台级角色（user_roles）携任意权限（workspace:read / mcp:read 两组参数化）+ 工作区 W + 非成员状态；参照 backend/app/modules/workspace/tests/test_platform_grant_list.py 的 _grant_platform_role 写法
  - 断言：has_permission(W, P)=False / has_permission(None, P)=True；platform:admin 角色变体 → 两者 True；is_platform_admin=True → 全 True
  - 成员对照组：UserWorkspaceRole 授 workspace_owner → has_permission(W, WORKSPACE_READ)=True（FR-06 语义）
acceptance:
  - 参数化覆盖至少 workspace:read 与 mcp:read 两权限（无白名单证据）
  - 入口路径（workspace_id=None）回归断言存在
  - 测试绿
verify:
  - cd backend && .venv/Scripts/python -m pytest app/modules/auth/tests/test_rbac_workspace_scope.py -x -q
constraints:
  - 只新增测试，不改实现（实现归 task-01）
  - 不引入新依赖；异步测试风格对齐仓库既有 pytest asyncio 用法
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
