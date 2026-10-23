---
author: flow-machine-draft
created_at: 2026-10-23T16:20:53.971Z
---
# 提案书（Proposal）— 2026-10-24-close-run-quota-fallback

## 动机

任务原话转写：交互轮失败后端从日志兜底识别限额错误
动机：旧版 daemon 终态上报不带模型错误详情时，供应商限额用完的失败轮在会话里显示「运行失败 · unknown（执行端未回传详细原因）」，真实限额原因（含重置时间）无法触达用户——2026-10-23 会话 OpenCode Go 限额 run 0278895b 实证：日志留有完整 429/1308 文本但 error_detail 为空。
成功标准：
- close_interactive_run 收到 is_error=true 且 error=None 时，从该 run 已落库日志的 [ASSISTANT] 行提取 API Error 文本，命中限额特征（429 + 上限/额度/配额/quota/usage limit 等）时补写 error_detail（type=quota_exceeded，code/message/hint/raw/reset_at 语义与 daemon model-error/classifier 对齐）
- 新 daemon 已回传 error 时不覆盖，现行为不变
- 日志无 API Error 行或不命中限额特征时行为不变（error_detail 保持 NULL，既有兜底文案照旧）
- 补 backend 测试覆盖上述分支，既有相关测试不回归

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. close_interactive_run 收到 is_error=true 且 error=None 时，从该 run 已落库日志的 [ASSISTANT] 行提取 API Error 文本，命中限额特征（429 + 上限/额度/配额/quota/usage limit 等）时补写 error_detail（type=quota_exceeded，code/message/hint/raw/reset_at 语义与 daemon model-error/classifier 对齐）
2. 新 daemon 已回传 error 时不覆盖，现行为不变
3. 日志无 API Error 行或不命中限额特征时行为不变（error_detail 保持 NULL，既有兜底文案照旧）
4. 补 backend 测试覆盖上述分支，既有相关测试不回归

## 成功标准（可验证）

1. close_interactive_run 收到 is_error=true 且 error=None 时，从该 run 已落库日志的 [ASSISTANT] 行提取 API Error 文本，命中限额特征（429 + 上限/额度/配额/quota/usage limit 等）时补写 error_detail（type=quota_exceeded，code/message/hint/raw/reset_at 语义与 daemon model-error/classifier 对齐）
2. 新 daemon 已回传 error 时不覆盖，现行为不变
3. 日志无 API Error 行或不命中限额特征时行为不变（error_detail 保持 NULL，既有兜底文案照旧）
4. 补 backend 测试覆盖上述分支，既有相关测试不回归
