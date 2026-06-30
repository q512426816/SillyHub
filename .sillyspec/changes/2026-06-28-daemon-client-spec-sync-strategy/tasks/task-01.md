---
author: qinyi
created_at: 2026-06-30T10:20:00
task_id: task-01
status: implemented
---
# task-01: WorkspaceCreate 加 spec_strategy 字段

## 状态：已实现（回填蓝图，代码已 apply）
**实现位置**：`backend/app/modules/workspace/schema.py:16,129`（`WorkspaceCreate.spec_strategy` + `ScanGenerateRequest.spec_strategy`）

## 目标
WorkspaceCreate schema 加 spec_strategy，Literal 三值，默认 platform-managed。

## 接口定义
`spec_strategy: Literal["platform-managed","repo-mirrored","repo-native"] = "platform-managed"`

## 验收标准（已通过）
- [x] WorkspaceCreate 接受 spec_strategy 三值，默认 platform-managed
- [x] ScanGenerateRequest 同字段

## 覆盖
FR-01, D-001@v1, D-004@v1。参考 design §5.1 Phase1。
