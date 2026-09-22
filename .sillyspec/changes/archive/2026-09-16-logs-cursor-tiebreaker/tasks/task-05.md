---
id: task-05
title: 'sessions.ts getAgentSessionLogs opts+params 加 beforeId（仅与 before 同时传）'
title_zh: 'sessions.ts getAgentSessionLogs opts+params 加 beforeId（仅与 before 同时传）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-16 08:17:13
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/lib/daemon/sessions.ts
target_files:
  - frontend/src/lib/daemon/sessions.ts
expects_from:
  - field: before_id (query param)
    from: task-04 api-types 生成的端点参数
goal: >
  前端 API client 支持可选 beforeId 查询参数（仅与 before 同时传）。
implementation:
  - getAgentSessionLogs opts 类型加 beforeId?: string（:647 旁）
  - params.set("before_id", v)（:655 旁，与 before 同条件生效）
  - 函数头 JSDoc before 参数说明补复合游标语义
acceptance:
  - 带 before+beforeId 时请求 query 含 before_id；只带 beforeId 不带 before 时不发（防 422）
  - tsc 0 错误
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不动 after/q/limit 参数处理
  - 不改函数签名结构（只加可选字段）
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
