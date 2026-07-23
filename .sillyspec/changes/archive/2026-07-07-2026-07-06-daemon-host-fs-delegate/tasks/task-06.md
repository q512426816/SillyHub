---
id: task-06
title: apply_patch 改 HostFsDelegate.git_apply（lease/service.py:472 + patch/service.py，含 D-002 委托 + D-008 幂等）（覆盖：FR-03, D-002@V1, D-008@V1）
author: qinyi
created_at: 2026-07-06 19:28:16
priority: P0
depends_on: [task-04, task-05]
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-002@V1, D-008@V1]
allowed_paths:
  - backend/app/modules/daemon/lease/service.py
  - backend/app/modules/daemon/patch/service.py
provides: []
expects_from:
  task-01:
    - contract: HostFsDelegate
      needs: [git_apply]
  task-04:
    - contract: ApplyPatchIdempotence
      needs: [patch_id, skipped]
  task-05:
    - contract: CompleteLeasePathSource
      needs: [path_source]
goal: >
  apply_patch 从容器内 git apply 访问宿主 root_path 改为 HostFsDelegate.git_apply，daemon-client 走 per-daemon WS RPC 委托 daemon 在宿主 apply，含 patch_id 幂等去重与 daemon 侧 git apply --check 预检
implementation:
  - "patch/service.py apply_patch_to_worktree 入口新增 path_source 形参并按模式分流，daemon-client 调 host_fs_delegate.git_apply 经 WS RPC 到 daemon host-fs-handler，server-local 保留现有容器内 git apply 流程"
  - "lease/service.py:472 透传 path_source 到 apply_patch_to_worktree，PatchConflictError 捕获与 patch_conflict metadata 写入路径不变"
  - "D-008 幂等落点：backend 侧 patch_id 内容 hash 去重，daemon 侧 --check 预检 skipped，两机制任一命中即 skipped"
  - "D-002 apply 成功后保留 daemon_patch_applied log 与现有 patch 入库逻辑，本 task 仅委托 apply 不重复入库"
acceptance:
  - "daemon-client complete_lease 不再抛 FileNotFoundError / 500"
  - "apply_patch 在 daemon-client 模式经 HostFsDelegate.git_apply RPC，无容器内 git apply 与 Path(root_path) 容器访问"
  - "重复 complete_lease 同一 patch 返回 skipped:true 不冲突"
  - "server-local 模式行为零回归，现有测试全绿"
  - "PatchConflictError 语义与 lease metadata patch_conflict 写入路径不变"
verify:
  - "cd backend && uv run pytest app/modules/daemon/lease/ app/modules/daemon/patch/"
constraints:
  - "RPC 失败 warn 不阻塞 lease，按 task-04 异步容错兜底转 warn + failure log"
  - "server-local 分支保留容器内 git apply 零回归"
  - "幂等键 patch_id 稳定（内容 hash，跨重试一致）"
  - "patch 入库（redact_output 脱敏）逻辑已在 lease.service.py:465-469，本 task 不重复入库"
---

# task-06：apply_patch 改 HostFsDelegate.git_apply

## goal

complete_lease 收 daemon 上报 patch 后（lease/service.py:472 经 `self._facade._apply_patch_to_worktree` 调 patch/service.py），apply_patch 从「容器内 `git apply` 访问宿主 root_path（patch/service.py:83 `workdir = Path(workspace.root_path)` + 144-161 行 `_run_git_apply` 子进程，第 5 bug FileNotFoundError 500 实证 run a70fb39f/c76562cd）」改为 HostFsDelegate.git_apply——daemon-client 模式走 per-daemon WS RPC 委托 daemon 在宿主 apply（D-002），含 D-008 幂等（patch_id 去重 + daemon 侧 `git apply --check` 预检 skipped）。

## implementation

1. **patch/service.py `apply_patch_to_worktree` 内部按 path_source 分流**（接 task-05 透传，task-01 HostFsDelegate 接口）：
   - 入口新增 `path_source` 形参（由 lease/service.py:472 透传）；保留现有 AgentRunWorkspace M:N → workspace 反查（第 64-81 行）。
   - **daemon-client 分支**：调 `host_fs_delegate.git_apply(workspace, patch_data, use_3way)`（task-01 provider），经 task-02 WS RPC（type=host_fs/method=git_apply，rpc_id 匹配，30s 超时 task-04）到 task-03 daemon host-fs-handler，返回 `{ok, conflict_detail, skipped}`（ApplyPatchIdempotence 契约，接 task-04 patch_id/skipped）。
     - `skipped=True`（已 applied / `--check` 判定已包含）→ 直接 return，不报冲突。
     - `ok=False + conflict_detail` → 抛 `PatchConflictError`（复用第 34 行类，零回归 lease/service.py:483 捕获路径）。
   - **server-local 分支**（D-004）：保留现有第 83-142 行容器内 `git apply --check` → `git apply` / `--3way` 逻辑，零改动。
   - 删除 `_run_git_apply`（第 144-161 行）仅当 server-local 分支不再用——若 server-local 仍复用则保留，daemon-client 不调它。
2. **lease/service.py:472 调用点**：透传 task-05 的 `path_source`（入口已反查 workspace.path_source）到 `apply_patch_to_worktree(agent_run_id, patch_data, use_3way, path_source=path_source)`。PatchConflictError 捕获 + metadata 写 patch_conflict 逻辑（483-499 行）不变。
3. **D-008 幂等落点**（接 task-04 策略）：
   - backend 侧 patch_id（patch_data 内容 hash）+ agent_run 维度已 applied 去重 → 重复 complete_lease 同 patch_id 直接 return 上次结果（在 patch/service.py 入口或 delegate 调用前判断，接 task-04 ApplyPatchIdempotence.patch_id）。
   - daemon 侧 `--check` 预检 skipped（task-03 handler 实现，task-06 仅消费 skipped 字段）。
   - 兜底两机制任一命中即 skipped。
4. **D-002 入库**：apply 成功后 lease.service.py 现有 `daemon_patch_applied` log（477-482 行）保留；patch 内容已在 lease.service.py:465-469 入库逻辑（redact_output），本 task 不动入库，仅委托 apply。

## 验收标准

- daemon-client complete_lease 不再抛 FileNotFoundError / 500（第 5 bug 解除）。
- apply_patch 在 daemon-client 模式经 HostFsDelegate.git_apply RPC（无容器内 git apply / 无 `Path(workspace.root_path)` 容器访问，NFR-03）。
- 重复 complete_lease 同一 patch 返回 `{skipped:true}` 不冲突（D-008 双保险）。
- server-local 模式行为零回归（patch/service.py server-local 分支保留原 check→apply→3way 流程，现有测试全绿，NFR-02）。
- PatchConflictError 语义/lease metadata patch_conflict 写入路径不变（lease/service.py:483 捕获）。

## verify

```
cd backend && uv run pytest app/modules/daemon/lease/ app/modules/daemon/patch/
```

补：daemon-client path_source 分支 mock HostFsDelegate.git_apply RPC（ok/skipped/conflict 三态）+ server-local 分支容器内 git apply 双路径单测。

## constraints

- RPC 失败 warn 不阻塞 lease（接 task-04 异步容错 D-006；现有 lease.service.py:500 `except PatchApplyError: raise` 仅对 apply 失败抛，RPC 失败按 task-04 兜底转 warn + failure log）。
- server-local 分支保留容器内 git apply（零回归，D-004）。
- 幂等键 patch_id 稳定（内容 hash，跨重试一致）。
- patch 入库（redact_output 脱敏）逻辑已在 lease.service.py:465-469，本 task 不重复入库。
