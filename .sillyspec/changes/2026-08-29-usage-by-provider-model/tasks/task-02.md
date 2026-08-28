---
id: task-02
title: 'schema 扩展 + pnpm gen:types（InteractiveRunResultRequest 增 model_usage[]/api_requests；RuntimeUsageRead 增 by_provider）'
title_zh: 'schema 扩展 + pnpm gen:types（InteractiveRunResultRequest 增 model_usage[]/api_requests；RuntimeUsageRead 增 by_provider）'
author: 'qinyi'
created_at: 2026-08-29 02:52:55
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-01-3, FR-04-1]
decision_ids: [D-001@v1, D-003@v1]
allowed_paths:
  - backend/app/modules/daemon/schema.py
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
goal: >
  扩终态请求与统计响应契约：InteractiveRunResultRequest 增 model_usage[]/api_requests；RuntimeUsageRead 增 by_provider（ProviderModelUsageRead），并 gen:types 同步前端类型。
implementation:
  - schema.py：ModelUsageItemRead（model+四维+api_requests）与 by_provider 列表模型
  - 跑 pnpm gen:types 重生成 api-types.ts + openapi.json 一并落盘
acceptance:
  - gen:types 产物含新字段且 tsc 0
  - schema 单测/既有契约测试绿
verify:
  - cd frontend && pnpm gen:types && pnpm exec tsc --noEmit
constraints:
  - 纯契约扩展可选字段，不破坏既有消费方；gen:types 前确认 node_modules 健康（CLAUDE.md 规则21）
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
