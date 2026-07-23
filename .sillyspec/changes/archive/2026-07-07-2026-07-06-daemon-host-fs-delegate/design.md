---
author: qinyi
created_at: 2026-07-06 19:06:02
---

# 2026-07-06-daemon-host-fs-delegate 设计文档

## 1. 背景

2026-07-06 修 4 个 daemon-client bug（ql-006 dispatch stat / ql-008 permission MultiEdit / ql-009 stderr forward / ql-010 fire-and-forget 尾部丢失）后，发现第 5 个 bug：complete_lease 500（`_apply_patch_to_worktree` 在 backend 容器内 `git apply` 宿主 worktree，`FileNotFoundError`，run a70fb39f/c76562cd 实证）。

架构 review（Explore 报告 + memory `daemon-client-container-overreach-root-cause`）扫出 **8 处 backend 容器内做宿主操作**（stat/git/read 宿主路径）的 bug 同源：

- **已修 5 处**（dispatch 侧，`path_source` 分流跳过）：resolve_work_dir（ql-006）、start_scan_dispatch、import_from_repo、RuntimeService .runtime、preflight。
- **未修 3 处**（complete_lease 收尾侧，裸做没读 path_source）：apply_patch_to_worktree（第 5 bug 500）、_run_post_scan_validation（污染检测静默失效）、_trigger_stage_completion_callback（读宿主 sillyspec.db）。

**同源根因两层**：
1. **贯穿缺口**：`path_source` 信号只到 dispatch 侧，complete_lease 收尾锚点（`lease/service.py:278-604`，5 个跨域回调 apply_patch/stage_callback/post_scan_validation/end_session/converge_mission）无 path_source 入参也不反查 `workspace.path_source` → 收尾假设 backend 总能访问 root_path。
2. **机制缺口**：缺"宿主操作委托给 daemon"的统一抽象，每处靠作者自觉判断 跳过/用容器路径/委托 daemon，漏判即 bug。

## 2. 设计目标

- **backend 容器零宿主路径访问**：所有宿主操作（stat/git/read）走 daemon WS RPC，backend 容器不再碰宿主路径。
- **统一抽象 HostFsDelegate**：8 处容器越界点统一用 HostFsDelegate，一套机制贯穿 dispatch + complete_lease。
- **complete_lease path_source 贯穿**：lease 入口解析 workspace.path_source，透传到 3 个收尾回调。
- **解第 5 bug（complete_lease 500）+ 防未来再踩**：complete_lease 不再 500，529/失败原因通过 HostFsDelegate RPC + failure log 兜底双路径可见。
- **server-local 模式行为不变**（path_source 分流，本地容器做）。

## 3. 非目标

- 不改 daemon-client 架构本身（claude 在宿主跑、backend 容器调度的模式保留）。
- 不改 server-local 模式行为。
- 不重构 daemon WS 基础设施（复用 daemon-entity-binding 的 per-daemon WS）。
- 不修复 ql-008/009/010（daemon 代码逻辑 bug，已修；本变更只管容器越界同源）。

## 4. 拆分判断

用户选系统修（非短期局部）。不拆分，一次变更做完（8 处统一 + 抽象 + 删死代码）。预估 14-16 task，4 Wave。不走批量模式（变更间无强耦合可并行，但本变更自成体系）。

## 5. 总体方案

### 5.1 HostFsDelegate 抽象（backend 侧）

新建 `backend/app/modules/daemon/host_fs/delegate.py`，封装"宿主文件系统操作委托"：

- **daemon-client 模式**：走 per-daemon WS RPC（`host_fs.*`），异步等响应（D-005）。
- **server-local 模式**：本地容器直接做（path_source 分流，行为不变，D-004）。

接口：
```python
class HostFsDelegate:
    def __init__(self, session, ws_hub): ...
    async def stat(self, workspace, path) -> dict           # {exists, is_dir, size}
    async def read_file(self, workspace, path) -> str
    async def list_dir(self, workspace, path) -> list[str]
    async def git_apply(self, workspace, patch_data, use_3way) -> dict   # {ok, conflict_detail}
    async def git_rev_parse(self, workspace, ref) -> str | None
    async def pollution_archive(self, workspace, source_root) -> dict   # {archived, detail}
    async def read_package_json(self, workspace) -> dict | None
    async def read_local_yaml(self, workspace) -> dict | None
```

### 5.2 daemon host_fs WS handler（daemon 侧）

新建 `sillyhub-daemon/src/host-fs-handler.ts`，注册到 per-daemon WS（DaemonWsHub）。接收 `host_fs.*` 请求，在宿主执行（git/stat/read），返回结构化结果。

### 5.3 complete_lease path_source 贯穿

`lease/service.py:278 complete_lease` 入口反查 `workspace.path_source`（lease → agent_run → workspace），透传到 3 个收尾回调（apply_patch / post_scan / stage_callback）。daemon-client 时回调内走 HostFsDelegate RPC。

### 5.4 8 处统一改用 HostFsDelegate

- complete_lease 3 处（新写 HostFsDelegate 调用）。
- dispatch 5 处（已 path_source 分流，重构为 HostFsDelegate 调用，去散落 `if path_source != 'daemon-client'`）。

### 5.5 删死代码

`_run_sillyspec_background`（`coordinator.py:563-651`，task-01 daemon-only 后残留，无 caller）。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | backend/app/modules/daemon/host_fs/delegate.py | HostFsDelegate 抽象（path_source 分流 + WS RPC）|
| 新增 | backend/app/modules/daemon/host_fs/ws_rpc.py | WS RPC 请求发送（DaemonWsHub.send_rpc 封装 + 异步响应匹配）|
| 新增 | sillyhub-daemon/src/host-fs-handler.ts | daemon host_fs WS handler（stat/read/git_apply/rev_parse/...）|
| 修改 | backend/app/modules/daemon/lease/service.py | complete_lease 入口 path_source 贯穿 + 3 回调改 HostFsDelegate（apply_patch/post_scan/stage_callback）|
| 修改 | backend/app/modules/daemon/patch/service.py | apply_patch_to_worktree 改 HostFsDelegate.git_apply（daemon-client 委托）|
| 修改 | backend/app/modules/daemon/run_sync/service.py | _run_post_scan_validation / _trigger_stage_completion_callback 改 HostFsDelegate |
| 修改 | backend/app/modules/daemon/post_scan_validator.py | 容器内 git/shutil 改 HostFsDelegate（daemon-client 委托，保留校验语义）|
| 修改 | backend/app/modules/agent/service.py | resolve_work_dir / start_scan_dispatch 重构 HostFsDelegate（去 path_source 散落 if）|
| 修改 | backend/app/modules/spec_workspace/service.py | import_from_repo / _sse 重构 HostFsDelegate |
| 修改 | backend/app/modules/spec_workspace/bootstrap.py | preflight 重构 HostFsDelegate |
| 修改 | backend/app/modules/runtime/service.py | _resolver_for 重构 HostFsDelegate |
| 修改 | sillyhub-daemon/src/daemon.ts | 注册 host_fs WS handler |
| 新增/修改 | sillyhub-daemon/src/ws-rpc（或复用现有 RPC 机制）| WS RPC 请求/响应匹配（如现有 RPC 不足则补）|
| 删除 | backend/app/modules/agent/coordinator.py:563-651 | _run_sillyspec_background 死代码 |

## 7. 接口定义

### HostFsDelegate（Python）
见 §5.1。

### host_fs WS RPC 协议

请求（backend → daemon，经 DaemonWsHub.send_rpc）：
```json
{
  "type": "host_fs",
  "method": "git_apply" | "stat" | "read_file" | "git_rev_parse" | ...,
  "workspace_id": "<uuid>",
  "daemon_id": "<uuid>",
  "args": { "patch_data": "...", "use_3way": true },
  "rpc_id": "<uuid>"
}
```

响应（daemon → backend）：
```json
{
  "type": "host_fs_response",
  "rpc_id": "<uuid>",
  "result": { "ok": true, "conflict_detail": null },
  "error": null
}
```

## 7.5 生命周期契约表

本变更涉及 session/lease/agent_run/daemon/lifecycle/complete 关键词，契约：

| 实体 | 状态转移 | 触发点 | 修改影响 |
|---|---|---|---|
| lease | → completed | complete_lease | daemon-client 时 apply_patch/post_scan/stage_callback 走 HostFsDelegate RPC；RPC 失败不阻塞 lease completed（warn + 兜底，D-006）|
| agent_run | → failed/completed | complete_lease 写 status | failure log 兜底（ql-009 已加）+ HostFsDelegate RPC 双路径，529/失败原因可见 |
| daemon WS | connected | host_fs RPC | 复用 per-daemon WS（daemon-entity-binding），新增 host_fs.* method |
| path_source | — | complete_lease 入口 | 入口反查 workspace.path_source 透传 3 回调（贯穿）|

## 8. 决策

- **D-001@V1**：完全委托范围——8 处容器越界点全改 daemon RPC（用户选"完全委托"，非最小/局部）。
- **D-002@V1**：apply_patch 委托 daemon git apply（新 RPC，daemon 侧实现 apply，backend 入库 patch+结果；用户定）。
- **D-003@V1**：post_scan_validation 委托 daemon（保留校验功能，不跳过；git rev-parse / pollution archive / package.json 都走 RPC）。
- **D-004@V1**：server-local 模式行为不变（path_source 分流，本地容器直接做，不走 RPC）。
- **D-005@V1**：RPC 机制 = per-daemon WS（复用 daemon-entity-binding DaemonWsHub，不新增 HTTP server / 不走 lease 内嵌）。
- **D-006@V1**：异步 RPC 容错——超时 30s + WS 重连幂等 + RPC 失败不阻塞 complete_lease（warn + failure log 兜底）；apply_patch 幂等（重复 apply 同 patch 不冲突）。
- **D-007@V1**：WS RPC 双向能力——daemon-entity-binding per-daemon WS 当前是否支持请求/响应匹配？spike-01（W1 前）验证。不足则 W1 task-02 含 WS RPC 框架搭建（核心风险，决定 W1 工作量）。
- **D-008@V1**：apply_patch 幂等策略——git apply 同 patch 多次（complete_lease 重试）幂等，plan 阶段设计 patch_id 去重 / `git apply --check` 预检 / 已 applied 跳过。
- **D-009@V1**：post_scan 委托方式——daemon 实现等价 post_scan_validator（完整逻辑搬 daemon）vs RPC 暴露 git/shutil 原语 backend 保留逻辑，plan 阶段决策（trade-off：daemon 逻辑重复 vs RPC 粒度）。

## 9. Wave 分组（预估 14-16 task）

- **W1 基础设施**（4 task）：HostFsDelegate 抽象 + WS RPC 请求/响应匹配 + daemon host_fs handler + 异步容错/超时。
- **W2 complete_lease 贯穿**（4 task）：lease 入口 path_source 反查 + apply_patch 改 HostFsDelegate + post_scan 改 HostFsDelegate + stage_callback 改 HostFsDelegate。
- **W3 dispatch 统一**（5 task）：resolve_work_dir / scan / import / runtime / preflight 5 处重构 HostFsDelegate（去 path_source 散落 if）。
- **W4 清理**（2 task）：删 _run_sillyspec_background 死代码 + 模块文档同步。

## 10. 验证策略

- **单测**：HostFsDelegate（mock WS RPC，daemon-client + server-local 双路径）+ daemon host_fs handler（mock 文件系统/git）+ complete_lease（daemon-client RPC + server-local 本地双路径）+ 8 处重构点零回归。
- **端到端**：daemon-client workspace 触发 dispatch → complete_lease 不 500 → 529/失败原因通过 HostFsDelegate RPC + failure log 兜底双路径回流前端。
- **回归**：现有 dispatch / scan / import_from_repo / runtime / preflight / complete_lease 测试全绿。

## 11. 风险

- WS RPC 异步复杂（请求/响应匹配、超时、重连）——靠 D-006 容错 + failure log 兜底。
- daemon host_fs handler 实现正确性（git apply 幂等、pollution archive 副作用）——单测 + 端到端验证。
- 改动面大（backend + daemon 双端，14-16 task）——Wave 分组 + 逐 Wave 验证。
- 并发变更（component-readonly-split / generate_projects 改 workspace 模块）——本变更改 daemon 模块，冲突风险低，但 merge 时核对。

## 12. 自审

**完整性**：四件套齐（proposal/requirements/design/tasks + decisions D-001~009）。8 处容器越界点全覆盖（dispatch 5 + complete_lease 3）。接口定义（HostFsDelegate + host_fs WS RPC 协议）+ 生命周期契约表（lease/agent_run/daemon WS）齐。

**正确性**：方案基于 Explore 实测报告 + 5 bug 修复经验 + memory `daemon-client-container-overreach-root-cause`。核心假设（D-007 WS RPC 双向能力）spike-01 验证后再定 W1 工作量。

**风险**：核心风险 D-007（WS RPC 现有能力）决定 W1 范围；D-008 apply_patch 幂等 / D-009 post_scan 委托方式 plan 阶段细化。

**遗漏检查**：待核 change/dispatch.py sync_stage_status（task-08 W2 核实）；task-level agent_run.workspace_id（complete_lease path_source 反查链路，task-05 W2 核实）。

**回归**：server-local 模式 NFR-02 零回归（现有测试 + 8 处重构点双路径验证）。
