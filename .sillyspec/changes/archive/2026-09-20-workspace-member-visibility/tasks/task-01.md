---
id: task-01
title: 'rbac.has_permission 判定链收紧——带 workspace_id 时平台级段仅 platform:admin 放行（is_platform_admin 短路与 workspace_id=None 入口路径行为不变）'
title_zh: 'rbac.has_permission 判定链收紧——带 workspace_id 时平台级段仅 platform:admin 放行（is_platform_admin 短路与 workspace_id=None 入口路径行为不变）'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-09-20 18:03:09
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-02, FR-05]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - backend/app/modules/auth/rbac.py
target_files:
  - backend/app/modules/auth/rbac.py
goal: >
  has_permission 判定链收紧（语义核心）：带 workspace_id 判定时平台级授权段仅
  platform:admin 放行，消除「平台级角色权限穿透进任意工作区」的暗道；is_platform_admin
  短路与 workspace_id=None 功能入口路径行为不变。
implementation:
  - 改 backend/app/modules/auth/rbac.py:107-132 has_permission：先保留 is_platform_admin 短路；平台段计算 holds_platform_admin（Permission.PLATFORM_ADMIN.value in platform_perms）；workspace_id is None 分支维持现状（holds_platform_admin or permission.value in platform_perms）；workspace_id 非 None 分支改为仅 holds_platform_admin 放行，否则落到既有 collect_permissions 工作区段
  - 同步改写函数 docstring：三段解析顺序表述更新（段 2 平台级授予在工作区上下文仅 platform:admin 放行），注明本变更取代 ql-20260917-007 的穿透语义
  - 不动 collect_permissions / collect_permissions_platform / 缓存层（权限集合不变，只变解释）
acceptance:
  - 非成员（无 user_workspace_roles 行）持平台级 workspace:read → has_permission(workspace_id=W, WORKSPACE_READ) 返回 False
  - 同上用户持平台级 mcp:read → has_permission(workspace_id=W, MCP_READ) 返回 False（全权限无白名单，D-002@v1）
  - is_platform_admin=True → 任意判定 True（不变）
  - 平台级角色含 platform:admin → 任意工作区判定 True
  - workspace_id=None + 平台级 workspace:read → True（功能入口不变，FR-05）
  - 工作区成员走 collect_permissions 段判定结果与改动前一致
verify:
  - cd backend && .venv/Scripts/python -m pytest app/modules/auth/tests/test_rbac_workspace_scope.py -x -q
  - cd backend && .venv/Scripts/python -m ruff check app/modules/auth/rbac.py && .venv/Scripts/python -m mypy app/modules/auth/rbac.py
constraints:
  - 不改函数签名与返回类型；不改权限缓存键值结构
  - 不动 workspace_id=None 分支行为（require_permission_any 入口语义保持）
  - 测试断言归 task-05，本 task 只改实现与 docstring
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
