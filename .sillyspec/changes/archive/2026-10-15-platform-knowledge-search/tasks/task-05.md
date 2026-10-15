---
id: task-05
title: 'gen:types dual-end + closure verification'
title_zh: '类型生成双端与收口（gen:types/测试全绿/实测回填）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-15 16:26:20
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-01, FR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
  - sillyhub-daemon/src/api-types.ts
target_files:
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
  - sillyhub-daemon/src/api-types.ts
expects_from:
  task-02:
    - contract: KnowledgeSearchIn
      needs: [query, limit]
    - contract: KnowledgeSearchResultItem
      needs: [spec_path, kind, title, anchor, snippet, score]
    - contract: KnowledgeSearchOut
      needs: [ok, results, model_ready, reason]
goal: >
  履行规则 21 双端类型生成义务（后端 schema 改动 → openapi.json 重 dump + 前端与 daemon 各自
  api-types.ts 重生成，同一变更内提交，防 ci-fast-gate 漂移闸门拦）；并做收口：相关测试全绿、
  实测首查索引构建耗时（R-01）与融合排序抽验（R-03）回填文档。
implementation:
  - 确认 backend/openapi.json 已含 POST /api/workspaces/{workspace_id}/knowledge/search 与 KnowledgeSearchIn/KnowledgeSearchResultItem/KnowledgeSearchOut 三 schema（后端实现的 dump 产物——按仓库既有 dump 流程刷新）
  - cd frontend && pnpm gen:types（生成 frontend/src/lib/api-types.ts）；先确认 node_modules 健康（pnpm exec tsc --version 可跑，规则 21——半坏 node_modules 会报假 CSSProperties 错）
  - cd sillyhub-daemon && pnpm gen:types（生成 sillyhub-daemon/src/api-types.ts；规则 21 daemon 同款义务）
  - 跑相关测试：cd backend && uv run pytest app/modules/knowledge/tests -q；cd frontend && pnpm exec vitest run "src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx" "src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx"（以及被断言耦合的 page-sync/explorer-page 两个既有测试——plan 审查观察项）
  - 实测：对真实 spec 语料发起一次搜索（走端点或直调 search_sync），记录首查索引构建耗时与 chunk 数（R-01）；人工抽验 3-5 组 query（中文自然语言 1-2 组 + 精确编号 1-2 组 + 模块文档 1 组）核对 top 结果（R-03）；结论写回 design.md 风险登记段（或 verify-result 承接）
acceptance:
  - backend/openapi.json、frontend/src/lib/api-types.ts、sillyhub-daemon/src/api-types.ts 三产物同步（无漂移，含新端点与三 schema）
  - git diff 三者均为纯新增（无对其他 schema 的意外改写）
  - 后端 knowledge 模块测试全绿 + 前端知识库/scan-docs 页测试全绿 + page-sync/explorer-page 既有测试不红
  - R-01 实测数字与 R-03 抽验结论已回填文档（超 5s 时已在 task-03 落地 loading 文案；超 30s 记录留待后续评估预热钩子）
verify:
  - cd frontend && pnpm exec tsc --version && pnpm gen:types && git diff --stat frontend/src/lib/api-types.ts
  - cd sillyhub-daemon && pnpm gen:types && git diff --stat sillyhub-daemon/src/api-types.ts
  - cd backend && uv run pytest app/modules/knowledge/tests -q
constraints:
  - MUST NOT 手写 api-types.ts（一律生成物，规则 21）
  - gen:types 前 MUST 确认 node_modules 健康（半坏环境报假错，先 pnpm install --force 修复再生成）
  - MUST NOT 利用本卡修改服务/端点实现逻辑（只做生成与收口；生成暴露的实现问题回对应 task 修复）
  - 禁跑全量测试（规则 0）；实测只用本仓 spec 语料，不起额外服务
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
