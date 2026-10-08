---
author: flow-machine-draft
created_at: 2026-10-08T03:57:52.316Z
---
# 提案书（Proposal）— 2026-10-08-backend-restart-fake-failed

## 动机

任务原话转写：后端重启会把正在运行的轮误标为 SERVICE_RESTART_INTERRUPTED 失败（_cleanup_stale_runs_impl 只看数据库状态不探测 daemon 活性），且 daemon 迟到的成功结果被 interactive_run_close_already_terminal 拒收无法回正，UI 永远显示假失败。
成功标准：
- 后端重启清理时，近期仍有 daemon 上报的运行轮不再被判死，等真终态
- 被误标 SERVICE_RESTART_INTERRUPTED 的轮收到 daemon 迟到的成功结果后能回正为 completed
- 补充对应用例覆盖上述两条路径

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. 后端重启清理时，近期仍有 daemon 上报的运行轮不再被判死，等真终态
2. 被误标 SERVICE_RESTART_INTERRUPTED 的轮收到 daemon 迟到的成功结果后能回正为 completed
3. 补充对应用例覆盖上述两条路径

## 成功标准（可验证）

1. 后端重启清理时，近期仍有 daemon 上报的运行轮不再被判死，等真终态
2. 被误标 SERVICE_RESTART_INTERRUPTED 的轮收到 daemon 迟到的成功结果后能回正为 completed
3. 补充对应用例覆盖上述两条路径
