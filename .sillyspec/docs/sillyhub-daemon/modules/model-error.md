---
schema_version: 1
doc_type: module-card
module_id: model-error
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 模型错误协议与归类（model-error）

## 定位
claude 模型调用失败的标准错误协议与归类器（目录 `src/model-error/`，3 文件）。
types.ts 定义三端同构协议（与 backend `app/modules/daemon/model_error.py` 的
ModelErrorDTO 一一对应）；classifier.ts 把 claude turn 的多来源失败文本按
关键词/正则归类成结构化 ModelError；index.ts 仅 re-export 类型。纯函数无副作用，
仅 run 失败（is_error=true）时产生，成功路径不产生（D-008）。

## 契约摘要
- `ModelErrorType` 8 类：`auth_failed`（401/403）/ `quota_exceeded`（429 额度耗尽，
  **不可重试**）/ `rate_limited`（429 瞬时限流，**可重试**，D-006 按文本区分）/
  `timeout` / `model_not_found` / `network`（连接失败/DNS）/ `provider_error`（5xx）/
  `unknown`（兜底）。
- `ModelError`：`{ type, code, message, retryable, hint, raw }`——code 为原始错误码
  （如 "1310"/"429"/null），message/hint 中文，raw 存拼接后的原始文本。
- `classifyModelError(input: ClassifyModelInput): ModelError | null`——输入
  `{ agent, isError, subtype?, resultText?, apiRetryError?, assistantStdout?, stderrText? }`，
  五个文本来源（stream-json parseResult / api_retry 事件 / [ASSISTANT] stdout /
  spawn stderr）全部拼 blob 参与匹配。
- `ERROR_INFO` 表：每类固定 `{ message, hint, retryable }` 文案。

## 关键逻辑
```
classifyModelError(input):
  isError=false → null（成功 turn 即便残留 api_retry 文本也不算失败）
  agent != 'claude' → unknown（D-001 仅 claude 归类，其余 agent 扩展点兜底）
  blob = resultText|apiRetryError|assistantStdout|stderrText 拼接
  type = classifyClaude(blob)：优先级从上到下取第一条命中
    429+额度/quota 词 → quota_exceeded；其余 429 → rate_limited；
    401/403/凭证 → auth_failed；timeout/ETIMEDOUT → timeout；
    model not found → model_not_found；ECONN*/ENOTFOUND → network；
    5xx/internal → provider_error；都不中 → unknown
  code = extractCode(blob)：方括号业务码[1310] > EN*/EAI* 网络码 > HTTP 状态码
```

## 注意事项
- 规则顺序有讲究：429 必须先于其他 4xx/5xx 判定（quota 关键词先于裸 429）；
  AbortError 类信号不在本模块（那是 resilience/error-classify 的网络层重试判定）。
- `quota_exceeded` 与 `rate_limited` 同为 429 但 retryable 相反，影响 backend
  重发 action 与前端 hint，勿合并。
- 消费方：`adapters/stream-json.ts` 与 `interactive/session-manager.ts` 调
  classifyModelError（经 `../model-error/classifier.js` 直接 import）；
  `daemon.ts` / `hub-client.ts` 仅 type-only import ModelError；
  index.ts 不导出 classifier（历史遗留 task-01 只导类型，勿经 index 引归类器）。
- classifyClaude 正则带中文关键词（上限/额度/凭证/无法连接等），错误文本可能
  是 claude CLI 转译后的中文，双语都要匹配。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
