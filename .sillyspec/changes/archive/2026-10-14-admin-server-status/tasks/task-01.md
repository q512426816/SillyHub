---
id: task-01
title: 'Add SYSTEM_STATUS_READ permission and gate system-status endpoint'
title_zh: '后端权限与鉴权——枚举新增 SYSTEM_STATUS_READ + 计数锚 59→60 + /system-status 挂 require_permission_any + 三态用例'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-15 00:21:05
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-03]
decision_ids: [D-001@v2, D-004@v1]
allowed_paths:
  - backend/app/modules/auth/permissions.py
  - backend/app/modules/health/router.py
  - backend/tests/test_health.py
  - backend/tests/modules/auth/test_permissions.py
target_files:
  - backend/app/modules/auth/permissions.py
  - backend/app/modules/health/router.py
  - backend/tests/test_health.py
  - backend/tests/modules/auth/test_permissions.py
provides:
  - contract: Permission.SYSTEM_STATUS_READ
    fields: [system_status:read]
goal: >
  为服务器信息页提供权限地基并关闭审计 BS-06：Permission 枚举新增 SYSTEM_STATUS_READ，
  GET /api/system-status 由公开收紧为登录 + require_permission_any，配三态鉴权用例。
implementation:
  - backend/app/modules/auth/permissions.py 枚举 Platform 段新增 SYSTEM_STATUS_READ = "system_status:read"（紧邻 GIT_IDENTITY_ADMIN 之后，对齐既有命名风格；group 前缀无特判走默认分支归 PermissionGroup.PLATFORM，同 menu:admin 模式）
  - backend/app/modules/health/router.py:80 system_status 端点签名加 CurrentUser 依赖（require_permission_any(Permission.SYSTEM_STATUS_READ)，写法对齐 backend/app/modules/settings/router.py:54 的 Annotated[User, Depends] 惯例）；docstring 删「公开端点」表述改为权限说明；响应体与 SystemStatusResponse 零变化
  - backend/tests/modules/auth/test_permissions.py:51 枚举 len 硬计数锚 59→60（先例 2026-10-14-deploy-release-notes 58→59 同模式）
  - backend/tests/test_health.py 补三态用例：未登录 401 / 登录无权限 403 / 持 system_status:read 或 platform:admin 200（复用该文件既有 stub db/redis fixture 模式）
acceptance:
  - uv run python -c "from app.modules.auth.permissions import Permission; assert Permission.SYSTEM_STATUS_READ.value == 'system_status:read'"
  - test_health.py 三态用例通过（401/403/200，200 响应字段与既有 schema 一致）
  - test_permissions.py 通过（len 锚 60）
  - 无种子迁移（不新增 alembic versions 文件；管理员经 is_platform_admin 短路天然放行）
verify:
  - cd backend && uv run pytest tests/test_health.py tests/modules/auth/test_permissions.py -q --no-cov
constraints:
  - 不改 backend/app/modules/health/schema.py（SystemStatusResponse 零变化）
  - /api/health 与 /api/version 保持公开不动
  - 无 alembic 迁移、无 role_permissions 种子（D-004@v1 收紧语义）
related_tests:
  - path: backend/tests/modules/auth/test_permissions.py
    reason: Permission 枚举 len 硬计数锚 59 因新增成员失效，需同步 59→60
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
