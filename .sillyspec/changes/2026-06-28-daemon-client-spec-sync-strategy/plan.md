---
author: qinyi
created_at: 2026-06-28 04:19:00
plan_level: full
---

# 实现计划 — daemon-client workspace spec 同步策略可选

## Spike 前置验证

无 Spike。技术方案在 brainstorm 已确定：`fs.symlink('junction')` Windows 无提权可行（X-004）、`walkDir` 用 `fs.stat` 跟随链接穿 junction 可行（X-005）、pull/push 链路现有（spec-transport-tar-sync）。repo-native junction 在真实 Windows 的端到端行为作为 task-13 验收项（非独立 Spike）。

## 调用点搜索记录（签名扩展影响范围）

`pullSpecBundle` 改签名（加 strategy 可选参数）的调用点：
- `sillyhub-daemon/src/daemon.ts:2303`（interactive 路径，scan/stage）—— 本次传 strategy
- `sillyhub-daemon/src/task-runner.ts:351`（batch 路径）—— 不传 strategy（默认 platform-managed），保持 batch daemon-client spec 同步语义不变（design 非目标）

`_ensure_empty_spec_workspace` 改签名（加 strategy 参数）的调用点：
- `workspace/service.py:174`（create daemon-client 分支）、`:1188`（activate daemon-client）、`:1063`（scan_generate_daemon_client 创建 pending）—— 三处传 strategy（create/scan-generate 从请求体取，activate 用已落库值或默认）

`prepare_scan_interactive_dispatch` 加 strategy 参数的调用点：
- `agent/service.py:1392`（start_scan_dispatch）—— 传 spec_ws.strategy

## Wave 1（无依赖，backend 基础）

- [x] task-01: WorkspaceCreate 加 spec_strategy 字段（默认 platform-managed，Literal 三值）（覆盖：FR-01, D-001@v1, D-004@v1）
- [x] task-02: `_ensure_empty_spec_workspace` 接收 strategy 写库去硬编码；create daemon-client 分支（:146）+ scan_generate_daemon_client 创建 pending 分支（:1039）+ activate（:1188）传 strategy 落库（覆盖：FR-02, D-001@v1, D-003@v1, D-004@v1）
- [x] task-05: repo-mirrored 注释更新为"初始化单次同步快照"（覆盖：FR-13, D-002@v1）

## Wave 2（依赖 W1，透传契约 + daemon 字段定义）

- [x] task-03: `start_scan_dispatch` 读 spec_ws.strategy；AgentRun.spec_strategy（:1374）去硬编码；`prepare_scan_interactive_dispatch`（:1392）加 strategy 参数（覆盖：FR-03, FR-12, D-001@v1）
- [x] task-04: `build_claim_payload` interactive 分支（context.py:89-117，task-03 transport 透传同处）加 strategy 透传，与 transport/workspaceId 并列（覆盖：FR-03, D-001@v1）
- [x] task-06: LeaseCtx（execPayload）加 `specStrategy?: string` 字段（types.ts:293 后）（覆盖：FR-04, D-001@v1）

## Wave 3（依赖 W2 字段，daemon pull 三分支 + 生命周期）

- [x] task-07: `_startInteractiveSession` 读 execPayload.specStrategy（daemon.ts:2284 附近，camelCase + snake_case 兜底）传 pullSpecBundle（覆盖：FR-04, D-001@v1）
- [x] task-08: `pullSpecBundle` 加 strategy+rootPath 可选参数，按三分支（platform-managed 现状 / repo-mirrored 首次 fs.cp 从 rootPath/.sillyspec / repo-native 建 junction 跳过覆盖）；batch 调用点 task-runner.ts:351 不传保持现状（覆盖：FR-05, FR-06, FR-07, D-002@v1, D-004@v1, D-005@v1）
- [x] task-09: junction 生命周期 helper（建立 Win junction/Linux symlink 分支 / 复用 readlink 校验 / 降级普通目录残留+源项目不存在）+ repo-native 跳过 rm(specDir) 守卫（spec-sync.ts:96）（覆盖：FR-08, FR-09, R-01, R-02）
- [x] task-10: 核实 packSpecDir/walkDir 用 fs.stat 跟随链接穿 junction；postSpecSync 三策略都走（既有不变，确认无回归）（覆盖：FR-10, D-005@v1）

## Wave 4（依赖前 Wave，前端 + 测试 + 文档）

- [x] task-11: daemon-client 创建表单加 strategy segmented control（默认 platform-managed，repo-native 标注写入源项目），createWorkspace 请求带 spec_strategy（覆盖：FR-11, D-004@v1, D-005@v1）
- [x] task-12: backend 测试——WorkspaceCreate spec_strategy 字段测；daemon-client 创建带 strategy 落库测（含 scan_generate_daemon_client 分支）；dispatch lease payload 含 specStrategy 测；AgentRun.spec_strategy 读真实值测；server-local 零回归测（覆盖：FR-01~FR-03, FR-12）
- [x] task-13: daemon 测试——pullSpecBundle 三分支（platform-managed 回归/repo-mirrored fs.cp/repo-native junction）；junction 复用/降级；repo-native rm 防误删；源项目不存在降级；packSpecDir 穿 junction；跨平台（Win junction/Linux symlink，mock process.platform）；spec_workspace + spec-sync 模块文档更新（覆盖：FR-04~FR-10, R-01~R-05）

## Wave 5（task-14 补全，依赖 Wave 4 前端 + Wave 1~3 后端 scan-generate 通路已实现）

- [x] task-14: daemon-client 详情页加「扫描」按钮（三策略全显示，与 platform-managed「初始化」bootstrap 共存）+ 独立 scan 状态机（activeScanRunId/scanStatus/scanError）+ AgentRunPanel 实例 + scan/bootstrap 按钮 disabled 联动互斥；scanGenerate 加 specStrategy 参数 + 请求体 spec_strategy 透传；scan onDone → load() reload（覆盖：FR-14, D-006@v1, R-07, R-08）
- [x] task-15: task-14 前端单测——scanGenerate spec_strategy 透传测；daemon-client 三策略显示扫描按钮 + 点击调 scanGenerate 带正确参数 + 与 bootstrap 互斥 disabled 测（mock apiFetch + AgentRunPanel）（覆盖：FR-14, D-006@v1）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D |
|---|---|---|---|---|---|
| task-01 | WorkspaceCreate 加 spec_strategy 字段 | W1 | P0 | — | FR-01, D-001/D-004 |
| task-02 | _ensure_empty_spec_workspace 接收 strategy + 创建分支落库 | W1 | P0 | task-01 | FR-02, D-001/D-003/D-004 |
| task-05 | model.py repo-mirrored 注释更新 | W1 | P2 | — | FR-13, D-002 |
| task-03 | start_scan_dispatch 读 strategy + AgentRun 去硬编码 + dispatch 加参数 | W2 | P0 | task-02 | FR-03, FR-12, D-001 |
| task-04 | context.py build_claim_payload 透传 strategy | W2 | P0 | task-03 | FR-03, D-001 |
| task-06 | types.ts LeaseCtx 加 specStrategy | W2 | P0 | — | FR-04, D-001 |
| task-07 | daemon.ts 读取 specStrategy 传 pullSpecBundle | W3 | P0 | task-06, task-04 | FR-04, D-001 |
| task-08 | pullSpecBundle 三分支（签名扩展） | W3 | P0 | task-07 | FR-05/FR-06/FR-07, D-002/D-004/D-005 |
| task-09 | junction 生命周期 + rm 防误删守卫 | W3 | P0 | task-08 | FR-08/FR-09, R-01/R-02 |
| task-10 | packSpecDir 穿 junction 核实 + postSpecSync 三策略 | W3 | P1 | task-08 | FR-10, D-005 |
| task-11 | 前端创建表单 strategy 选项 UI | W4 | P1 | task-01 | FR-11, D-004/D-005 |
| task-12 | backend 测试（透传+落库+真实值+零回归） | W4 | P0 | task-01~04 | FR-01~FR-03, FR-12 |
| task-13 | daemon 测试（三分支+junction+rm+跨平台）+ 模块文档 | W4 | P0 | task-06~10 | FR-04~FR-10, R-01~R-05 |
| task-14 | daemon-client 详情页扫描入口（按钮+独立状态机+互斥+scanGenerate透传） | W5 | P0 | task-11, task-02(scan_generate_daemon_client 既有) | FR-14, D-006, R-07/R-08 |
| task-15 | task-14 前端单测（透传+按钮渲染/调用/互斥） | W5 | P0 | task-14 | FR-14, D-006 |

## 关键路径

task-01 → task-02 → task-03 → task-04 → task-07 → task-08 → task-13

（schema 字段 → 创建落库 → dispatch 读 strategy → lease 透传 → daemon 接收 → pullSpecBundle 三分支 → daemon 测试。最长链，决定交付周期。）

## 全局验收标准

- [ ] **默认零回归**：不传 spec_strategy 时 daemon-client 创建与 scan 行为与现状一致（platform-managed，空 spec_root 等 scan）；server-local 创建 copytree 行为不变
- [ ] **repo-mirrored 可用**：选 repo-mirrored + 源项目含 .sillyspec，首次 scan 后平台 specRoot 含源项目已有内容
- [ ] **repo-native 可用**：选 repo-native + 源项目含 .sillyspec，daemon 建 junction，scan 写源项目，平台经 postSpecSync 落镜像；源项目不存在 .sillyspec 时降级单次导入 + warn
- [ ] **rm 防误删**：repo-native 下 rm(specDir) 被跳过，不顺 junction 删源项目（单测覆盖）
- [ ] **跨平台**：Windows junction（fs.symlink 'junction' 无需提权）/ Linux·macOS symlink 均可建（mock process.platform 单测）
- [ ] **透传契约**：scan lease payload 含 specStrategy 字段（backend dispatch 集成测）
- [ ] **batch 零回归**：task-runner.ts:351 batch 调用点不传 strategy，行为不变
- [ ] backend 单测全通过（`make backend-test`）
- [ ] daemon 单测全通过（`cd sillyhub-daemon && pnpm test`）
- [ ] frontend 单测全通过（`cd frontend && pnpm test`）
- [ ] **daemon-client 首次 scan 可触发**（task-14）：daemon-client workspace 创建后，详情页「扫描」按钮触发 scan-generate，repo-native/repo-mirrored 下源项目 .sillyspec 数据回灌平台 specRoot（scan-docs/changes 非空，修复 task-01~13 遗留的创建后无 scan 入口缺口）；scan/bootstrap 按钮互斥

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1（strategy 透传链路） | task-01, 02, 03, 04, 06, 07, 12 | AC 透传契约 + 创建落库测 + AgentRun 真实值测 |
| D-002@v1（repo-mirrored 单次同步） | task-05, 08, 13 | AC repo-mirrored 可用 + model 注释 + fs.cp 分支测 |
| D-003@v1（只 daemon-client） | task-02, 12 | AC server-local 零回归测 |
| D-004@v1（默认 platform-managed） | task-01, 02, 08, 11, 12 | AC 默认零回归 + 前端默认选中 + platform-managed 分支回归测 |
| D-005@v1（repo-native 接受写入源项目） | task-08, 10, 11, 13 | AC repo-native 可用 + 前端文案标注 + junction 分支测 |
| D-006@v1（daemon-client 详情页扫描入口） | task-14, 15 | AC daemon-client 首次 scan 可触发 + 按钮渲染/调用/互斥测 |

无 P0/P1 unresolved blocker（decisions D-001~D-006 全 accepted）。
