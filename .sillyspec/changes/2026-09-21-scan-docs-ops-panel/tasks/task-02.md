---
id: task-02
title: 'type chain sync (gen:types + lib client)'
title_zh: '类型链同步（gen:types 再生成 + lib 客户端封装）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-21 09:58:52
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
  - frontend/src/lib/scan-docs.ts
target_files:
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
  - frontend/src/lib/scan-docs.ts
expects_from:
  - task-01: ScanDocsStatsOut DTO 族已落 backend/app/modules/scan_docs/schema.py 且 OpenAPI schema 可导出
provides:
  - getScanDocsStats(workspaceId) 封装 + scanDocsStatsQueryKey(workspaceId) 查询键（frontend/src/lib/scan-docs.ts）
  - components["schemas"]["ScanDocsStatsOut"] 生成类型（frontend/src/lib/api-types.ts）
goal: >
  把 task-01 的 stats DTO 经 OpenAPI 生成链同步到前端：api-types.ts/openapi.json
  再生成提交，lib 层封装 stats 客户端函数与 react-query 查询键，供面板消费。
implementation:
  - 验证 frontend node_modules 健康（pnpm exec tsc --version 能跑），异常先 pnpm install --force
  - 后端起 OpenAPI 导出或按仓内既有 gen:types 流程跑 pnpm gen:types，再生成 frontend/src/lib/api-types.ts 与 backend/openapi.json
  - frontend/src/lib/scan-docs.ts 新增 ScanDocsStats 类型导出（= components["schemas"]["ScanDocsStatsOut"]）+ getScanDocsStats(workspaceId)（GET /api/workspaces/{ws}/scan-docs/stats）+ scanDocsStatsQueryKey(workspaceId)（返回 ["scan-docs","stats",ws] as const，对齐 knowledgeStatsQueryKey 形态）
acceptance:
  - frontend/src/lib/api-types.ts 含 ScanDocsStatsOut 族全部 9 类（含 injection 嵌套）
  - backend/openapi.json 含 /workspaces/{workspace_id}/scan-docs/stats 路径定义
  - frontend/src/lib/scan-docs.ts 的 getScanDocsStats/scanDocsStatsQueryKey 可被 tsc 解析（无手写类型）
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec eslint src/lib/scan-docs.ts
constraints:
  - 禁手写 DTO 类型（全部从生成类型引用）
  - 不改 scan-docs.ts 既有四个函数行为
  - gen:types 若暴露无关旧测试债，按惯例顺手补字段而非改回手写
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
