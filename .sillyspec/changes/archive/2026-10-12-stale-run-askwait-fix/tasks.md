---
author: flow-machine-draft
created_at: 2026-10-12T10:18:11.320Z
---
# 任务注册表（Tasks）— 2026-10-12-stale-run-askwait-fix

- [x] task-01: 后端：启动清理判死前检查「最后一条 ask 信号日志（pending_input 通道或 tool_call 通道 tool_kind=ask）晚于最后一条 user_input 日志」，命中则跳过判死保持 running。
- [x] task-02: 后端：SERVICE_RESTART_INTERRUPTED 终态化的 output_redacted 改为中文可读原因（经 failure_summary 透出前端错误卡），error_detail 形状不变。
- [x] task-03: 前端：buildErrorLogItem 对无模型错误键（type/code/message/retryable/hint/raw/reset_at 均缺）的字典返回 null，回落 buildSystemFailureItem。
- [x] task-04: 前端：SYSTEM_ERROR_CODE_META 收录 SERVICE_RESTART_INTERRUPTED（PowerOff 图标、中性蓝灰、中文 hint）。
- [x] task-05: 前端：任务日志页（agent-run-panel/agent-log-viewer）透传 error_code + failure_summary，normalizeLogs 兜底链接入 buildSystemFailureItem。
- [x] task-06: 后端测试：等待用户回答的 running 轮豁免判死（保持 running）；已回答（user_input 晚于 ask）的停滞轮照常判死；failed 分支补 output_redacted 中文断言。
- [x] task-07: 前端测试：alien 字典回落、SERVICE_RESTART_INTERRUPTED 卡片元数据、normalizeLogs 兜底链。
