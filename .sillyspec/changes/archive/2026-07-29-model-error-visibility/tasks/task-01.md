---
id: task-01
title: 定义三端同构 ModelError 协议 + 类型枚举
title_zh: 定义三端同构模型错误协议与类型枚举
author: qinyi
created_at: 2026-07-29 10:34:02
priority: P0
depends_on: []
blocks: [task-02, task-06]
requirement_ids: [FR-01]
decision_ids: [D-001@v1, D-003@v1, D-005@v1, D-006@v1]
allowed_paths:
  - sillyhub-daemon/src/model-error/types.ts
  - sillyhub-daemon/src/model-error/index.ts
  - backend/app/modules/daemon/model_error.py
provides:
  - contract: ModelError
    fields: [type, code, message, retryable, hint, raw]
  - contract: ModelErrorDTO
    fields: [type, code, message, retryable, hint, raw]
goal: >
  定义跨三端同构的 ModelError 协议与 8 类 type 枚举，作为错误可见性的契约核心（daemon types + backend DTO）。
implementation:
  - 新增 sillyhub-daemon/src/model-error/types.ts，定义 ModelErrorType 枚举（auth_failed/quota_exceeded/rate_limited/timeout/model_not_found/network/provider_error/unknown）与 ModelError 接口（type/code/message/retryable/hint/raw）
  - 新增 model-error/index.ts 导出类型与枚举
  - 新增 backend/app/modules/daemon/model_error.py，定义 ModelErrorDTO（pydantic，type/code/message/retryable/hint/raw，字段与 daemon 同构）
  - 429 区分 quota_exceeded（不可重试）与 rate_limited（可重试）写入枚举注释，依据 D-006
acceptance:
  - ModelErrorType 枚举含全部 8 个类型
  - daemon ModelError 与 backend ModelErrorDTO 字段完全同构（type/code/message/retryable/hint/raw）
  - tsc 与 mypy 均通过类型校验
verify:
  - cd sillyhub-daemon && pnpm typecheck
  - cd backend && uv run mypy app/modules/daemon/model_error.py
constraints:
  - 仅定义协议与类型，不实现 classifier 逻辑（留 task-02）
  - 不手写 frontend api-types（前端类型经 pnpm gen:types 从后端生成，留 task-07）
  - 429 两类区分依据错误文本，retryable 语义见 D-006
---
