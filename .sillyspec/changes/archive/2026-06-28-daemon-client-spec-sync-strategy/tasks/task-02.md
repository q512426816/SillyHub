---
author: qinyi
created_at: 2026-06-30T10:20:00
task_id: task-02
status: implemented
---
# task-02: _ensure_empty_spec_workspace 接收 strategy + 创建分支落库

## 状态：已实现（回填蓝图，代码已 apply）
**实现位置**：`backend/app/modules/workspace/service.py:1137-1157`（`_ensure_empty_spec_workspace(*, strategy="platform-managed")` 去硬编码）；调用点 `:210`（create daemon-client）、`:343`（activate）、`:1100`（scan_generate_daemon_client 创建 pending）传 strategy 落库

## 目标
_ensure_empty_spec_workspace 接收 strategy 参数写 spec_workspaces.strategy，去掉原硬编码 platform-managed；create/activate/scan-generate 三入口传 strategy。

## 验收标准（已通过）
- [x] _ensure_empty_spec_workspace 接收 strategy 参数
- [x] create/activate/scan_generate_daemon_client 三入口传用户选择的 strategy
- [x] server-local 不受影响（D-003，走 _ensure_spec_workspace copytree）

## 覆盖
FR-02, D-001@v1, D-003@v1, D-004@v1。参考 design §5.1 Phase1。
