---
id: task-04
title: 异步容错/超时/幂等（HostFsDelegate + handler：30s 超时 + WS 重连幂等 + RPC 失败不阻塞 complete_lease + apply_patch 幂等 D-008）（覆盖：NFR-01, D-006@V1, D-008@V1）
author: qinyi
created_at: 2026-07-06 19:28:16
priority: P0
depends_on: [task-01, task-02, task-03]
blocks: [task-06]
requirement_ids: [NFR-01]
decision_ids: [D-006@V1, D-008@V1]
allowed_paths:
  - backend/app/modules/daemon/host_fs/delegate.py
  - backend/app/modules/daemon/host_fs/ws_rpc.py
  - sillyhub-daemon/src/host-fs-handler.ts
provides:
  - contract: ApplyPatchIdempotence
    fields: [patch_id, skipped]
expects_from:
  task-01:
    - contract: HostFsDelegate
      needs: [git_apply]
goal: >
  为 HostFsDelegate + WS RPC + daemon handler 三件套（task-01/02/03 产出）加异步容错与幂等：① WS RPC 30s 超时；② WS 断线重连后 RPC 失败降级为 warn、不抛、不阻塞 complete_lease 收尾（D-006）；③ apply_patch 幂等双保险——backend 侧 patch_id（内容 hash）去重 + daemon 侧 git apply --check 预检返回 skipped（D-008）。复用 ql-009 failure log 兜底通道，529/失败原因前端可见。
implementation:
  - "ws_rpc.send_rpc 包 30s 超时（host_fs/ws_rpc.py）：HOST_FS_RPC_TIMEOUT=30.0 常量，可经 env 覆盖；git_apply 大 patch 可能 >10s，30s 与 design §11 对齐"
  - "WS 重连/断线 RPC 幂等降级（host_fs/delegate.py）：try/except 包 DaemonRuntimeOffline/DaemonRpcTimeout/DaemonRpcRemoteError/DaemonRpcConflict，log.warning 后返回语义安全降级值（stat→{exists:False}、read_file→\"\"、git_apply→{ok:False,conflict_detail:\"rpc unavailable\",skipped:False}），绝不向上抛"
  - "RPC 失败不阻塞 complete_lease：lease/service.py:470-604 既兜底 try/except 模式保持，apply_patch 的 PatchApplyError raise 路径随 task-06 改 HostFsDelegate 时一并降级为 warn"
  - "apply_patch 幂等 backend 侧（D-008 第一保险）：patch_id=sha256(patch_data).hexdigest()，_applied_patch_ids 进程级缓存按 agent_run_id 记已 applied 集合，命中即返回 {ok:True,skipped:True,patch_id:...}"
  - "apply_patch 幂等 daemon 侧（D-008 第二保险，host-fs-handler.ts git_apply）：git apply --check --3way 预检，exit 0 才真 apply；--check 报 already applied 或 patch 已含于工作树则返回 {ok:true,skipped:true}"
  - "warn 走 ql-009 failure log 通道：HostFsDelegate RPC 失败仅 log.warning，run failed 时复用 lease/service.py:355-394 既有的 agent_run.status==failed 写 AgentRunLog stderr + Redis SSE 兜底"
acceptance:
  - "HostFsDelegate 任一方法 RPC 超时（mock DaemonRpcTimeout）→ 返回降级值、不抛、complete_lease 照常 completed"
  - "WS 断线（mock DaemonRuntimeOffline）→ HostFsDelegate warn 降级，重连后下次 RPC 正常（rpc_id 单次用，无重发歧义）"
  - "重复 complete_lease 同 patch（同 agent_run_id + 同 patch_data）→ 第二次返回 {skipped:true}（backend patch_id 命中）"
  - "daemon 侧 git apply --check 报 already applied → handler 返回 {ok:true,skipped:true}，不触发真 apply、不报错"
  - "30s 超时常量 HOST_FS_RPC_TIMEOUT 可经 env 覆盖（默认 30.0）"
  - "NFR-01 单测：host_fs/ 目录下单测覆盖超时/断线/重连/幂等四象限"
verify:
  - "cd backend && uv run pytest app/modules/daemon/host_fs/ -q"
  - "cd sillyhub-daemon && pnpm test -- host-fs-handler"
  - "cd backend && uv run pytest app/modules/daemon/lease/ -q（complete_lease 5 回调容错零回归）"
  - "cd backend && uv run pytest app/modules/daemon/tests/test_ws_rpc.py -q（ws_hub RPC 既有用例绿，timeout 改 30 仅 HostFsDelegate 调用侧）"
constraints:
  - "RPC 失败绝不阻塞 lease completed（D-006）：HostFsDelegate 不抛，complete_lease 收尾既兜底路径（lease/service.py:470-604 try/except 模式）保持，apply_patch 的 PatchApplyError raise 路径随 task-06 一并降级"
  - "30s 超时常量化、可配：HOST_FS_RPC_TIMEOUT = float(os.getenv(\"HOST_FS_RPC_TIMEOUT\", \"30.0\"))，不硬编码字面量散落"
  - "patch_id 用内容 hash 稳定：sha256(patch_data)（非 uuid4），跨进程/跨重启对同 patch 一致；进程级缓存仅优化同次重试，跨进程真值靠 daemon --check 第二保险"
  - "warn 走 ql-009 failure log 通道：复用 lease/service.py:355-394 既有的 agent_run.status==failed → AgentRunLog stderr + Redis SSE 兜底，HostFsDelegate 仅 log.warning(\"host_fs_rpc_failed\", ...)，不新增日志 sink"
  - "不改 ws_hub.py（RPC 框架 task-02 范畴）；本 task 只在 HostFsDelegate/handler 调用侧包超时/容错/幂等"
---

# task-04 异步容错 / 超时 / 幂等

## goal

为 HostFsDelegate + WS RPC + daemon handler 三件套（task-01/02/03 产出）加异步容错与幂等：① WS RPC 30s 超时；② WS 断线重连后 RPC 失败降级为 warn、不抛、不阻塞 `complete_lease` 收尾（D-006）；③ apply_patch 幂等双保险——backend 侧 patch_id（内容 hash）去重 + daemon 侧 `git apply --check` 预检返回 `skipped`（D-008）。复用 ql-009 failure log 兜底通道，529/失败原因前端可见。

## implementation

1. **ws_rpc.send_rpc 包 30s 超时**（`host_fs/ws_rpc.py`）：现 `DaemonWsHub.send_rpc` 默认 `RPC_DEFAULT_TIMEOUT=10s`（ws_hub.py:39）；HostFsDelegate 调用侧统一传 `timeout=30.0` 常量 `HOST_FS_RPC_TIMEOUT=30.0`（模块顶 + 可经 env `HOST_FS_RPC_TIMEOUT` 覆盖，constraints 第 2 条）。git_apply 单次大 patch 可能 > 10s，30s 与 design §11 风险条目对齐。
2. **WS 重连/断线 RPC 幂等降级**（`host_fs/delegate.py`）：HostFsDelegate 每个方法 try/except 包住 `ws_hub.send_rpc`，捕获 `DaemonRuntimeOffline` / `DaemonRpcTimeout` / `DaemonRpcRemoteError` / `DaemonRpcConflict`（ws_hub.py:382-456 异常体系），统一 `log.warning("host_fs_rpc_failed", method=..., workspace_id=..., daemon_id=..., error=...)` 后返回语义安全的降级值（stat→`{exists:False}`、read_file→`""`、git_apply→`{ok:False, conflict_detail:"rpc unavailable", skipped:False}`），**绝不向上抛**。重连后同一 rpc_id 不会重发（ws_hub 的 rpc_id 是 uuid4 单次用，disconnect 触发 `cancel_all_pending` ws_hub.py:490-506），HostFsDelegate 只保证「这次调用失败不阻塞」，下次 complete_lease 重试由 D-008 patch_id 去重兜住。
3. **RPC 失败不阻塞 complete_lease**（lease/service.py 收尾链路）：现有 5 个跨域回调已全部 `try/except + log.warning` 兜底（lease/service.py:470-604，stage_callback/post_scan/end_session/converge_mission 同模式），task-04 只保证 HostFsDelegate 不抛即可让既兜底路径不触发；apply_patch 锚点（lease/service.py:472 `_apply_patch_to_worktree`）的 `PatchApplyError` raise 路径在 task-06 改 HostFsDelegate 时一并降级为 warn（不再 raise）。
4. **apply_patch 幂等 backend 侧**（D-008 第一保险，`host_fs/delegate.py`）：计算 `patch_id = sha256(patch_data.encode()).hexdigest()`；在 `_applied_patch_ids: dict[agent_run_id, set[patch_id]]` 进程级缓存记已 applied 集合（complete_lease 进程级幂等足够，lease 重试同进程内命中即直接返回上次 `{ok:True, skipped:True, patch_id:...}`，跨进程/跨重启走第二保险）。
5. **apply_patch 幂等 daemon 侧**（D-008 第二保险，`host-fs-handler.ts` git_apply method）：`git apply --check --3way < patch` 先跑，exit 0 才真 apply；若 `--check` 报「already applied」（git 退出码 1 + stderr 含 `already applied`）或 patch 已包含于工作树，返回 `{ok:true, skipped:true}` 不报错。两保险任一命中即跳过，避免重复 apply 冲突。
6. **warn 走 ql-009 failure log 通道**：HostFsDelegate 降级 warn 不重复造日志；run failed 时 complete_lease 已有 `agent_run.status=="failed"` 写 AgentRunLog stderr + Redis SSE 推送兜底（lease/service.py:355-394），HostFsDelegate RPC 失败仅 warn 不升级 status。

## 验收标准

- [ ] HostFsDelegate 任一方法 RPC 超时（mock `DaemonRpcTimeout`）→ 返回降级值、不抛、complete_lease 照常 completed。
- [ ] WS 断线（mock `DaemonRuntimeOffline`）→ HostFsDelegate warn 降级，重连后下次 RPC 正常（rpc_id 单次用，无重发歧义）。
- [ ] 重复 complete_lease 同 patch（同 agent_run_id + 同 patch_data）→ 第二次返回 `{skipped:true}`（backend patch_id 命中）。
- [ ] daemon 侧 `git apply --check` 报 already applied → handler 返回 `{ok:true, skipped:true}`，不触发真 apply、不报错。
- [ ] 30s 超时常量 `HOST_FS_RPC_TIMEOUT` 可经 env 覆盖（默认 30.0）。
- [ ] NFR-01 单测：host_fs/ 目录下单测覆盖超时/断线/重连/幂等四象限。

## verify

```bash
cd backend && uv run pytest app/modules/daemon/host_fs/ -q
cd sillyhub-daemon && pnpm test -- host-fs-handler
```

回归：`uv run pytest app/modules/daemon/lease/`（complete_lease 5 回调容错零回归）+ `app/modules/daemon/tests/test_ws_rpc.py`（ws_hub RPC 既有用例绿，timeout 改 30 仅 HostFsDelegate 调用侧）。

## constraints

1. **RPC 失败绝不阻塞 lease completed**（D-006）：HostFsDelegate 不抛，complete_lease 收尾既兜底路径（lease/service.py:470-604 try/except 模式）保持，apply_patch 的 `PatchApplyError` raise 路径随 task-06 一并降级。
2. **30s 超时常量化、可配**：`HOST_FS_RPC_TIMEOUT = float(os.getenv("HOST_FS_RPC_TIMEOUT", "30.0"))`，不硬编码字面量散落。
3. **patch_id 用内容 hash 稳定**：`sha256(patch_data)`（非 uuid4），跨进程/跨重启对同 patch 一致；进程级缓存仅优化同次重试，跨进程真值靠 daemon `--check` 第二保险。
4. **warn 走 ql-009 failure log 通道**：复用 lease/service.py:355-394 既有的 `agent_run.status=="failed"` → AgentRunLog stderr + Redis SSE 兜底，HostFsDelegate 仅 `log.warning("host_fs_rpc_failed", ...)`，不新增日志 sink。
5. 不改 ws_hub.py（RPC 框架 task-02 范畴）；本 task 只在 HostFsDelegate/handler 调用侧包超时/容错/幂等。
