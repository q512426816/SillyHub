---
id: task-08
title: 'GET /changes/-/spec-bundle（前置注册 + 鉴权矩阵）+ X-Spec-Version 头 + PLATFORM-BUNDLE.json'
title_zh: 'GET /changes/-/spec-bundle（前置注册 + 鉴权矩阵）+ X-Spec-Version 头 + PLATFORM-BUNDLE.json'
author: 'qinyi'
created_at: 2026-08-29 12:57:58
priority: P0
depends_on: []
blocks: ['task-09', 'task-10', 'task-14']
requirement_ids: [FR-07, FR-08]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/platform_sync/router.py
  - backend/app/modules/platform_sync/tests/test_spec_bundle.py
  - backend/app/modules/spec_workspace/router.py
  - backend/app/modules/spec_workspace/service.py
  - backend/app/modules/spec_workspace/tests/test_bundle_sync.py
provides:
  - 'GET /api/changes/-/spec-bundle（shpsync_ token 可拉 tar；Content-Disposition 文件名 + X-Spec-Version 响应头）'
  - '两处 bundle（新端点 + 既有 GET /workspaces/{ws}/spec-workspace/bundle）tar 顶层 PLATFORM-BUNDLE.json {spec_version, strategy, generated_at, server}'
goal: >
  为 CLI 直跑补只读拉取口子：新增 GET /changes/-/spec-bundle（仅 shpsync_ 鉴权 + 字面量路由
  前置注册），并给两处 bundle 输出补快照元数据（X-Spec-Version 响应头 + tar 顶层
  PLATFORM-BUNDLE.json），使持 shpsync token 的 CLI 可拉整树、离线可辨快照新旧
  （design §7.1/§7.3，FR-07/FR-08）。
implementation:
  - 'platform_sync/router.py 新增 GET /changes/-/spec-bundle：鉴权用既有 _write_auth（require_platform_sync_write，auth.py:166-176，仅 shpsync_ token，JWT/shk_live_ 403——对齐 spec-manifest 先例 router.py:175-196）；scope.workspace_id 为 None 时 403 fail-closed（照 :190-194 范式）；内部调 SpecWorkspaceService.build_bundle(scope.workspace_id) 返回 StreamingResponse（media_type=application/x-tar，headers 含 Content-Disposition 与 X-Spec-Version）'
  - '路由顺序硬约束：字面量 - 段路由注册在 /changes/{name}/... 参数路由之前（沿用 router.py:170-172 顺序注记；FastAPI 按注册顺序匹配，防 {name} 贪婪匹配吞掉 - 段——R-06 ppm export-excel 同款坑）'
  - 'spec_workspace/service.py build_bundle（:630-675）改点：tar 顶层新增内存生成的 PLATFORM-BUNDLE.json 成员，内容 {spec_version, strategy, generated_at, server}（spec_ws 已在 :643 取得；generated_at 取打包时刻 UTC ISO 时间；成员由内存构造，不经 rglob 磁盘读取、不落 spec_root，避免污染镜像树与 manifest 对账）'
  - 'spec_version 透出到响应头：build_bundle 返回值携带版本（扩展返回元组，或路由侧经 service.get 复取，实现自选）；既有 GET /workspaces/{ws}/spec-workspace/bundle（spec_workspace/router.py:77-97）在现有 headers 中追加 X-Spec-Version，值 = spec_ws.spec_version'
  - '新增 platform_sync/tests/test_spec_bundle.py（照 test_spec_sync.py 的 spec_env + shpsync_headers fixture 范式）：鉴权矩阵五分支（无凭据 401 / JWT 403 / shk_live_ 403 / shpsync_ 本 workspace 200 + application/x-tar / scope.workspace_id 空 403 fail-closed）；路由前置命中断言（请求 /api/changes/-/spec-bundle 得 tar 流而非 {name}=- 的其它端点响应）；tar 内容断言（顶层 PLATFORM-BUNDLE.json 四键、.runtime/ 与 local.yaml 排除）'
  - '扩展 spec_workspace/tests/test_bundle_sync.py：既有 bundle 端点 X-Spec-Version 响应头断言 + tar 顶层 PLATFORM-BUNDLE.json 断言 + .runtime/local.yaml 排除零回归'
acceptance:
  - 'GET /api/changes/-/spec-bundle：shpsync_ token 200 + application/x-tar 且 tar 可解包；无凭据 401；JWT 403；shk_live_/API key 403；scope.workspace_id 为空 403 fail-closed（矩阵五分支全绿）'
  - '字面量路由未被 /changes/{name} 吞：GET /api/changes/-/spec-bundle 命中 bundle 端点（R-06 测试证据）'
  - 'GET /api/workspaces/{ws}/spec-workspace/bundle 响应头含 X-Spec-Version，值等于 spec_ws.spec_version'
  - '两处 bundle tar 顶层均含 PLATFORM-BUNDLE.json，含 spec_version/strategy/generated_at/server 四键'
  - 'tar 仍排除任意深度 .runtime/ 与 SERVER_EXCLUDED_FILENAMES（local.yaml，service.py:70）——既有过滤零回归'
  - 'PLATFORM-BUNDLE.json 仅存在于 tar 流内，服务器 spec_root 磁盘无该文件（镜像树零残留）'
verify:
  - cd backend && uv run pytest app/modules/platform_sync/tests/test_spec_bundle.py -q --no-cov
  - cd backend && uv run pytest app/modules/spec_workspace/tests/test_bundle_sync.py -q --no-cov
  - cd backend && uv run ruff format --check app/modules/platform_sync app/modules/spec_workspace && uv run ruff check app/modules/platform_sync app/modules/spec_workspace
constraints:
  - '鉴权仅 _write_auth（require_platform_sync_write，仅 shpsync_）：只读拉 bundle 是 shpsync_ 既有 spec-sync 写能力的严格子集，无越权扩大（design §7.1 权限评估）；不用 _read_auth（避免非同步方探测文件布局）'
  - '字面量 /changes/-/spec-bundle 注册顺序不可妥协：前置于 /changes/{name}/... 路由（router.py:170-172 注记）'
  - 'PLATFORM-BUNDLE.json 不进 OpenAPI DTO（响应为二进制流）；backend/openapi.json 与 frontend api-types.ts 再生成不在本任务落盘（归 gen:types 统一时点，避免 Wave 内文件冲突）'
  - '不动 daemon 与前端（daemon 兼容回归归 task-10、下载按钮归 task-09）；不动 daemon pull/push 时机；bundle 排除 local.yaml 的 token 防泄漏语义不变'
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
