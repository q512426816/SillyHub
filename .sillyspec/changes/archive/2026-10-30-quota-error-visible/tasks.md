---
author: flow-machine-draft
created_at: 2026-10-30T07:46:14.817Z
---
# 任务注册表（Tasks）— 2026-10-30-quota-error-visible

- [x] task-01: 在 close_run_steps.py 实现 success 轮末条 [ASSISTANT] 额度错误兜底（剥前缀 + 行首锚定 + 复用 _infer_quota_error），命中时 is_error=true 并按 failed/error_detail 收口；跑 backend/app/modules/daemon/tests/test_close_interactive_run_quota_log_fallback.py 新增主路径用例验证。
- [x] task-02: 为兜底加反例门——末条错误后存在正常 [ASSISTANT] 文本、或末条为 [ASSISTANT] [MODEL_RETRY] 时必须保持 completed/error_detail NULL；同文件补两用例并跑绿。
- [x] task-03: 在 frontend runtime-session-helpers.tsx 的 logsToTurns 增加末条 [ASSISTANT] 额度错误回填（errorDetail=quota_exceeded + status=failed），并在 runtime-session-helpers.test.tsx 补正向用例 + 正常成功轮零变化用例，跑 vitest 与 tsc。
- [x] task-04: 回归验证——重跑 backend 收口测试文件、frontend 相关测试文件与 lint/tsc，确认既有失败轮/成功轮断言零回归并记录结果。
