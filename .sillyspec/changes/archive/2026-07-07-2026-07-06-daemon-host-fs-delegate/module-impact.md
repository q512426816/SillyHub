---
author: qinyi
created_at: 2026-07-07 11:35:00
change: 2026-07-06-daemon-host-fs-delegate
---

# 模块影响分析 — 2026-07-06-daemon-host-fs-delegate

## 变更概要

backend 容器**零宿主路径访问**——8 处容器越界点统一 `HostFsDelegate` 抽象（daemon-client 走 per-daemon WS RPC 委托 / server-local 本地容器直做，path_source 分流），complete_lease path_source 贯穿 3 收尾回调，dispatch 5 处统一重构。修第 5 bug（complete_lease 500）+ 防未来再踩。

## 影响模块

### backend（核心改动）

**新增子包 `daemon/host_fs/`**（5 文件）：
- `delegate.py`：8 方法 path_source 分流 + D-006 异步容错（30s 超时 + WS 重连幂等 + RPC 失败不阻塞 complete_lease）+ D-008 patch_id 幂等；`_via_rpc` 用 `resolve_daemon_instance_for_workspace` 解析 daemon **instance** id（WS 路由键，e2e 修复）
- `ws_rpc.py`：复用 `DaemonWsHub` per-daemon WS（spike-01 路径 A，`HOST_FS_RPC_TIMEOUT=30s` env 可覆盖）
- `tests/`：test_delegate（8 方法双路径 + args 字段断言钉死契约）+ test_delegate_integration（不 mock 钉死测试，真 DB + 真 DaemonWsHub）+ test_delegate_nfr（容错四象限）+ test_ws_rpc（real-hub envelope）

**修改**（按模块）：
- `daemon/`：lease/service.py（complete_lease 入口 path_source 反查 + 透传 3 回调）、patch/service.py（apply_patch 改 HostFsDelegate.git_apply）、run_sync/service.py（post_scan + stage_callback 改 HostFsDelegate）、service.py（host_fs_delegate lazy property，4 构造点之一）
- `agent/`：service.py（resolve_work_dir + start_scan_dispatch 重构）、post_scan_validator.py（原语 RPC，D-009 方案 B）
- `spec_workspace/`：service.py（import/_sse 重构）、bootstrap.py（preflight 重构）
- `runtime/`：service.py（_resolver_for 重构）
- `change/`：dispatch.py（dispatch + HostFsDelegate 构造点）
- `workspace/member_runtimes/`：queries.py（**新增 `resolve_daemon_instance_for_workspace`**——workspace 级 daemon_instance 解析，e2e 路由修复核心）

### sillyhub-daemon

**新增**：
- `src/host-fs-handler.ts`（586 行）：8 方法 host_fs.* RPC handler + `git apply --check` 幂等（D-008）+ `assertWithinAllowedRoots` 守卫 + `toRpcError` 错误结构化；`pollutionArchive` 容忍空 runtime_root（fallback source_root）
- `tests/host-fs-handler.test.ts`（32 用例）

**修改**：
- `src/daemon.ts`：`_registerHostFsRpcHandler` 注册八方法（method 带 `host_fs.` 前缀）+ git_rev_parse 包装补 ref
- `package.json` + `pnpm-lock.yaml`：加 `js-yaml` 依赖（read_local_yaml 用）

## 不影响模块

- **frontend**：无改动（dispatch 错误显示修复 `ad7946b2` 是 separate commit，不在本变更 specDir 范围）
- **deploy / ci / build / docs / sillyspec / prototype**：无改动

## 三重交叉验证

| 维度 | 结果 |
|---|---|
| 声明范围（design §6 文件清单 13 源码） | 全覆盖 |
| 任务范围（plan task-01~15） | task-01~13/15 实现；task-14（删死代码）跳过待另起变更 |
| 实际改动（git diff `bb41759e..0f2d5cd3`，36 文件） | 一致（含测试 + lockfile + package.json） |

## 备注

- **task-14 跳过**：`_run_sillyspec_background`（coordinator.py:563-651）有 deprecated caller `start_sillyspec_run:529`，design §5.5 假设错误，待另起变更清理整条废弃链路（execute review.json cannot_verify）。
- **e2e 驱动的两次修复**（均在变更内）：
  1. daemon_id 路由 bug（首轮 verify 发现）：delegate 用 runtime_id 路由 WS 但连接键是 instance_id → 加 `resolve_daemon_instance_for_workspace`。
  2. args 契约不一致（e2e 暴露，commit `0f2d5cd3`）：delegate.git_apply 等缺 workdir/root 字段，test_delegate.py mock 遮蔽 → 补字段 + args 断言钉死。
- **patch 冲突非 bug**：e2e 真实 verify dispatch 的 patch 冲突源于 sillyspec stage prompt 写入 `.claude/CLAUDE.md` 与 patch 基于 HEAD 的固有矛盾，非本变更代码问题（HostFsDelegate.git_apply 链路真实 git apply + 真实冲突反馈，行为正确）。
