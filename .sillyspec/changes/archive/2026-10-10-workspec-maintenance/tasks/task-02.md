---
id: task-02
title: 'backend CRUD API 与权限——共享登记四端点 + my-path upsert 端点 + 越权/重名用例（FR-01/FR-02）'
title_zh: 'backend CRUD API 与权限——共享登记四端点 + my-path upsert 端点 + 越权/重名用例（FR-01/FR-02）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-10 19:04:59
priority: P0
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: [D-006@v1, D-007@v1]
depends_on: [task-01]
allowed_paths:
  - backend/app/modules/workspace/linked_repos/schema.py
  - backend/app/modules/workspace/linked_repos/service.py
  - backend/app/modules/workspace/linked_repos/router.py
  - backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py
  - backend/app/main.py
target_files:
  - NEW:backend/app/modules/workspace/linked_repos/schema.py
  - NEW:backend/app/modules/workspace/linked_repos/service.py
  - NEW:backend/app/modules/workspace/linked_repos/router.py
  - NEW:backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py
  - backend/app/main.py
provides:
  crud-api:
    endpoints: ["GET /api/workspaces/{id}/linked-repos", "POST /api/workspaces/{id}/linked-repos", "PATCH /api/workspaces/{id}/linked-repos/{rid}", "DELETE /api/workspaces/{id}/linked-repos/{rid}", "PUT /api/workspaces/{id}/linked-repos/{rid}/my-path"]
    permissions: "写=owner/admin；my-path=成员本人（upsert，null 清除）；读=工作区成员"
    shapes: "GET 响应 items[] 含 id/name/repo_url/description/rel_path/my_path/sync_status_summary（summary 本 task 返回空占位，task-03 接管填充）"
expects_from:
  task-01:
    db-schema: "三表/唯一约束/级联（见 task-01 provides.db-schema）"
goal: >
  关联仓 CRUD API 与权限：共享登记四端点 + 成员级 my-path upsert + GET 聚合视图骨架
  （design.md 接口定义节；FR-01/FR-02）。
implementation:
  - schema.py：Pydantic v2 请求/响应（Create/Update/MyPathIn/LinkedRepoOut——字段对齐
    design 接口定义，无 relation_kind）
  - service.py：CRUD（重名 409）+ 权限（owner/admin 写共享字段、成员本人 my-path、
    越权 403）+ DELETE 级联 + GET 聚合（my_path=当前用户行；sync_status_summary 留空占位）
  - router.py：APIRouter(prefix 同 workspace 域形态) 挂五端点
  - backend/app/main.py：import + sibling include（仿 members_router 先例
    backend/app/main.py:867；禁止在 workspace/router.py 嵌套挂载——main.py:864-868
    注释警告 Duplicated param name workspace_id 坑）
  - tests/test_linked_repos.py：CRUD/权限/越权 403/重名 409/级联清理/my-path upsert
    与 null 清除/GET 聚合视图用例
acceptance:
  - FR-01/FR-02 的 Given/When/Then 全部通过（pytest 绿）
  - 普通成员改共享字段或他人 my-path 返回 403；重名创建返回 409
  - DELETE 后成员路径行与状态行级联消失（复用 task-01 级联）
verify:
  - cd backend && uv run pytest app/modules/workspace/linked_repos/tests -q --no-cov
constraints:
  - 不做同步触发与回报端点（task-03）；sync_status_summary 本 task 返回空结构占位
  - main.py 仅新增 import + include 两行，不动其它 include
  - 禁跑全量 pytest（CLAUDE.md 规则 0）
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
