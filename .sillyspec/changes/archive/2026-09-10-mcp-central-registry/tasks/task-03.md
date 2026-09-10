---
id: task-03
title: 'router 层——/api/mcp-servers* 端点 + 权限'
title_zh: 'router 层——/api/mcp-servers* 端点 + 权限'
author: 'qinyi'
created_at: 2026-09-10 11:18:41
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-01, FR-03]
decision_ids: [D-001, D-007]
provides:
  - contract: mcp-servers REST API
    fields: [list_servers, create_server, get_server, update_server, delete_server, bindings, import_json, workspace_scan, workspace_import_apply, templates, diagnostics]
  - contract: McpServerList
    fields: [id, name, server_type, server_config, tags, enabled, bindings]
expects_from:
  task-02:
    - contract: McpRegistryService
      needs: [list_servers, create_server, update_server, delete_server, add_binding, remove_binding]
allowed_paths:
  - backend/app/modules/mcp_registry/router.py
  - backend/app/modules/mcp_registry/tests/
  - backend/app/main.py
target_files:
  - NEW:backend/app/modules/mcp_registry/router.py
  - NEW:backend/app/modules/mcp_registry/tests/test_router.py
  - backend/app/main.py
goal: >
  新建 mcp_registry/router.py 按 design 接口定义节落地 13 个 /api/mcp-servers* 端点与双层权限矩阵（平台库写 SETTINGS_ADMIN、我的库登录即可、跨用户私有 404 防枚举），并在 main.py include_router 区注册，为前端管理页提供完整 API 面。
implementation:
  - 新建 router.py——仿 settings/router.py:55 定义 SettingsAdminUser（require_permission_any(Permission.SETTINGS_ADMIN)，auth_deps 导入）与 CurrentUser（get_current_user）依赖别名，APIRouter 挂 mcp-registry tag
  - 落地 design REST 清单 13 端点（列表/创建/详情/更新/删除/加绑定/解绑/import-json/workspace-scan/workspace-import-apply/templates 列表/存模板/diagnostics）；静态段路由必须声明在 /{id} 参数路由之前，防 GET templates 被 {id} 吞掉
  - 端点薄封装转调 McpRegistryService 六方法；导入/模板/诊断端点对 importer 与 render 与模板函数用函数体内惰性 import 委托（先例 settings/router.py:89），本卡不实现其内部逻辑
  - 权限矩阵——平台库写（创建 scope=platform、平台 server 的更新删除、platform 绑定解绑、apply 平台导入）挂 SettingsAdminUser；读与我的库操作挂 CurrentUser；跨用户私有由 service 抛 404（与不存在同码防枚举，对齐 skills/service.py:79 先例）
  - main.py 注册——import router 并在 :824-840 同族 include_router 区追加 app.include_router(mcp_registry_router, prefix="/api")
  - 新增 tests/test_router.py（tests 目录带 __init__.py 与 conftest.py 仿 daemon/tests 惯例）覆盖权限矩阵（非 admin 平台写 403、跨用户 404）与 CRUD happy path
acceptance:
  - openapi.json 含全部 13 个 /api/mcp-servers* path 且 GET templates 不被 {id} 参数路由遮蔽
  - 非 admin 调平台库写端点 403；登录用户访问他人私有 server 404（与不存在同码）
  - 列表与详情 env 脱敏由 DTO 与 service 保证，端点透传不自行拼装明文
verify:
  - cd backend && uv run pytest app/modules/mcp_registry -q
  - cd backend && uv run ruff check app/modules/mcp_registry app/main.py
  - cd backend && uv run mypy app/modules/mcp_registry
constraints:
  - 端点只做参数校验与权限挂载，业务规则留在 service；渲染/导入/模板逻辑分别归 task-04 与 task-08/09/10（惰性委托签名 import_from_json、scan_workspaces、apply_workspace_import、模板 list/save 以对应卡为准）
  - 不动 settings/router.py 旧 MCP KV 端点（移除归 task-13）与 mcp.whitelist 两端点（D-007 白名单留 settings）
  - 仅跑 mcp_registry 相关测试（CLAUDE.md 规则 0 禁全量）
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
