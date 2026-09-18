---
id: task-05
title: 'menu_overrides_router 子路由三端点（GET 认证 / PUT/DELETE menu:admin）+ main.py 挂载'
title_zh: 'menu_overrides_router 子路由三端点（GET 认证 / PUT/DELETE menu:admin）+ main.py 挂载'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-09-18 14:46:09
priority: P0
depends_on: ['task-04']
blocks: []
requirement_ids: [FR-02, FR-05]
decision_ids: [D-002@v1]
provides:
  - contract: MenuOverrideEndpoints
    fields: [get_public_list, put_override, delete_override]
allowed_paths:
  - NEW:backend/app/modules/admin/menu_overrides_router.py
  - backend/app/main.py
target_files:
  - NEW:backend/app/modules/admin/menu_overrides_router.py
  - backend/app/main.py
goal: >
  新建 menu_overrides 子路由文件并在 main.py 挂载，落地三端点——GET /api/menu-overrides 仅需认证供导航消费、
  PUT 与 DELETE 挂 menu:admin 门控走审计；admin 主 router 自带 /admin 前缀承载不了公开读路径（审查 B-01）。
implementation:
  - 新建 menu_overrides_router.py——APIRouter 自带 prefix /menu-overrides（模块内子路由先例 agent/profile/router.py）；GET 列表仅 Depends(get_current_user) 认证，返回 items 的 MenuOverrideRead 列表
  - PUT/DELETE 挂路径参数 menu_key——门控用 require_permission_any(Permission.MENU_ADMIN)（无 workspace 端点惯例，admin roles 端点同款；require_permission 需 workspace_id 路径参数不适用）；PUT 收 MenuOverrideUpsert 返回 MenuOverrideRead，DELETE 返 204
  - 业务全委派 task-04 的 MenuOverridesService（校验与审计在 service 层）；main.py 挂载区 admin_router 行附近加 include_router(menu_overrides_router, prefix=/api) 与变更注释（先例 platform_sync 子路由 main.py:961/966）
acceptance:
  - GET 未认证 401；任意已认证用户 200 拿到全量覆盖 items（FR-05 下发端点）
  - 无 menu:admin 的用户调 PUT/DELETE 得 403 中文文案；持权限时 upsert 返回 MenuOverrideRead、DELETE 返 204 且各写一条审计
  - 三端点实际路径 /api/menu-overrides 与 /api/menu-overrides/{menu_key}，出现在 openapi 中
verify:
  - cd backend && uv run ruff check app/modules/admin/menu_overrides_router.py app/main.py
  - cd backend && uv run mypy app
constraints:
  - 不入 admin 主 router（prefix=/admin 会把公开读端点推到 /api/admin 下，B-01 根因）
  - router 不写业务逻辑不直接碰表——校验、审计、upsert 语义全在 task-04 service
  - 后端不校验 menu_key 是否在前端注册表（孤儿行由前端合并层忽略 R-01）
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
