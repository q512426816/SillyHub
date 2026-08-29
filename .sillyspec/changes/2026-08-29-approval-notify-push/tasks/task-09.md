---
id: task-09
title: 'pnpm gen:types 类型同步（openapi.json + api-types.ts）'
title_zh: 'pnpm gen:types 类型同步（openapi.json + api-types.ts）'
author: 'qinyi'
created_at: 2026-08-29 21:04:42
priority: P0
depends_on: ['task-07', 'task-08']
blocks: []
requirement_ids: [FR-09]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
expects_from:
  - task: task-07
    contract: NotificationRead
    needs: [id, type, title, link, read_at]
  - task: task-07
    contract: NotificationListResponse
    needs: [items, total]
  - task: task-07
    contract: UnreadCountResponse
    needs: [count]
goal: >
  在 task-07/08 的通知端点合入后运行 pnpm gen:types，重新生成 openapi.json 与
  api-types.ts，使前端拿到通知相关类型供后续 UI task 消费。
implementation:
  - 确认 task-07 REST 四端点与 task-08 SSE 端点已实现并注册
  - 在 frontend 下运行 pnpm gen:types 重新生成类型
  - 检查 api-types.ts 中 NotificationRead / NotificationListResponse / UnreadCountResponse 字段完整
acceptance:
  - openapi.json 包含 /api/notifications 系列端点定义
  - api-types.ts 含三个通知 DTO 且字段与 expects_from 一致
  - tsc --noEmit 通过，无类型回归
verify:
  - cd frontend && pnpm gen:types
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 跑 gen:types 前先确认 frontend/node_modules 健康（必要时 pnpm install）
  - 仅生成类型，不手改 api-types.ts，不做前端 UI 改动
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
