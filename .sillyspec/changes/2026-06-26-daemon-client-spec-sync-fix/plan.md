---
author: qinyi
created_at: 2026-06-26 11:32:58
plan_level: full
---

# 实现计划 — daemon-client workspace spec 树同步修复

## Spike 前置验证

无独立 Spike。技术方案确定（方案 A 已选定、lease-polling 机制已核实 daemon/router.py:1393 存在）。R3（post_scan_validator 的 source_root vs spec_root 语义）并入 task-04 顺带核实，通过则不改、不通过则按 mode 适配——不阻塞。

## Wave 1（无依赖，并行启动）

- [x] task-01: SpecPathResolver 增 `platform_managed` mode + `for_spec_workspace(spec_ws)` 工厂（覆盖：FR-01, FR-02, D-005@v1）
- [x] task-06: daemon 抽 `syncSpecTreeIfNeeded` + scan run 终态触发 + `packSpecDir` 不再排除 `.runtime`（覆盖：FR-05, FR-06, D-002@v1）
- [x] task-07: backend `apply_sync` 接收 `.runtime`（去 preserve-overwrite）+ 落 `last_synced_at`（覆盖：FR-06, FR-07）
- [x] task-08: `daemon_change_writes` model + migration（覆盖：FR-08, D-004@v1）

## Wave 2（依赖 Wave 1，并行）

- [x] task-02: scan_docs parser+service 按 mode 解析（←task-01）（覆盖：FR-01）
- [x] task-03: runtime/service + knowledge 重定向 spec_ws.spec_root + mode（←task-01）（覆盖：FR-01, FR-03）
- [x] task-04: spec_workspace/validator + post_scan_validator mode/核实 R3（←task-01）（覆盖：FR-01）
- [x] task-05: context_builder prompt platform-managed 分支去 `.sillyspec`（←task-01）（覆盖：FR-04）
- [x] task-09: backend `GET /runtimes/{rid}/pending-change-writes` + claim/complete 端点（←task-08）（覆盖：FR-08）

## Wave 3（依赖 Wave 1-2，并行）

- [x] task-10: change_writer `proxy_create_change` + `POST /changes/proxy-create` + schema + service 改造（←task-08, task-09）（覆盖：FR-08, FR-09）
- [x] task-11: daemon task-runner `kind=change-write` 轻量分支（←task-06, task-09）（覆盖：FR-08, FR-10, D-004@v1）

## Wave 4（依赖 Wave 3）

- [x] task-12: frontend changes 新建入口 daemon-client 调 proxy + 无 daemon 禁用引导（←task-10）（覆盖：FR-08, FR-09）

## Wave 5（验证-单测集成，依赖 Wave 2-4）

- [x] task-13: Phase 1-3 单测/集成测（←task-02~task-12）（覆盖：FR-01~FR-10, NFR-02~04）

## Wave 6（验证-端到端，依赖 Wave 5）

- [ ] task-14: 端到端联调（真实 workspace `7cd27eb9`，backend Docker + 宿主 daemon）（←task-13）（覆盖：SC1, SC2, SC4, SC5, SC6, SC7）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | SpecPathResolver platform_managed mode + 工厂 | W1 | P0 | — | FR-01, FR-02, D-005@v1 | 全 Phase 基础，其余 reader 依赖 |
| task-02 | scan_docs parser+service mode | W2 | P0 | task-01 | FR-01 | 去 `parser.py:105` 硬编码 |
| task-03 | runtime + knowledge(service 重定向) mode | W2 | P0 | task-01 | FR-01, FR-03 | knowledge 不再用不可达 root_path（R6） |
| task-04 | validator + post_scan_validator mode/核实 | W2 | P1 | task-01 | FR-01 | 含 R3 核实，可能 no-op |
| task-05 | context_builder prompt 一致化 | W2 | P1 | task-01 | FR-04 | platform-managed 去 `.sillyspec` |
| task-06 | daemon syncSpecTreeIfNeeded + scan 终态触发 + packSpecDir 含 .runtime | W1 | P0 | — | FR-05, FR-06, D-002@v1 | daemon 侧三合一（无依赖，W1 启动） |
| task-07 | apply_sync 收 .runtime + last_synced_at | W1 | P0 | — | FR-06, FR-07 | backend 侧（无依赖，W1 启动） |
| task-08 | daemon_change_writes model + migration | W1 | P0 | — | FR-08, D-004@v1 | 无依赖 W1 启动，task-09/10/11 依赖 |
| task-09 | backend pending-change-writes + claim/complete 端点 | W2 | P0 | task-08 | FR-08 | daemon 轮询消费 |
| task-10 | change_writer proxy + 端点 + schema + service 改造 | W3 | P0 | task-08, task-09 | FR-08, FR-09 | 无 runtime→DAEMON_CLIENT_NO_SESSION |
| task-11 | daemon task-runner change-write 分支 | W3 | P0 | task-06, task-09 | FR-08, FR-10, D-004@v1 | 不启 agent |
| task-12 | frontend changes 入口 proxy + 引导 | W4 | P1 | task-10 | FR-08, FR-09 | 禁用 + tooltip |
| task-13 | 单测/集成测 | W5 | P0 | task-02~task-12 | FR-01~FR-10, NFR-02~04 | double-sync 幂等 + 超时兜底 |
| task-14 | 端到端联调 | W6 | P0 | task-13 | SC1, SC2, SC4, SC5, SC6, SC7 | 真实 workspace 7cd27eb9 |

## 关键路径

拓扑最长链（决定最短交付周期）：

`task-08(W1) → task-09(W2) → task-10(W3) → task-13(W5) → task-14(W6)`

（task-11 链 task-06→task-11 与 task-10 同属 W3，不延长关键路径；task-12 在 task-10 之后但 W4，汇入 task-13。）

W1 四任务（task-01/06/07/08）无依赖可立即并行启动，是最高并发点。

## 全局验收标准

- SpecPathResolver mode 单测：platform-managed 各路径方法不含 `.sillyspec` 段；repo-native/server-local 保持包裹（FR-01, FR-02）
- daemon-client workspace scan run 终态后，`scan_documents>0`、knowledge 列表非空、RuntimeProgress 含进度（SC1）
- `spec_workspaces.last_synced_at` scan 终态后非 NULL，`sync_status=clean`（SC2）
- server-local/repo-native workspace 行为零回归（现有测试通过）（SC3）
- daemon-client（daemon 在线）UI 新建 change 成功，文件落 daemon 本地 + Change 行落库（SC4）
- daemon-client（daemon 离线）新建 change 返回 `DAEMON_CLIENT_NO_SESSION`（400）+ 前端引导（SC5）
- apply_sync double-sync（scan 终态 + session-end）幂等无副作用（NFR-02）
- change-write pending 超时→failed，前端可重试（NFR-03）
- backend 子项目测试通过（`cd backend && uv run pytest`）、daemon 测试通过（`cd sillyhub-daemon && pnpm test`）（local.yaml）
- Windows/macOS daemon 路径兼容（`os.homedir()`，既有约束）（SC7）

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1（scope 全修） | task-01~task-14 | 全局验收（P1+P2+P3+runtime 全覆盖） |
| D-002@v1（scan 终态即回灌） | task-06 | scan 终态触发 sync 单测 + SC1/SC2 |
| D-003@v1（.runtime 纳入 push） | task-06, task-07 | packSpecDir 含 .runtime + apply_sync 接收 + SC1(runtime) |
| D-004@v1（change-write lease-polling） | task-08, task-09, task-10, task-11 | pending-change-writes 轮询 + daemon claim 写 + SC4/SC5 |
| D-005@v1（SpecPathResolver mode） | task-01, task-02, task-03, task-04, task-05 | mode 单测 + server-local 回归 SC3 |
| FR-01 | task-01, task-02, task-03, task-04 | reader mode 单测 |
| FR-02 | task-01 | repo-native 回归测 |
| FR-03 | task-03 | knowledge 重定向测 |
| FR-04 | task-05 | prompt 一致化 |
| FR-05 | task-06 | scan 终态触发 sync |
| FR-06 | task-06, task-07 | .runtime 双端 + runtime 可见 |
| FR-07 | task-07 | last_synced_at 落库 |
| FR-08 | task-08, task-09, task-10, task-11, task-12 | change-write 端到端 |
| FR-09 | task-10, task-12 | 无 daemon 结构化错误 |
| FR-10 | task-11 | change-write 不启 agent |
