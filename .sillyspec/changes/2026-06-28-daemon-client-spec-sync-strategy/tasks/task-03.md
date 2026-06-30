---
author: qinyi
created_at: 2026-06-30T10:20:00
task_id: task-03
status: implemented
---
# task-03: start_scan_dispatch 读 strategy + AgentRun 去硬编码 + dispatch 加参数

## 状态：已实现（回填蓝图，代码已 apply）
**实现位置**：`backend/app/modules/agent/service.py:1285-1291`（`start_scan_dispatch` 从 `spec_ws.strategy` 读，回退 platform-managed）；`:1387`（AgentRun.spec_strategy 写真实值，去硬编码）；`:1420`（`prepare_scan_interactive_dispatch` 加 strategy 参数）

## 目标
start_scan_dispatch 读 spec_ws.strategy（不再硬编码 platform-managed）；AgentRun.spec_strategy 写真实值；prepare_scan_interactive_dispatch 加 strategy 参数。

## 验收标准（已通过）
- [x] start_scan_dispatch 从 spec_ws.strategy 读（回退 platform-managed）
- [x] AgentRun.spec_strategy 写真实值
- [x] prepare_scan_interactive_dispatch 加 strategy 参数

## 覆盖
FR-03, FR-12, D-001@v1。参考 design §5.1 Phase1。
