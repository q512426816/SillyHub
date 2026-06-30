---
author: qinyi
created_at: 2026-06-30T10:20:00
task_id: task-04
status: implemented
---
# task-04: build_claim_payload 透传 strategy

## 状态：已实现（回填蓝图，代码已 apply）
**实现位置**：`backend/app/modules/daemon/lease/context.py:144-147`（interactive/tar 分支双写 `specStrategy`+`spec_strategy`，来源 `lease_meta["spec_strategy"]`，placement.py:492 写入 lease metadata）；仅在 transport=="tar" 分支透传（daemon-client 走 tar）

## 目标
build_claim_payload interactive 分支透传 specStrategy，与 transport/workspaceId 并列。

## 验收标准（已通过）
- [x] scan lease claim payload 含 specStrategy（tar 分支）
- [x] 来源 lease_meta["spec_strategy"]

## 覆盖
FR-03, D-001@v1。参考 design §5.1 Phase1。
