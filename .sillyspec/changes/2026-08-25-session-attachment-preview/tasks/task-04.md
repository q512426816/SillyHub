---
id: task-04
title: 'export-fetch-attachment-blob'
title_zh: 'fetchAttachmentBlob 导出 + 401 单飞刷新对齐'
author: 'WhaleFall'
created_at: 2026-08-25 01:29:35
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: []
provides: [{contract: fetchAttachmentBlob, fields: [blob]}]
allowed_paths:
  - frontend/src/lib/api/session-attachments.ts
goal: >
  在 lib/api/session-attachments.ts 新增 fetchAttachmentBlob(id) 导出返回 Blob，供 docx、xlsx、markdown 渲染器消费，并对齐 fetchFileBlob 的 401 单飞刷新重试语义（design F-5）。
implementation:
  - 参照 lib/file/api.ts 的 fetchFileBlob 语义实现，先带 Bearer 拉既有 content 端点，401 时经 lib/token-refresh 的 ensureFreshAccessToken 单飞刷新后重试一次
  - 刷新失败或重试仍 401 时抛登录已过期错误，其余非 ok 抛含状态码的错误，成功返回响应 blob
  - 既有 fetchAttachmentObjectUrl 导出保持不动（attachment-chips 调用方不受影响），新导出补注释说明二者关系
acceptance:
  - fetchAttachmentBlob 作为新导出可用，返回 Blob 的 Promise，可被 useObjectUrl 的 fetcher 直接消费
  - 401 时先单飞刷新 token 再重试一次，语义与 fetchFileBlob 一致（F-5）
  - 既有 fetchAttachmentObjectUrl 行为不变，typecheck 与既有测试不受影响
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test -- sessions
constraints:
  - 只改 frontend/src/lib/api/session-attachments.ts，token-refresh.ts 仅只读引用不列入改动
  - 不改后端与任何端点形态，不加新测试文件（既有 sessions 页面测试作回归）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
