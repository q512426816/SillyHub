---
id: task-03
title: '后端 router 两端点（POST 写鉴权 / GET 读 scope）'
title_zh: '后端 router 两端点（POST 写鉴权 / GET 读 scope）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-23 04:16:42
priority: P0
depends_on: ['task-02']
blocks: [task-04]
requirement_ids: [FR-01, FR-04]
decision_ids: [D-001]
allowed_paths:
  - backend/app/modules/platform_sync/router.py
target_files:
  - backend/app/modules/platform_sync/router.py
goal: >
  POST/GET /changes/{name}/events 两端点接线（鉴权同款 platform_sync 通道，design 接口定义节）。
implementation:
  - router.py 在 GET /changes/{name}/approval 之后追加两路由（参数路由区，不新增字面量段，R-01）：
    POST /changes/{name}/events（_write_auth；scope.workspace_id None → 403 防御，对齐 quicklog 范式）→
    PlatformSyncService.append_events → ChangeEventPushOk
  - GET /changes/{name}/events（_read_auth + _read_args(scope) 翻译；since: str|None Query 校验 ISO 解析失败 422；
    limit: int Query 默认 500 ge=1 le=5000）→ list_events → ChangeEventListResponse（无事件 200 空列表不 404）
  - 模块 docstring 端点清单追加两行（注释与实现一致，CLAUDE.md 规则 18）
acceptance:
  - POST 无凭据 401 / shk_live_·JWT 403 / shpsync_ 200（鉴权矩阵 FR-01）
  - GET since 无效格式 422、合法增量正序（FR-04）
verify:
  - cd backend && uv run ruff check app/modules/platform_sync/ && uv run mypy app
constraints:
  - workspace_id 只从 token 派生（body 不含 workspace 字段，G6 同款）
  - 路由注册不引入字面量 `-` 段（避开 design R-01 路由顺序风险）
  - 红线（D-004）：router 只收发透传，零业务判定——不触发通知/审批/门控
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
