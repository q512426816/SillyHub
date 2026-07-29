---
id: task-03
title: daemon stream-json adapter 接入 classifier
title_zh: stream-json 适配器接入错误归类器
author: qinyi
created_at: 2026-07-29 10:34:02
priority: P0
depends_on: [task-02]
blocks: [task-04]
requirement_ids: [FR-01]
decision_ids: [D-005@v1]
allowed_paths:
  - sillyhub-daemon/src/adapters/stream-json.ts
provides:
  - contract: StreamJsonModelError
    fields: [type, code, message, retryable, hint, raw]
expects_from:
  task-02:
    - contract: classifyModelError
      needs: [output]
goal: >
  stream-json adapter 在 result is_error=true 时调 classifier 产出 ModelError，缓存供 turn 收尾使用。
implementation:
  - stream-json.ts:902-904 已提取 isError/resultText/lastResultInfo，在此基础上 result 收尾时若 isError 调 classifyModelError
  - 输入组装 isError/subtype/resultText/apiRetryError/assistantStdout 调 classifier
  - 将产出的 ModelError 缓存到 lastResultInfo 或独立字段，供 task-04 notifyRunResult 取用
  - is_error=false 不调 classifier（无 ModelError，成功路径不回归）
acceptance:
  - result is_error=true 时 stream-json 产出 ModelError 并缓存
  - is_error=false 时不产出 ModelError
  - api_retry 事件的 error 字段纳入 classifier 输入
verify:
  - cd sillyhub-daemon && pnpm typecheck
  - cd sillyhub-daemon && pnpm test（含 stream-json 相关测试不回归）
constraints:
  - 不改 notifyRunResult payload（留 task-04）
  - 保留既有 lastResultInfo 提取逻辑，只增 classifier 调用
  - assistantStdout 取最近 [ASSISTANT] stdout（含 API Error 文本）
---
