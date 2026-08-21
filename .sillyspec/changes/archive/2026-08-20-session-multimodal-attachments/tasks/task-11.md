---
id: task-11
title: frontend-attachment-api-client-and-type-regen
title_zh: api-types 重生成与附件 API 封装
author: WhaleFall
created_at: 2026-08-20 15:13:46
priority: P0
depends_on: [task-04]
blocks: [task-12, task-13]
requirement_ids: [FR-1, FR-3, FR-6]
decision_ids: [D-9]
allowed_paths:
  - frontend/src/lib/api-types.ts
  - frontend/src/lib/api/session-attachments.ts
  - frontend/src/lib/api/llm-providers.ts
provides:
  - contract: AttachmentApi
    fields: [upload, remove, contentUrl]
  - contract: LlmProviderRead
    fields: [multimodal]
expects_from: {}
goal: >
  重生成前端 api-types 拿到附件生成类型，新建附件 API 封装（上传/删除/内容地址），并在供应商手写类型上透出 multimodal 三态字段。
implementation:
  - 前置确认 Wave1/W2 已完成（task-04 等），backend/openapi.json 已含 session-attachments 端点与 llm_providers multimodal 字段
  - 按仓库规则 21 先确认 node_modules 健康（pnpm exec tsc --version 能跑，半坏先 pnpm install --force）
  - 在 frontend 下执行 pnpm gen:types 重生成 src/lib/api-types.ts，确认 AttachmentRead 生成类型与 SessionInjectRequest 的 attachment_ids 字段出现
  - 新建 frontend/src/lib/api/session-attachments.ts，导出 upload（multipart POST /api/daemon/session-attachments）、remove（DELETE /{id}）、contentUrl（返回 GET /{id}/content 的 URL 字符串）三函数，类型一律引用生成 api-types，禁止手写 DTO
  - multipart 说明——apiFetch 仅支持 json 通道且 body 被 Omit，upload 封装内用原生 fetch 组 FormData，accessToken 从与 api.ts 同源的 useSession store 读取并带 Bearer 头，错误按 ApiError 口径透出不静默；lib/api.ts 本卡不拥有不改
  - 从设计 §3 摘出前端预检常量（图片 png/jpeg/webp/gif 单张 5MB 每消息 5 张；文件单份 20MB 每消息 5 份）供 task-12 复用，与后端校验同源不偏离
  - api/llm-providers.ts 在手写 LlmProviderRead/LlmProviderCreate/LlmProviderUpdate 与 LlmProviderFormValues 上补 multimodal 三态字段（auto/true/false，缺省 auto），同步文件头手写类型债的登记注释
acceptance:
  - pnpm gen:types 后 api-types.ts 含 AttachmentRead 等生成类型，git diff 仅为生成差异，无手写痕迹
  - session-attachments.ts 三函数可用且类型来自生成 api-types
  - LlmProviderRead.multimodal 可被供应商表单与会话面板编译期读取
  - upload 请求带 Bearer 鉴权，4xx 错误信息透出到调用方
verify:
  - cd frontend && pnpm gen:types && pnpm typecheck
constraints:
  - 规则 21 api-types 必须生成禁止手写
  - gen:types 前先确认 node_modules 健康，防假 CSSProperties 类报错误判
  - 本卡不拥有 lib/api.ts，multipart 走封装内原生 fetch，不动 apiFetch
  - backend/openapi.json 由后端 Wave 任务产出，本卡只消费不回写
related_tests: []
---
