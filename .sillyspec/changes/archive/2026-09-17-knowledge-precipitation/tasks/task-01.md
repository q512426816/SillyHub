---
id: task-01
title: 'zone-ify backend knowledge read path with recursive parser and regenerated types'
title_zh: 'backend 读侧 zone 化（parser 递归 + schema/service 透传 + openapi/api-types 再生成）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-17 10:44:49
priority: P0
depends_on: []
blocks: ['task-03', 'task-04']
requirement_ids: [FR-06]
decision_ids: [D-004@v1, D-007@v1]
allowed_paths:
  - backend/app/modules/knowledge/parser.py
  - backend/app/modules/knowledge/schema.py
  - backend/app/modules/knowledge/service.py
  - backend/app/modules/knowledge/tests/test_parser.py
  - backend/app/modules/knowledge/tests/test_router.py
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
target_files:
  - backend/app/modules/knowledge/parser.py
  - backend/app/modules/knowledge/schema.py
  - backend/app/modules/knowledge/service.py
  - backend/app/modules/knowledge/tests/test_parser.py
  - backend/app/modules/knowledge/tests/test_router.py
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
provides:
  - contract: KnowledgeEntryRead
    fields: [zone, filename, path, title, last_modified_at]
goal: >
  知识库读侧由顶层非递归 glob（backend/app/modules/knowledge/parser.py 的非递归 glob）改为 rglob 递归解析并按 zone
  （top/decisions/generated/proposed）透出，使 decisions/、generated/、proposed/
  子目录知识对网页可见（D-004 缺陷修复）；顶层条目 filename/path 值与响应字段
  保持逐字兼容——只增 zone 不删不改（D-007 path 前缀规范 + X-02 兼容承诺）。
implementation:
  - parser.py 解析改 rglob 递归且仅作用于 knowledge（quicklog 解析零改动——parse_md_directory 两处共用需加递归开关或等效拆分）；ParsedEntry 增 zone 字段，由 filename 首段派生（decisions/generated/proposed 之外归 top）
  - filename 语义扩展为 knowledge/ 下含子目录段的相对路径（如 decisions/daemon.md），顶层条目值不变；path 保留 .sillyspec/knowledge/ 前缀拼完整相对路径（.sillyspec/knowledge/decisions/daemon.md），顶层条目值不变
  - schema.py KnowledgeEntry（design 记作 KnowledgeEntryRead 的读侧条目 DTO）增 zone 字段（str）；service.py _to_knowledge_entry 透传 zone；get_knowledge 维持按 filename 精确匹配（含子目录段后值天然唯一，消除跨 zone 同名歧义）
  - _extract_title/_read_file_safe 复用不动；_spec_content_root 解析优先级不动；path traversal 校验对子目录文件继续生效
  - test_parser.py 增子目录递归、zone 派生、顶层 filename/path 值回归用例；test_router.py 增列表含子目录条目与跨目录同名 get 各自命中用例（既有 total==2 等断言零变化）
  - 跑 pnpm gen:types 再生成并提交 backend/openapi.json 与 frontend/src/lib/api-types.ts（禁手写类型）
acceptance:
  - 列表含 decisions/ 与 generated/ 子目录条目且 zone 正确（top/decisions/generated/proposed 四值覆盖）
  - 顶层条目 filename 与 path 值和改造前逐字一致（回归断言，既有断言零变化）
  - 跨目录同名文件按含子目录段的 filename get 各自命中；不存在维持既有 WorkspaceNotFound 语义
  - GET /knowledge 响应只增 zone 字段；quicklog 两端点行为与响应结构零变化
verify:
  - cd backend && uv run pytest app/modules/knowledge -q
  - cd frontend && pnpm gen:types && pnpm exec tsc --noEmit
constraints:
  - 不动 router 权限与路由注册、quicklog 解析、_spec_content_root；不建写路径（写侧归 task-04）
  - 不引入 zone 过滤参数或读索引（R-07 维持无索引实时解析现状）
  - gen:types 前确认前端 node_modules 健康（pnpm exec tsc --version 可跑），半坏用 pnpm install --force 修复再生成
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
