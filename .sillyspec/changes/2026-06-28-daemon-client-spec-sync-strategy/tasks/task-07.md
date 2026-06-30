---
author: qinyi
created_at: 2026-06-30T10:20:00
task_id: task-07
status: implemented
---
# task-07: daemon.ts 读取 specStrategy 传 pullSpecBundle

## 状态：已实现（回填蓝图，代码已 apply）
**实现位置**：`sillyhub-daemon/src/daemon.ts:2294-2299`（`_startInteractiveSession` 读 `execPayload.specStrategy`，camelCase + snake_case 兜底）；`:2312-2316`（传 `{ strategy, rootPath }` 给 pullSpecBundle）

## 目标
_startInteractiveSession 读 execPayload.specStrategy 传入 pullSpecBundle。

## 验收标准（已通过）
- [x] 读 execPayload.specStrategy（camelCase + snake_case 兜底）
- [x] 传 pullSpecBundle {strategy, rootPath}
- [x] 缺字段按 platform-managed 兼容

## 覆盖
FR-04, D-001@v1。参考 design §5.2 Phase2。
