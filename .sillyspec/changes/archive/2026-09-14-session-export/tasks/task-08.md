---
id: task-08
title: '类型同步——pnpm gen:types + api-types.ts/openapi.json 提交 + ruff/mypy/eslint 聚焦收口'
title_zh: '类型同步——pnpm gen:types + api-types.ts/openapi.json 提交 + ruff/mypy/eslint 聚焦收口'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-14 14:06:52
priority: P0
depends_on: ['task-03', 'task-04', 'task-06', 'task-07']
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-002@v1]
expects_from: ['task-03（后端 SessionExportRequest schema + /sessions/export 路由已就位，可 dump 进 OpenAPI）', 'task-05（session-export.ts 本地请求类型，可选切换为生成类型）']
allowed_paths:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - frontend/src/lib/daemon/session-export.ts
target_files:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
goal: >
  运行 pnpm gen:types 把 SessionExportRequest 与 POST /sessions/export 端点同步进 api-types.ts 并提交刷新后的
  openapi.json，完成 ruff/mypy/eslint 聚焦收口，确保前端类型不落后后端 schema 形成债（FR-07、CLAUDE.md 规则 21）。
implementation:
  - 前置健康检查：cd frontend && pnpm exec tsc --version 能正常出版本号；若报假 CSSProperties/缺模块类错误即 node_modules 半坏，跑 pnpm install --force 重建（普通 install 命中缓存不修 .bin shim）
  - cd frontend && pnpm gen:types（一条龙：backend dump_openapi.py 刷新 openapi.json → openapi-typescript 生成 api-types.ts → 顺跑 sillyhub-daemon gen-provider-caps）
  - git diff 审查生成产物：api-types.ts 仅新增 SessionExportRequest/导出端点相关类型、既有类型零破坏；openapi.json 只增不改，可用 pnpm gen:types:check 复核守门
  - 可选切换：若生成类型形状可用，把 frontend/src/lib/daemon/session-export.ts 的本地请求类型切到 api-types.ts 生成类型；import 不顺或形状不匹配则保留本地类型不硬切
  - 聚焦收口：backend ruff check + ruff format --check 与 mypy 对本次触碰的 daemon 相关文件绿；前端 eslint 对触碰文件绿；tsc 暴露无关旧类型债按仓库惯例顺手修（不扩大范围重构）
acceptance:
  - pnpm gen:types 成功且 api-types.ts diff 仅含导出相关新增、既有类型零破坏（全局验收 5）
  - backend/openapi.json 含 POST /api/daemon/sessions/export 与 SessionExportRequest schema，OpenAPI 只增不改
  - ruff check/format 与 mypy 聚焦绿、前端 eslint 触碰文件绿（全局验收 6）
  - cd frontend && pnpm exec tsc --noEmit 通过
verify:
  - cd frontend && pnpm gen:types:check（再生成 + git diff --exit-code，确认提交产物与后端 schema 一致）
  - cd frontend && pnpm exec tsc --noEmit
  - git diff --stat 确认变更面仅限 allowed_paths（api-types.ts/openapi.json/可选 session-export.ts）
constraints:
  - 禁止跑全量测试（后端 pytest/前端 vitest 已由 task-04/07 覆盖，本 task 仅类型生成 + lint 聚焦）
  - 禁止手写编辑 api-types.ts（该文件只允许 gen:types 产物）；openapi.json 不得触碰既有端点定义
  - 遵守 CLAUDE.md 规则 21：类型同步是提交守门，不让前端类型落后后端形成债
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
