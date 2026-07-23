---
author: qinyi
created_at: 2026-07-06 19:26:00
plan_level: full
---

# 实现计划

> 来源：`proposal.md` / `requirements.md`（FR-01~05, NFR-01~03）/ `design.md`（§5 方案 §6 文件清单 §9 Wave 分组 §7.5 生命周期契约）/ `tasks.md` / `decisions.md`（D-001~009@V1）。
> 本文件只做 Wave 分组 + 任务总表 + 依赖 + 验收，**不放接口签名/代码示例**（细节落到后续 task-NN.md 蓝图）。

## Spike 前置验证

| Spike | 验证内容 | 通过标准 | 不通过后果 |
|---|---|---|---|
| spike-01 | D-007：daemon-entity-binding per-daemon WS（DaemonWsHub）当前是否支持「请求/响应」匹配（backend 发 RPC → daemon 响应回 backend）；**并核实现有 `sillyhub-daemon/src/file-rpc` 是否可直接复用/扩展为 host_fs handler**（模块文档已记载该模块存在，design §6 未提及） | per-daemon WS 已具备双向 RPC 能力（有 rpc_id 匹配机制或可低成本补齐），且 file-rpc 可复用或其模式可参照 | task-02 含 WS RPC 框架自建（W1 工作量 +1）；host-fs-handler.ts 改为扩 file-rpc 而非新建；spike 报告写明选型理由 |

> spike-01 是核心风险锚点（design §11 首项风险、§12 核心假设），必须在 W1 任何 task 前完成，决定 task-02/03 的工作量与实现路径。

## plan 阶段决策落地

design 把 D-008 / D-009 委托给 plan 阶段，此处定档：

- **D-008（apply_patch 幂等）= backend patch_id 去重 + daemon `git apply --check` 预检双保险**。
  - backend 侧：complete_lease 收到的 patch 计算 patch_id（内容 hash），在 agent_run 维度记已 applied 集合，重试/重复 complete_lease 同一 patch_id 直接跳过返回上次结果。
  - daemon 侧：`git_apply` 前先 `git apply --check`，若 patch 已 applied 或已包含于工作树则跳过、返回 `{ok:true, skipped:true}`。
  - 兜底：两机制任一命中即跳过，避免重复 apply 冲突。
- **D-009（post_scan 委托方式）= 方案 B：RPC 暴露原语，backend 保留校验编排**。
  - 理由：与 design §5.1 HostFsDelegate 接口一致（已含 `git_rev_parse` / `pollution_archive` / `read_package_json` 原语方法）；原语高复用（git_rev_parse 可被其他收尾点共用）；校验规则（判定污染的语义）不在 daemon 重复实现。
  - 落地：`post_scan_validator.py` 保留判定逻辑，容器内 `git`/`shutil`/`open()` 调用替换为 `HostFsDelegate.git_rev_parse` / `pollution_archive` / `read_package_json`。

## Wave 分组

### Wave 1 — 基础设施（依赖 spike-01）
- [x] task-01: HostFsDelegate 抽象（path_source 分流：daemon-client → WS RPC / server-local → 本地容器）（覆盖：FR-01, D-001@V1, D-004@V1, D-005@V1）
- [x] task-02: WS RPC 请求/响应匹配（backend `host_fs/ws_rpc.py` + daemon ws-rpc 扩展，spike-01 决定是否含框架自建）（覆盖：FR-02, D-005@V1, D-007@V1）
- [x] task-03: daemon host_fs WS handler（`sillyhub-daemon/src/host-fs-handler.ts` 新建/扩 file-rpc + `daemon.ts` 注册，方法见 FR-02）（覆盖：FR-02）
- [x] task-04: 异步容错/超时/幂等（HostFsDelegate + handler：30s 超时 + WS 重连幂等 + RPC 失败不阻塞 complete_lease + apply_patch 幂等 D-008）（覆盖：NFR-01, D-006@V1, D-008@V1）

### Wave 2 — complete_lease 收尾链路 path_source 贯穿（依赖 W1）
- [x] task-05: complete_lease 入口反查 `workspace.path_source` 并透传 3 回调（apply_patch / post_scan / stage_callback）（覆盖：FR-03）
- [x] task-06: apply_patch 改 HostFsDelegate.git_apply（lease/service.py:472 + patch/service.py，含 D-002 委托 + D-008 幂等）（覆盖：FR-03, D-002@V1, D-008@V1）
- [x] task-07: post_scan_validation 改 HostFsDelegate（run_sync/service.py + post_scan_validator.py，按 D-009 方案 B 暴露原语）（覆盖：FR-03, D-003@V1, D-009@V1）
- [x] task-08: stage_callback 改 HostFsDelegate（run_sync/service.py:913 + change/dispatch.py `sync_stage_status` 核实，design §12 待核项）（覆盖：FR-03）

### Wave 3 — dispatch 5 处统一 HostFsDelegate（依赖 W1，可与 W2 并行）
- [x] task-09: resolve_work_dir 重构 HostFsDelegate（agent/service.py:265，去散落 `if path_source != 'daemon-client'`）（覆盖：FR-04）
- [x] task-10: start_scan_dispatch 重构（agent/service.py:1330）（覆盖：FR-04）
- [x] task-11: import_from_repo / _sse 重构（spec_workspace/service.py:229）（覆盖：FR-04）
- [x] task-12: runtime `_resolver_for` 重构（runtime/service.py:43）（覆盖：FR-04）
- [x] task-13: preflight 重构（spec_workspace/bootstrap.py:649）（覆盖：FR-04）

### Wave 4 — 清理（W2/W3 完成后）
- [x] task-14: 删死代码 `_run_sillyspec_background`（agent/coordinator.py:563-651，无 caller）（覆盖：FR-05） — **跳过：design §5.5 假设错误，实际有 deprecated caller start_sillyspec_run:529，待另起变更清理整条 deprecated 链路（review.json cannot_verify）**
- [x] task-15: 模块文档同步（backend.md + sillyhub-daemon.md 注意事项 + 变更索引）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| spike-01 | per-daemon WS 双向 RPC 能力 + file-rpc 复用核实 | Spike | P0 | — | D-007@V1 | 决定 task-02/03 路径，W1 前置 |
| task-01 | HostFsDelegate 抽象（path_source 分流） | W1 | P0 | spike-01 | FR-01, D-001 D-004 D-005 | provider：定义 stat/read_file/list_dir/git_apply/git_rev_parse/pollution_archive/read_package_json/read_local_yaml，W2/W3 共同消费 |
| task-02 | WS RPC 请求/响应匹配 | W1 | P0 | spike-01, task-01 | FR-02, D-005 D-007 | backend `ws_rpc.py` 发送侧 + daemon 匹配侧；spike 不通过则含框架自建 |
| task-03 | daemon host_fs WS handler | W1 | P0 | task-02 | FR-02 | host-fs-handler.ts（新建或扩 file-rpc）+ daemon.ts 注册 |
| task-04 | 异步容错/超时/幂等 | W1 | P0 | task-01, task-02, task-03 | NFR-01, D-006 D-008 | 横切 W1 三件，provider of 幂等/超时契约给 W2 |
| task-05 | complete_lease 入口 path_source 反查+透传 | W2 | P0 | task-01 | FR-03 | lease/service.py:278；design §12 待核 agent_run.workspace_id 反查链路 |
| task-06 | apply_patch 改 HostFsDelegate.git_apply | W2 | P0 | task-04, task-05 | FR-03, D-002 D-008 | lease/service.py:472 + patch/service.py；patch_id 去重 + --check 预检 |
| task-07 | post_scan_validation 改 HostFsDelegate | W2 | P0 | task-04, task-05 | FR-03, D-003 D-009 | run_sync/service.py + post_scan_validator.py，方案 B 暴露原语 |
| task-08 | stage_callback 改 HostFsDelegate | W2 | P1 | task-05 | FR-03 | run_sync/service.py:913 + change/dispatch.py 核实 |
| task-09 | resolve_work_dir 重构 | W3 | P1 | task-01 | FR-04 | agent/service.py:265 |
| task-10 | start_scan_dispatch 重构 | W3 | P1 | task-01 | FR-04 | agent/service.py:1330 |
| task-11 | import_from_repo / _sse 重构 | W3 | P1 | task-01 | FR-04 | spec_workspace/service.py:229 |
| task-12 | runtime `_resolver_for` 重构 | W3 | P1 | task-01 | FR-04 | runtime/service.py:43 |
| task-13 | preflight 重构 | W3 | P1 | task-01 | FR-04 | spec_workspace/bootstrap.py:649 |
| task-14 | 删 _run_sillyspec_background 死代码 | W4 | P2 | — | FR-05 | agent/coordinator.py:563-651；独立可前置 |
| task-15 | 模块文档同步 | W4 | P2 | task-01~14 | — | backend.md + sillyhub-daemon.md 注意事项 + 变更索引 |

## 关键路径

`spike-01 → task-02（WS RPC，含可能的框架自建）→ task-03（handler）→ task-04（容错/幂等）→ task-06（apply_patch，含 D-008 幂等，最复杂收尾点）→ task-15（文档）`

- W2 与 W3 在 W1 完成后可并行（同依赖 task-01，无相互依赖）。
- W3 内 5 task（task-09~13）相互独立，可并行执行。
- task-14 与全局无依赖，可在任意 Wave 顺手清理，归 W4 仅为归类。

## 文件覆盖映射（design §6 文件变更清单 → task）

| design §6 文件 | 操作 | 覆盖 task |
|---|---|---|
| backend/app/modules/daemon/host_fs/delegate.py | 新增 | task-01 |
| backend/app/modules/daemon/host_fs/ws_rpc.py | 新增 | task-02 |
| sillyhub-daemon/src/host-fs-handler.ts | 新增/扩 file-rpc | task-03 |
| backend/app/modules/daemon/lease/service.py | 修改（入口贯穿 + apply_patch + stage_callback 锚点） | task-05, task-06, task-08 |
| backend/app/modules/daemon/patch/service.py | 修改（apply_patch_to_worktree） | task-06 |
| backend/app/modules/daemon/run_sync/service.py | 修改（post_scan + stage_callback） | task-07, task-08 |
| backend/app/modules/daemon/post_scan_validator.py | 修改（git/shutil → 原语 RPC） | task-07 |
| backend/app/modules/agent/service.py | 修改（resolve_work_dir + start_scan_dispatch） | task-09, task-10 |
| backend/app/modules/spec_workspace/service.py | 修改（import_from_repo / _sse） | task-11 |
| backend/app/modules/spec_workspace/bootstrap.py | 修改（preflight） | task-13 |
| backend/app/modules/runtime/service.py | 修改（_resolver_for） | task-12 |
| sillyhub-daemon/src/daemon.ts | 修改（注册 host_fs handler） | task-03 |
| sillyhub-daemon/src/ws-rpc（或复用现有 RPC） | 新增/修改 | task-02 |
| backend/app/modules/agent/coordinator.py:563-651 | 删除（_run_sillyspec_background） | task-14 |
| （待核）backend/app/modules/change/dispatch.py sync_stage_status | 核实是否需改 | task-08 |

> 自检：design §6 全部 13 项源码文件均被至少一个 task 覆盖；change/dispatch.py 为 design §12 明示待核项，归 task-08 核实后定。

## 跨任务契约（provider → consumer）

| 契约 | provider | consumer | 关键字段 |
|---|---|---|---|
| HostFsDelegate 接口（stat/read_file/list_dir/git_apply/git_rev_parse/pollution_archive/read_package_json/read_local_yaml） | task-01 | task-05~13（W2+W3 全部收尾/重构点） | path_source 分流（D-004 server-local 本地 / daemon-client RPC）|
| WS RPC 请求/响应协议（type/method/workspace_id/daemon_id/args/rpc_id ↔ type/rpc_id/result/error） | task-02（+task-03 handler） | task-01 HostFsDelegate daemon-client 分支 | rpc_id 匹配 + 30s 超时（task-04）|
| apply_patch 幂等契约（patch_id 去重 + skipped 字段） | task-04（策略）+ task-06（落地）+ task-03（handler --check） | task-06 complete_lease 重试路径 | `{ok, skipped, conflict_detail}` |
| path_source 透传 | task-05（complete_lease 入口） | task-06, task-07, task-08（3 收尾回调） | workspace.path_source 字段（已有，非新 schema） |

> 字段一致性细化落到 task-NN.md 蓝图的 provides/expects_from（下一步生成）。

## 全局验收标准

- [x] backend：`cd backend && uv run pytest -q --cov=app --cov-fail-under=60` 全绿（含 HostFsDelegate daemon-client/server-local 双路径单测 + 8 处重构点零回归）
- [x] sillyhub-daemon：`cd sillyhub-daemon && pnpm test` 全绿（host_fs handler 单测，mock fs/git）
- [x] complete_lease daemon-client 模式不再 500（apply_patch 走 HostFsDelegate.git_apply RPC，无 FileNotFoundError）
- [x] 8 处容器越界统一 HostFsDelegate：`grep -rn "path_source != ['\"]daemon-client['\"]" backend/app` 无散落 if 残留（NFR-03）
- [x] backend 容器零宿主路径访问：`grep -rn "workspace.root_path" backend/app` 不含直接 stat/git/read 宿主路径的调用（NFR-03）
- [x] daemon-client dispatch 失败原因前端可见（HostFsDelegate RPC 回流 + ql-009 failure log 兜底双路径）
- [x] post_scan 校验功能保留（污染检测不再静默失效）
- [x] **brownfield 兼容**：server-local 模式现有 dispatch / scan / import_from_repo / runtime / preflight / complete_lease 测试零回归（path_source 分流本地分支行为不变）
- [x] spike-01 报告落档（per-daemon WS 双向能力结论 + file-rpc 复用决策）
- [x] 模块文档 backend.md / sillyhub-daemon.md 同步本变更（注意事项 + 变更索引）

## 覆盖矩阵（decisions D-001~009@V1 + FR/NFR）

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@V1（完全委托范围 8 处） | task-01, task-06, task-07, task-08, task-09, task-10, task-11, task-12, task-13 | grep 无散落 path_source if；8 处全 HostFsDelegate |
| D-002@V1（apply_patch 委托 daemon git apply） | task-06 | git_apply RPC，无容器内 git apply |
| D-003@V1（post_scan 委托保留校验） | task-07 | rev-parse/pollution/package.json 经原语 RPC，校验逻辑保留 |
| D-004@V1（server-local 不变） | task-01 | path_source 分流本地容器分支，零回归测试 |
| D-005@V1（RPC = per-daemon WS） | task-01, task-02, task-03 | 复用 DaemonWsHub，无新 HTTP server |
| D-006@V1（异步容错） | task-04 | 30s 超时 + 重连幂等 + RPC 失败 warn 不阻塞 complete_lease |
| D-007@V1（WS 双向 spike） | spike-01 | spike 报告 |
| D-008@V1（apply_patch 幂等） | task-04, task-06 | patch_id 去重 + git apply --check 预检 |
| D-009@V1（post_scan 委托方式） | task-07 | 方案 B 原语 RPC（本 plan 定档） |
| FR-01（HostFsDelegate 抽象） | task-01 | delegate.py 双路径单测 |
| FR-02（daemon host_fs handler） | task-02, task-03 | 8 方法 RPC 单测 |
| FR-03（complete_lease path_source 贯穿） | task-05, task-06, task-07, task-08 | daemon-client complete_lease 不 500 + 3 回调走 RPC |
| FR-04（dispatch 5 处统一） | task-09~task-13 | 5 处重构零回归 |
| FR-05（删死代码） | task-14 | coordinator.py:563-651 删除，无 caller |
| NFR-01（异步容错） | task-04 | 超时/重连/不阻塞 |
| NFR-02（server-local 零回归） | task-01 + 全局验收 | 现有测试全绿 |
| NFR-03（容器零宿主访问） | 全局验收 grep | grep 无残留 |

## 自检结果（full）

- [x] 每个 task 编号（task-01~15 + spike-01）
- [x] 每个 task 在 Wave 下有 checkbox（`- [ ] task-XX:`）
- [x] Wave 分组 + 依赖关系（W1 依赖 spike；W2/W3 依赖 W1；W4 依赖 W2/W3）
- [x] 任务总表（优先级 + 依赖列，**无估时列**）
- [x] 关键路径标注
- [x] 全局验收标准（具体可验证，含 brownfield 兼容条款）
- [x] D-001~009@V1 全部在覆盖矩阵（D-007 经 spike-01，D-008/009 经 plan 决策落地）
- [x] 无 P0/P1 unresolved blocker（decisions 全 @V1 当前版本）
- [x] brownfield 兼容：server-local 零回归（NFR-02 全局验收条目）
- [x] 无实现细节（接口签名/代码示例不在 plan.md，HostFsDelegate 接口仅列方法名作契约引用）
- [x] plan.md 与 design §6 文件清单一致（文件覆盖映射表 13 项 + 1 待核项）
- [x] 文件覆盖自检：design §6 每个源码文件均被至少一个 task 覆盖（见文件覆盖映射）
- [x] 跨任务契约自检：provider/consumer 关键字段已列（HostFsDelegate 接口 / WS RPC 协议 / 幂等契约 / path_source 透传），字段一致性细节留 task-NN.md 蓝图
- [x] 调用点搜索：8 处容器越界点已在 design §1/§5 标注文件:行号，task-08 的 change/dispatch.py 为明示待核项；完整调用点 grep 在 task 蓝图步骤记录
- [x] 无 Mermaid（依赖为「spike→W1→{W2,W3 并行}→W4」，关键路径 + 任务总表依赖列已完整表达，非必要不生成）
- [x] 无泛泛风险分析（design §11 风险已转为具体验收条目）
