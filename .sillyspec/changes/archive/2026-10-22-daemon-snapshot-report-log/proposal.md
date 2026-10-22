---
author: flow-machine-draft
created_at: 2026-10-22T00:44:48.379Z
---
# 提案书（Proposal）— 2026-10-22-daemon-snapshot-report-log

## 动机

任务原话转写：daemon 快照上报补收口日志

文档面跟着新口径走：2026-10-22-file-card-hide-empty 已把前端「仅工具编辑」降级卡下线（无数据一律不出卡），但 daemon 侧两处注释仍写「前端走『仅工具编辑』降级卡」（hub-client.ts:1269-1276、daemon.ts:4486-4493），与实际不符。另外查「历史轮没有文件变更卡」时无法区分『没采到』与『采到但没落库』——采集器有 turn_file_changes_collected，上报侧只有失败 warn、成功无日志。

成功标准：
- 上述两处注释改为新口径（无数据不出卡 / 后端 capability=tool_only 语义保留），不再出现「前端走『仅工具编辑』降级卡」表述
- 每次快照上报都打一条结构化日志 turn_file_changes_reported，含 outcome=delivered|failed|enqueued|dropped、drop_reason、status、reason、file_count、collect_ms、elapsed_ms，失败另带 error
- 采集器既有 turn_file_changes_collected 日志与字段零变化（两条日志配对即可判「没采到」vs「采到没落库」）
- daemon tsc --noEmit 退出 0；新增上报收口日志用例全绿；既有 tests/interactive/turn-file-changes.test.ts 不回归

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. 上述两处注释改为新口径（无数据不出卡 / 后端 capability=tool_only 语义保留），不再出现「前端走『仅工具编辑』降级卡」表述
2. 每次快照上报都打一条结构化日志 turn_file_changes_reported，含 outcome=delivered|failed|enqueued|dropped、drop_reason、status、reason、file_count、collect_ms、elapsed_ms，失败另带 error
3. 采集器既有 turn_file_changes_collected 日志与字段零变化（两条日志配对即可判「没采到」vs「采到没落库」）
4. daemon tsc --noEmit 退出 0；新增上报收口日志用例全绿；既有 tests/interactive/turn-file-changes.test.ts 不回归

## 成功标准（可验证）

1. 上述两处注释改为新口径（无数据不出卡 / 后端 capability=tool_only 语义保留），不再出现「前端走『仅工具编辑』降级卡」表述
2. 每次快照上报都打一条结构化日志 turn_file_changes_reported，含 outcome=delivered|failed|enqueued|dropped、drop_reason、status、reason、file_count、collect_ms、elapsed_ms，失败另带 error
3. 采集器既有 turn_file_changes_collected 日志与字段零变化（两条日志配对即可判「没采到」vs「采到没落库」）
4. daemon tsc --noEmit 退出 0；新增上报收口日志用例全绿；既有 tests/interactive/turn-file-changes.test.ts 不回归
