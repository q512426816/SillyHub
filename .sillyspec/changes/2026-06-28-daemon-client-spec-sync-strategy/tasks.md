---
author: qinyi
created_at: 2026-06-28 04:17:35
---

# Tasks — daemon-client workspace spec 同步策略可选

任务列表（名称 + 对应文件 + 覆盖 FR/D）。细节（Wave 分组、依赖、AC）在 plan 阶段展开。

## Phase 1 — backend：strategy 贯穿创建 + lease 透传

- [x] **task-01**: WorkspaceCreate 加 spec_strategy 字段（默认 platform-managed，Literal 三值） — `backend/app/modules/workspace/schema.py` — FR-01, D-001@v1, D-004@v1
- [x] **task-02**: `_ensure_empty_spec_workspace` 接收 strategy 写库去硬编码；`create` daemon-client 分支（:146）+ `scan_generate_daemon_client` 创建 pending 分支（:1039）传 strategy 落库 — `backend/app/modules/workspace/service.py` — FR-02, D-001@v1, D-003@v1, D-004@v1
- [x] **task-03**: `start_scan_dispatch` 读 spec_ws.strategy；AgentRun.spec_strategy（:1374）去硬编码读真实值；`prepare_scan_interactive_dispatch` 加 strategy 参数 — `backend/app/modules/agent/service.py`（+ RunPlacementService 定位） — FR-03, FR-12, D-001@v1
- [x] **task-04**: `build_claim_payload` interactive 分支（:89-117，task-03 transport 透传同处）加 strategy 透传，与 transport/workspaceId 并列 — `backend/app/modules/daemon/lease/context.py` — FR-03, D-001@v1
- [x] **task-05**: repo-mirrored 注释更新为"初始化单次同步快照"（覆盖旧 bidirectionally synced） — `backend/app/modules/spec_workspace/model.py` — FR-13, D-002@v1

## Phase 2 — daemon：strategy 接收 + pullSpecBundle 三分支

- [x] **task-06**: LeaseCtx（execPayload）加 `specStrategy?: string` 字段（:293 workspaceId 后） — `sillyhub-daemon/src/types.ts` — FR-04, D-001@v1
- [x] **task-07**: `_startInteractiveSession` 读 execPayload.specStrategy（:2284 附近，camelCase + snake_case 兜底），传入 pullSpecBundle — `sillyhub-daemon/src/daemon.ts` — FR-04, D-001@v1
- [x] **task-08**: `pullSpecBundle` 加 strategy+rootPath 参数，按三分支（platform-managed 现状 / repo-mirrored 首次 fs.cp 从 rootPath/.sillyspec / repo-native 建 junction 跳过覆盖） — `sillyhub-daemon/src/spec-sync.ts` — FR-05, FR-06, FR-07, D-002@v1, D-004@v1, D-005@v1

## Phase 3 — daemon：junction 生命周期 + push 适配 + rm 防误删

- [x] **task-09**: junction 生命周期 helper（建立：Win junction/Linux symlink 分支；复用：readlink 校验目标；降级：普通目录残留/源项目不存在） + repo-native 跳过 rm(specDir) 守卫 — `sillyhub-daemon/src/spec-sync.ts` — FR-08, FR-09, R-01, R-02
- [x] **task-10**: 核实 packSpecDir/walkDir 用 fs.stat 跟随链接穿 junction；postSpecSync 三策略都走（既有不变，确认无回归） — `sillyhub-daemon/src/spec-sync.ts` — FR-10, D-005@v1

## Phase 4 — 前端 + 测试 + 文档

- [x] **task-11**: daemon-client 创建表单加 strategy segmented control（默认 platform-managed，repo-native 标注写入源项目），createWorkspace 请求带 spec_strategy — `frontend/src/components/workspace-scan-dialog.tsx`（+ lib/workspaces.ts 类型） — FR-11, D-004@v1, D-005@v1
- [x] **task-12**: backend 测试——WorkspaceCreate spec_strategy 字段测；daemon-client 创建带 strategy 落库测（含 scan_generate_daemon_client 分支）；dispatch lease payload 含 specStrategy 测；AgentRun.spec_strategy 读真实值测；server-local 零回归测 — `backend/tests/modules/workspace/` + `backend/tests/modules/agent/` + `backend/tests/modules/daemon/` — FR-01~FR-03, FR-12
- [x] **task-13**: daemon 测试——pullSpecBundle 三分支（platform-managed 回归/repo-mirrored fs.cp/repo-native junction）；junction 复用/降级；repo-native rm 防误删；源项目不存在降级；packSpecDir 穿 junction；跨平台（Win junction/Linux symlink，mock process.platform）；spec_workspace + spec-sync 模块文档更新 — `sillyhub-daemon/tests/` + `.sillyspec/docs/` 模块文档 — FR-04~FR-10, R-01~R-05

## Phase 5 — 前端：daemon-client 详情页首次 scan 触发入口（task-14 补全，D-006@v1）

- [x] **task-14**: daemon-client 详情页加「扫描」按钮（三策略全显示，与 platform-managed「初始化」bootstrap 按钮共存）+ 独立 scan 状态机（activeScanRunId/scanStatus/scanError，参考 :123-126）+ AgentRunPanel 实例（参考 :497-518）+ scan/bootstrap 按钮 disabled 联动互斥；scanGenerate（lib/workspaces.ts:123-140）加 specStrategy 参数 + 请求体 spec_strategy 透传；scan onDone → load() reload — `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` + `frontend/src/lib/workspaces.ts` — FR-14, D-006@v1, R-07, R-08
- [x] **task-15**: task-14 前端单测——scanGenerate spec_strategy 透传测（lib/workspaces.test）；daemon-client 三策略显示扫描按钮 + 点击调 scanGenerate 带正确参数 + 与 bootstrap 互斥 disabled 测（page 层，mock apiFetch + AgentRunPanel）— `frontend/src/lib/__tests__/workspaces.test.ts` + `frontend/src/app/(dashboard)/workspaces/[id]/page.test.tsx`（暂定） — FR-14, D-006@v1
