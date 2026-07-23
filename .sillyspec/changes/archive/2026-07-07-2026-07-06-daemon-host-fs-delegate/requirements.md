---
author: qinyi
created_at: 2026-07-06 19:09:09
---
# Requirements

## 角色表
| 角色 | 职责 |
|---|---|
| backend 容器（Linux） | 调度，零宿主路径访问，经 HostFsDelegate 委托 |
| daemon（宿主 Windows） | 跑 claude + host_fs WS RPC handler，执行宿主 git/stat/read |
| 用户 | 触发 dispatch，看日志（失败原因可见）|

## 功能需求

### FR-01 HostFsDelegate 抽象（path_source 分流）
- **Given** daemon-client workspace，**When** backend 调 `HostFsDelegate.git_apply(ws, patch, 3way)`，**Then** 经 per-daemon WS RPC 让 daemon 在宿主 git apply，返回 `{ok, conflict_detail}`。
- **Given** server-local workspace，**When** 同调用，**Then** 本地容器 git apply（行为不变）。

### FR-02 daemon host_fs WS handler
daemon 注册 `host_fs.*` handler，支持：stat / read_file / list_dir / git_apply / git_rev_parse / pollution_archive / read_package_json / read_local_yaml。
- **Given** backend 发 `host_fs.git_apply` RPC，**Then** daemon 在宿主 git apply，返回结构化结果。

### FR-03 complete_lease path_source 贯穿
complete_lease 入口反查 `workspace.path_source`，透传 apply_patch / post_scan / stage_callback 3 回调。
- **Given** daemon-client lease complete 上报 patch，**Then** apply_patch 走 HostFsDelegate.git_apply RPC，不抛 FileNotFoundError。
- **Given** daemon-client scan lease complete，**Then** post_scan_validation 走 HostFsDelegate（git rev-parse / pollution archive），校验功能保留不静默失效。

### FR-04 dispatch 5 处统一 HostFsDelegate
resolve_work_dir / start_scan_dispatch / import_from_repo / runtime._resolver_for / preflight 5 处重构为 HostFsDelegate 调用，去散落 `if path_source != 'daemon-client'`。
- **Given** daemon-client workspace，**Then** 5 处走 HostFsDelegate（行为同已修，零回归）。

### FR-05 删死代码
`_run_sillyspec_background`（coordinator.py:563-651）删除（无 caller，task-01 daemon-only 后残留）。

## 非功能需求
- **NFR-01** WS RPC 异步容错：超时 30s + WS 重连幂等 + RPC 失败不阻塞 complete_lease（warn + failure log 兜底）。
- **NFR-02** server-local 行为零回归（现有测试全绿）。
- **NFR-03** backend 容器零宿主路径访问（grep backend/app 无 `workspace.root_path` 直接 stat/git/read）。

## 决策覆盖
- FR-01 ← D-001（完全委托）D-004（server-local 不变）D-005（WS RPC）
- FR-02 ← D-005
- FR-03 ← D-001 D-002 D-003
- FR-04 ← D-001
- NFR-01 ← D-006 D-008
