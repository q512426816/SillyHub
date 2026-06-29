---
author: qinyi
created_at: 2026-06-28 04:17:35
---

# Requirements

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户 | 在 UI 创建 daemon-client workspace 时选 spec 同步策略，查看 scan-docs/knowledge/runtime/changes |
| backend（FastAPI） | 跑 Docker，托管 spec_workspaces，构造 scan lease payload 透传 strategy，读平台 specRoot |
| daemon（sillyhub-daemon） | 跑客户端机器，按 strategy 自治分支初始化 spec 缓存（pull/复制/junction），执行 scan，回灌 spec 树 |

## 功能需求

### FR-01: WorkspaceCreate 支持 spec_strategy 字段
覆盖决策：D-001@v1, D-004@v1
- **Given** 创建 daemon-client workspace 的请求
- **When** 请求体含 `spec_strategy`（platform-managed/repo-mirrored/repo-native）
- **Then** WorkspaceCreate schema 接受该字段；未提供时默认 `platform-managed`

### FR-02: daemon-client 创建时 strategy 落 spec_workspaces
覆盖决策：D-001@v1, D-003@v1, D-004@v1
- **Given** daemon-client workspace 创建（`workspace/service.py:create` daemon-client 分支，或 `scan_generate_daemon_client` 创建 pending 分支）
- **When** `_ensure_empty_spec_workspace` 执行
- **Then** `spec_workspaces.strategy` 写入用户选择的值，不再硬编码 platform-managed
- **Given** server-local workspace 创建
- **When** 走 `_ensure_spec_workspace`（copytree 路径）
- **Then** 行为不变（本次不动 server-local，D-003）

### FR-03: strategy 经 scan lease payload 透传（backend→daemon）
覆盖决策：D-001@v1
- **Given** daemon-client workspace 的 scan dispatch
- **When** `daemon/lease/context.py build_claim_payload` 构造 interactive 分支 claim payload
- **Then** payload 含 `specStrategy`（与 transport/workspaceId 并列）；AgentRun.spec_strategy 读 `spec_ws.strategy` 而非硬编码

### FR-04: daemon 接收 specStrategy
覆盖决策：D-001@v1
- **Given** daemon `_startInteractiveSession` 收到含 specStrategy 的 execPayload
- **When** transport=tar 进入 pull 阶段
- **Then** 读取 `execPayload.specStrategy`（camelCase + snake_case 兜底），传入 `pullSpecBundle`；缺字段时按 platform-managed 兼容

### FR-05: pullSpecBundle platform-managed 分支现状回归
覆盖决策：D-004@v1
- **Given** strategy=platform-managed（或缺省）
- **When** pullSpecBundle 执行
- **Then** 行为与现状一致（getSpecBundle，404→mkdir 空目录）

### FR-06: pullSpecBundle repo-mirrored 分支单次导入
覆盖决策：D-002@v1
- **Given** strategy=repo-mirrored 且首次 scan（backend getSpecBundle 返回 404 或本地缓存空）
- **When** pullSpecBundle 执行
- **Then** 从 `rootPath/.sillyspec` `fs.cp` 单次复制到 specDir
- **Given** strategy=repo-mirrored 且非首次（backend 有 bundle）
- **When** pullSpecBundle 执行
- **Then** 正常拉 bundle（既有 rm+extract 路径）

### FR-07: pullSpecBundle repo-native 分支建 junction
覆盖决策：D-005@v1
- **Given** strategy=repo-native 且 `rootPath/.sillyspec` 存在
- **When** pullSpecBundle 执行
- **Then** 建 junction（Win `fs.symlink('junction')` / Linux·macOS symlink）`specDir → rootPath/.sillyspec`，跳过 getSpecBundle 覆盖
- **Given** strategy=repo-native 且 `rootPath/.sillyspec` 不存在
- **When** pullSpecBundle 执行
- **Then** 降级为 repo-mirrored 单次复制行为 + warn

### FR-08: junction 生命周期（复用/降级）
覆盖决策：R-01, R-02
- **Given** pull 时 specDir 已是 junction
- **When** 目标与 rootPath/.sillyspec 一致
- **Then** 复用，不重建
- **Given** pull 时 specDir 是普通目录（历史残留）
- **When** repo-native 模式
- **Then** 不自动删（防误删数据），warn + 降级 platform-managed 行为

### FR-09: repo-native rm 防误删守卫
覆盖决策：R-01
- **Given** pullSpecBundle 的 `rm(specDir, recursive)`（spec-sync.ts:96）
- **When** strategy=repo-native
- **Then** 跳过 rm（junction 不能 rm，否则顺链删源项目）；仅 platform-managed/repo-mirrored 走 rm

### FR-10: packSpecDir 穿 junction + postSpecSync 三策略都走
覆盖决策：D-005@v1
- **Given** strategy=repo-native（specDir 是 junction）
- **When** postSpecSync/packSpecBundle 执行
- **Then** packSpecDir 经 readFile 穿 junction 打包源项目真实内容；walkDir 用 fs.stat（跟随链接）正确遍历；三策略都触发 postSpecSync 回灌平台

### FR-11: 前端创建表单 strategy 选项
覆盖决策：D-004@v1, D-005@v1
- **Given** 前端 daemon-client workspace 创建表单（workspace-scan-dialog.tsx）
- **When** 用户选择 path_source=daemon-client
- **Then** 显示 strategy segmented control（默认 platform-managed），三选项附语义说明，repo-native 明示"会写入源项目"；createWorkspace 请求带 spec_strategy

### FR-12: AgentRun.spec_strategy 读真实值
覆盖决策：D-001@v1
- **Given** scan dispatch 创建 AgentRun（agent/service.py:1374）
- **When** 写入 spec_strategy
- **Then** 读 `spec_ws.strategy`（或入参），不再硬编码 "platform-managed"

### FR-13: model.py repo-mirrored 注释更新
覆盖决策：D-002@v1
- **Given** spec_workspace/model.py 的 strategy 字段注释
- **When** 实现完成
- **Then** repo-mirrored 注释更新为"初始化单次同步快照"（覆盖旧 bidirectionally synced）

## 非功能需求

- **兼容性**：Windows / Linux / macOS（daemon 路径用 `os.homedir()`，junction 按 `process.platform` 分支）。默认 platform-managed 零回归；daemon 缺 specStrategy 字段时按 platform-managed 兼容。
- **可回退**：repo-native 出问题（误删风险/链接失效）时，用户重建 workspace 选 platform-managed 即可回退（数据可清，CLAUDE.md 规则 10）。
- **可测试**：三分支 + junction 生命周期 + rm 防误删 + 跨平台 + 透传契约均有单测/集成测覆盖。
- **安全**：repo-native rm 守卫防误删源项目；junction target 必须绝对路径。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-02, FR-03, FR-04, FR-12 | strategy 透传链路（schema→创建落库→lease 透传→daemon 接收→AgentRun 真实值） |
| D-002@v1 | FR-06, FR-13 | repo-mirrored 单次同步语义 + model 注释 |
| D-003@v1 | FR-02 | 范围只 daemon-client（server-local 不动） |
| D-004@v1 | FR-01, FR-02, FR-05, FR-11 | 默认 platform-managed 零回归 |
| D-005@v1 | FR-07, FR-10, FR-11 | repo-native 接受写入源项目 |

无未覆盖的 D-xxx@vN（D-001~D-005 全部被 FR 覆盖）。剩余风险 R-01~R-06 见 design.md §10。
