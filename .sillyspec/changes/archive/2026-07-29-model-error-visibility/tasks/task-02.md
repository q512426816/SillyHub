---
id: task-02
title: daemon model-error/classifier.ts 实现 + 单测覆盖 8 类
title_zh: 实现 daemon 模型错误归类器并覆盖 8 类错误单测
author: qinyi
created_at: 2026-07-29 10:34:02
priority: P0
depends_on: [task-01]
blocks: [task-03]
requirement_ids: [FR-01]
decision_ids: [D-003@v1, D-006@v1]
allowed_paths:
  - sillyhub-daemon/src/model-error/classifier.ts
  - sillyhub-daemon/tests/model-error/classifier.test.ts
provides:
  - contract: classifyModelError
    fields: [input, output]
expects_from:
  task-01:
    - contract: ModelError
      needs: [type, code, message, retryable, hint, raw]
goal: >
  实现 claude 错误归类器，将 is_error/resultText/api_retry/assistant stdout 归类为 ModelError，覆盖 8 类错误。
implementation:
  - 新增 classifier.ts，实现 classifyModelError(input) 返回 ModelError 或 null（非模型错误）
  - 归类规则用关键词/正则匹配 resultText 与 apiRetryError
  - 429 含「上限/quota」归 quota_exceeded（retryable=false），含「Too Many Requests/rate limit」归 rate_limited（retryable=true）
  - 401/403/invalid api key 归 auth_failed；timeout 归 timeout；model not found 归 model_not_found；ECONNREFUSED/ENOTFOUND 归 network；5xx/internal 归 provider_error；兜底 unknown
  - 按 agent 类型分发（claude 实现，其他 agent 预留扩展点返回 unknown）
acceptance:
  - classifyModelError 对 8 类错误输入各返回正确 type
  - 429 quota_exceeded 与 rate_limited 正确区分且 retryable 正确
  - 非模型错误（is_error=false）返回 null
verify:
  - cd sillyhub-daemon && pnpm test tests/model-error/classifier.test.ts
constraints:
  - 仅 claude 归类，其他 agent 预留扩展点不实现（D-001）
  - 关键词匹配有 unknown 兜底，至少显示「运行失败」+raw（R-01）
  - 不接入 stream-json adapter（留 task-03）
---
