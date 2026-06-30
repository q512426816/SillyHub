---
author: qinyi
created_at: 2026-06-30T10:20:00
task_id: task-06
status: implemented
---
# task-06: types.ts LeaseCtx 加 specStrategy

## 状态：已实现（回填蓝图，代码已 apply）
**实现位置**：`sillyhub-daemon/src/types.ts:300`（`LeaseCtx.specStrategy?: string`，workspaceId:293 之后，注释 ql-20260628）

## 目标
LeaseCtx（execPayload）加 specStrategy?: string 字段。

## 验收标准（已通过）
- [x] LeaseCtx 含 specStrategy?: string

## 覆盖
FR-04, D-001@v1。参考 design §5.2 Phase2。
