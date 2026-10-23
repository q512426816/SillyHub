---
author: flow-machine-draft
created_at: 2026-10-23T16:20:53.971Z
---
# 任务注册表（Tasks）— 2026-10-24-close-run-quota-fallback

- [x] task-01: close_run_steps.py 新增 `_infer_quota_error` 纯函数——429+限额关键词判定、方括号业务码提取、reset_at 解析，正则与文案逐条对齐 sillyhub-daemon/src/model-error/classifier.ts（classifyBlob 规则 1 / extractCode / extractResetAt / ERROR_INFO.quota_exceeded）；验证：对 2026-10-23 实证文本「API Error: Request rejected (429) · [1308][已达到 5 小时的使用上限。您的限额将在 2026-10-23 13:27:04 重置。]」产出 type=quota_exceeded/code=1308/reset_at=2026-10-23T13:27:04+08:00，对「API Error: 401 invalid api key」返回 None
- [x] task-02: close_run_steps.py 新增 `_infer_quota_model_error_from_logs` helper（查该 run 日志 channel='stdout' 含 "API Error" 倒序 3 行 + result_summary 拼文本，查日志异常吞掉 warn）并在 `close_interactive_run` 编排层接线——is_error=True 且 error=None 时推断补 error 参数（daemon 已回传不触发，_close_apply_terminal/_close_post_commit 零改动）；验证：新测试文件用例通过
- [x] task-03: 新增 backend/app/modules/daemon/tests/test_close_interactive_run_quota_log_fallback.py 覆盖 FR-01（日志兜底/result_summary 兜底）/FR-02（daemon 优先）/FR-03（非限额不伪造/无日志不伪造）五用例；验证：新文件 5 用例 + test_close_interactive_run_model_error.py 既有回归全绿（18 passed，ruff check/format 通过）
