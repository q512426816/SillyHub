---
author: flow-machine-draft
created_at: 2026-10-12T10:18:11.320Z
---
# 提案书（Proposal）— 2026-10-12-stale-run-askwait-fix

## 动机

任务原话转写：动机：生产实证（阿里云会话 47e2ff1a）：交互轮 AskUserQuestion 等待用户回答期间日志静默，后端重启时启动清理按 10 分钟宽限窗误判死亡（SERVICE_RESTART_INTERRUPTED），且该错误在前端显示为「运行失败 · unknown」无任何原因。
成功标准：
- 后端：启动清理判死前检查「最后一条 ask 信号日志（pending_input 通道或 tool_call 通道 tool_kind=ask）晚于最后一条 user_input 日志」，命中则跳过判死保持 running。
- 后端：SERVICE_RESTART_INTERRUPTED 终态化的 output_redacted 改为中文可读原因（经 failure_summary 透出前端错误卡），error_detail 形状不变。
- 前端：buildErrorLogItem 对无模型错误键（type/code/message/retryable/hint/raw/reset_at 均缺）的字典返回 null，回落 buildSystemFailureItem。
- 前端：SYSTEM_ERROR_CODE_META 收录 SERVICE_RESTART_INTERRUPTED（PowerOff 图标、中性蓝灰、中文 hint）。
- 前端：任务日志页（agent-run-panel/agent-log-viewer）透传 error_code + failure_summary，normalizeLogs 兜底链接入 buildSystemFailureItem。
- 后端测试：等待用户回答的 running 轮豁免判死（保持 running）；已回答（user_input 晚于 ask）的停滞轮照常判死；failed 分支补 output_redacted 中文断言。
- 前端测试：alien 字典回落、SERVICE_RESTART_INTERRUPTED 卡片元数据、normalizeLogs 兜底链。

## 变更范围

按成功标准机械推导，共 7 条验收面：
1. 后端：启动清理判死前检查「最后一条 ask 信号日志（pending_input 通道或 tool_call 通道 tool_kind=ask）晚于最后一条 user_input 日志」，命中则跳过判死保持 running。
2. 后端：SERVICE_RESTART_INTERRUPTED 终态化的 output_redacted 改为中文可读原因（经 failure_summary 透出前端错误卡），error_detail 形状不变。
3. 前端：buildErrorLogItem 对无模型错误键（type/code/message/retryable/hint/raw/reset_at 均缺）的字典返回 null，回落 buildSystemFailureItem。
4. 前端：SYSTEM_ERROR_CODE_META 收录 SERVICE_RESTART_INTERRUPTED（PowerOff 图标、中性蓝灰、中文 hint）。
5. 前端：任务日志页（agent-run-panel/agent-log-viewer）透传 error_code + failure_summary，normalizeLogs 兜底链接入 buildSystemFailureItem。
6. 后端测试：等待用户回答的 running 轮豁免判死（保持 running）；已回答（user_input 晚于 ask）的停滞轮照常判死；failed 分支补 output_redacted 中文断言。
7. 前端测试：alien 字典回落、SERVICE_RESTART_INTERRUPTED 卡片元数据、normalizeLogs 兜底链。

## 成功标准（可验证）

1. 后端：启动清理判死前检查「最后一条 ask 信号日志（pending_input 通道或 tool_call 通道 tool_kind=ask）晚于最后一条 user_input 日志」，命中则跳过判死保持 running。
2. 后端：SERVICE_RESTART_INTERRUPTED 终态化的 output_redacted 改为中文可读原因（经 failure_summary 透出前端错误卡），error_detail 形状不变。
3. 前端：buildErrorLogItem 对无模型错误键（type/code/message/retryable/hint/raw/reset_at 均缺）的字典返回 null，回落 buildSystemFailureItem。
4. 前端：SYSTEM_ERROR_CODE_META 收录 SERVICE_RESTART_INTERRUPTED（PowerOff 图标、中性蓝灰、中文 hint）。
5. 前端：任务日志页（agent-run-panel/agent-log-viewer）透传 error_code + failure_summary，normalizeLogs 兜底链接入 buildSystemFailureItem。
6. 后端测试：等待用户回答的 running 轮豁免判死（保持 running）；已回答（user_input 晚于 ask）的停滞轮照常判死；failed 分支补 output_redacted 中文断言。
7. 前端测试：alien 字典回落、SERVICE_RESTART_INTERRUPTED 卡片元数据、normalizeLogs 兜底链。
