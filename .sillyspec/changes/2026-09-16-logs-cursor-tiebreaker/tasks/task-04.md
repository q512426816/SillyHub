---
id: task-04
title: 'openapi.json 重导出 + 前端 pnpm gen:types（api-types.ts 提交，rule 21 不欠类型债）'
title_zh: 'openapi.json 重导出 + 前端 pnpm gen:types（api-types.ts 提交，rule 21 不欠类型债）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-16 08:17:13
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
target_files:
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
expects_from:
  - field: before_id (query param in OpenAPI)
    from: task-02 端点定义
depends_on: [task-02]
goal: >
  OpenAPI 重导出 + 前端类型再生成（rule 21：schema 变更同一变更内同步，不欠类型债）。
implementation:
  - 重导出 backend/openapi.json（走仓内既有导出入口，先 grep Makefile/scripts 确认命令）
  - cd frontend && pnpm gen:types 再生成 api-types.ts
  - 两文件随本任务提交
acceptance:
  - openapi.json 日志端点含 before_id 查询参数（uuid, optional）
  - api-types.ts 同步更新；pnpm gen:types:check 零漂移
verify:
  - cd frontend && pnpm gen:types:check
constraints:
  - 只重生成不改手写内容
  - gen:types 前确认 frontend node_modules 健康（CLAUDE.md 规则 21：tsc --version 可跑）
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
