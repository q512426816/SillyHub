---
author: qinyi
created_at: 2026-07-06 19:09:09
---
# Tasks

> 细节在 plan 阶段展开。本表只列名称 / 文件 / 覆盖 FR / 决策。

## Spike（W1 前）
- **spike-01** WS RPC 现有能力核实（daemon-entity-binding per-daemon WS 是否支持双向请求/响应匹配）— D-007

## W1 基础设施（4 task）
- task-01 HostFsDelegate 抽象（backend/app/modules/daemon/host_fs/delegate.py）— FR-01 / D-001 D-004 D-005
- task-02 WS RPC 请求/响应匹配（backend host_fs/ws_rpc.py + sillyhub-daemon ws-rpc 扩展）— FR-02 / D-005 D-007
- task-03 daemon host_fs WS handler（sillyhub-daemon/src/host-fs-handler.ts，注册 daemon.ts）— FR-02
- task-04 异步容错/超时/幂等（HostFsDelegate + handler）— NFR-01 / D-006 D-008

## W2 complete_lease 贯穿（4 task）
- task-05 complete_lease 入口 path_source 反查 + 透传（lease/service.py:278）— FR-03
- task-06 apply_patch 改 HostFsDelegate.git_apply（lease/service.py:472 + patch/service.py）— FR-03 / D-002 D-008
- task-07 post_scan_validation 改 HostFsDelegate（run_sync/service.py + post_scan_validator.py）— FR-03 / D-003 D-009
- task-08 stage_callback 改 HostFsDelegate（run_sync/service.py:913 + change/dispatch.py 核实）— FR-03

## W3 dispatch 统一（5 task）
- task-09 resolve_work_dir 重构 HostFsDelegate（agent/service.py:265）— FR-04
- task-10 start_scan_dispatch 重构（agent/service.py:1330）— FR-04
- task-11 import_from_repo 重构（spec_workspace/service.py:229）— FR-04
- task-12 runtime _resolver_for 重构（runtime/service.py:43）— FR-04
- task-13 preflight 重构（spec_workspace/bootstrap.py:649）— FR-04

## W4 清理（2 task）
- task-14 删 _run_sillyspec_background（agent/coordinator.py:563-651）— FR-05
- task-15 模块文档同步（backend.md + sillyhub-daemon.md 注意事项+变更索引）

总计 15 task + 1 spike。
