---
author: flow-machine-draft
created_at: 2026-10-22T00:44:48.379Z
---
# 任务注册表（Tasks）— 2026-10-22-daemon-snapshot-report-log

- [ ] task-01: 上述两处注释改为新口径（无数据不出卡 / 后端 capability=tool_only 语义保留），不再出现「前端走『仅工具编辑』降级卡」表述
- [ ] task-02: 每次快照上报都打一条结构化日志 turn_file_changes_reported，含 outcome=delivered|failed|enqueued|dropped、drop_reason、status、reason、file_count、collect_ms、elapsed_ms，失败另带 error
- [ ] task-03: 采集器既有 turn_file_changes_collected 日志与字段零变化（两条日志配对即可判「没采到」vs「采到没落库」）
- [ ] task-04: daemon tsc --noEmit 退出 0；新增上报收口日志用例全绿；既有 tests/interactive/turn-file-changes.test.ts 不回归
