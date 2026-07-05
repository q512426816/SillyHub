---
author: qinyi
created_at: 2026-07-02 10:55:00
change: 2026-07-02-workspace-config-flow
---

# plan — 工作区配置流程重设计

> design.md §8 的 W1-W4 在此落地为 task。所有 task 覆盖 decisions.md D-001@V1 ~ D-012@V1（D-003@V2 为当前版本）。自检见末尾。

## plan_level: full

| 字段 | 值 |
|---|---|
| reason | 4 Phase 约 17 task，跨 frontend/backend/daemon 三模块，schema 变更 + 状态机（init lease + spec-sync outbox）+ agent 调度接线 |
| estimated_files | 17 |
| cross_module | true |
| has_schema_change | true（SpecWorkspace.spec_version、WorkspaceMemberRuntime.init_synced_*） |
| has_state_machine_change | true（init lease、spec-sync outbox） |
| needs_parallel_execution | true（与 2026-07-02-change-detail-file-tree-editor 并行，注意交叉） |
| needs_human_review | false |

## 调用点搜索记录（plan 自检：构造函数/接口/DTO/client 变更已搜调用点）

- `_resolve_dispatch_runtime` / `_resolve_decide_runtime`（agent/placement.py:602/732）→ 被 `prepare_scan_interactive_dispatch`（:137/:209）调用；`start_scan_dispatch`（agent/service.py:1246）。W1 task-02 改这些。
- `start_scan_dispatch` 调用点：agent/service.py:1246（定义）、router.py:232（bundle 注释引用）、tests/test_start_scan_dispatch_daemon_client.py。
- `bootstrapSpecWorkspace` 前端调用点：`workspaces/[id]/page.tsx:266`、`lib/spec-workspaces.ts:137`、测试 `lib/__tests__/spec-workspaces.test.ts`。W2 task-06 改。
- `scanGenerate` 前端调用点：`workspaces/[id]/page.tsx:286`、`lib/workspaces.ts:124`、`workspace-scan-dialog.tsx:126`、测试。W2 task-07 加 owner 门禁。
- `updateWorkspace({daemon_runtime_id})` 调用点：`workspace-daemon-switcher.tsx:98`（D-011 改 upsertMyBinding）、测试。W1 task-04 改。
- `DaemonChangeWrite` model（daemon/model.py:288）当前**无 kind 字段**——2026-07-02-change-detail-file-tree-editor 加 kind=create/edit。本变更 W3 task-13 扩 spec-sync 取值（kind 为 free-form str，**本变更零 schema 变更**，只加代码分支识别 spec-sync）。
- `SpecWorkspace.profile_version`（spec_workspace/model.py:70，str）已存在但语义是 spec profile 版本——本变更**新增 `spec_version: int`**（task-09 migration），不复用 profile_version（语义不同）。

## Wave 分组 + 依赖

### Wave 1｜per-member 接线 + 客户端路径可编辑（低风险，复用已落地表）

- [x] task-01: backend `MemberBindingResolver` 接入 `RunPlacementService`（D-006）
  - 改 `_resolve_dispatch_runtime`（placement.py:602）/ `_resolve_decide_runtime`（:732）按 actor 读 `WorkspaceMemberRuntime`（runtime_id+root_path），废弃读 `Workspace` 全局 daemon_runtime_id/root_path；保留全局列只读回退（无 member 行时）。
  - 文件：`backend/app/modules/agent/placement.py`
  - 验收：两成员绑定不同 daemon+路径，A 发起 scan 用 A 的 binding 路由（集成测覆盖）；旧 binding（无 member 行）回退读全局列不崩。
  - 依赖：无（表已落地 e2f65d9a）

- [x] task-02: backend `start_scan_dispatch` 接线 member binding + owner 校验（D-006/D-003@V2）
  - `start_scan_dispatch`（service.py:1246）的 actor 透传给 placement；`scan_generate` 加 owner 校验（非 owner → 403）+ count 门禁（scan_documents>0 且无 force → 409）。
  - 文件：`backend/app/modules/agent/service.py`、`backend/app/modules/workspace/service.py`（scan_generate owner+count）
  - 验收：非 owner 调 scan_generate → 403；owner + 已有文档 + 无 force → 409；owner + force=true → 成功。
  - 依赖：task-01

- [x] task-03: backend PUT /my-binding 已存在（无需改）—— 核实 + 补 init_synced 字段（D-010，配合 W3）
  - 核实 `member_runtimes/router.py` PUT /my-binding 现状；加 `init_synced_at`/`init_synced_spec_version` 字段（model + migration 在 task-09 统一）。
  - 文件：`backend/app/modules/workspace/member_runtimes/{model,service}.py`
  - 验收：PUT /my-binding 能写 init_synced_*（初始 null）。
  - 依赖：task-09（migration）

- [x] task-04: frontend `WorkspaceDaemonSwitcher` per-member 化（D-011）
  - `handleSwitch`（workspace-daemon-switcher.tsx:98）从 `updateWorkspace({daemon_runtime_id})` 改 `upsertMyBinding({runtime_id})`；更新测试。
  - 文件：`frontend/src/components/workspace-daemon-switcher.tsx`、`__tests__/workspace-daemon-switcher.test.tsx`
  - 验收：switcher 改的是当前用户 member binding 的 runtime_id（不写 workspace 全局列）。
  - 依赖：无

- [x] task-05: frontend「编辑我的接入配置」入口（D-007）
  - `WorkspaceAccessGuide` 支持已绑定编辑（回填当前 binding 值）；`WorkspaceBindingGuard` 已绑定时在详情页规范管理区提供编辑入口（不再只 unbound 渲染）。
  - 文件：`frontend/src/components/workspace-access-guide.tsx`、`workspace-binding-guard.tsx`
  - 验收：已绑定成员点「编辑」能改 root_path/runtime_id/path_source 并保存（PUT /my-binding）。
  - 依赖：task-03（init_synced 字段）、task-04（switcher 统一）

### Wave 2｜初始化重定义 + 扫描门禁前端

- [x] task-06: backend `start_init_dispatch`（D-002/D-009）+ bootstrap 自动化
  - 新增 `start_init_dispatch(workspace_id, actor)`（仿 start_scan_dispatch），建 init-mode lease，payload 带 platform_config{server_origin,strategy} + latest_spec_version + root_path（取 member binding）；`bootstrapSpecWorkspace` 建容器作为 init dispatch 前置自动步骤。
  - 文件：`backend/app/modules/agent/service.py`（新增 start_init_dispatch）、`spec_workspace/service.py`（bootstrap 自动化）、`workspace/router.py`（init 端点）
  - 验收：POST init → 建 spec_workspace 容器（若未建）+ 建 init lease（payload 含 platform_config/latest_spec_version/root_path）。
  - 依赖：task-01（member binding 解析）、task-09（spec_version 字段）

- [x] task-07: daemon init lease 处理 + `.sillyspec-platform.json` 写入（D-002/D-009）
  - task-runner/interactive 路径处理 init lease：写 `.sillyspec-platform.json`（{workspace_id,server_origin,strategy,spec_version,cache_root,synced_at}）→ pullSpecBundle → postSpecSync（若有本地改动）→ lease complete 上报 init_synced_*。
  - 文件：`sillyhub-daemon/src/task-runner.ts`（或 interactive/）、`spec-sync.ts`（platform.json 读写工具）
  - 验收：daemon 拉到 init lease → 写 platform.json + pull 文档；complete 后 backend 更新 WorkspaceMemberRuntime.init_synced_at。
  - 依赖：task-06

- [x] task-08: frontend「初始化」按钮改调 init dispatch + 三态引导（D-002/D-005）
  - `workspaces/[id]/page.tsx:266` 初始化按钮改调 init dispatch + 轮询 init lease 状态；详情页三态引导（未初始化/已初始化未扫描/已扫描）；服务器无文档时提示「请先扫描」。
  - 文件：`frontend/src/app/(dashboard)/workspaces/[id]/page.tsx`、`lib/spec-workspaces.ts`（init dispatch + 轮询 API）
  - 验收：未初始化→「初始化」按钮；点初始化→轮询→就绪/提示先扫描；扫描按钮非 owner 禁用+提示、owner 已扫弹确认（接 task-02 后端）。
  - 依赖：task-06、task-07、task-02（owner 门禁后端）

### Wave 3｜文档双向缓存同步（最高风险，独立 Wave）

- [x] task-09: backend migration + SpecWorkspace.spec_version 递增（D-010）
  - Alembic migration：SpecWorkspace 加 `spec_version: int NOT NULL DEFAULT 0`（不复用 profile_version）；WorkspaceMemberRuntime 加 `init_synced_at: datetime NULL` + `init_synced_spec_version: int NULL`。**down_revision 接真实 head**（execute 前查 alembic_version + 排序，避免与 change-detail-file-tree-editor 的 migration 双 head）。
  - scan_generate 成功 / apply_sync 落盘后 spec_version += 1。
  - 文件：`backend/app/modules/spec_workspace/{model,service}.py`、`workspace/member_runtimes/model.py`、`migrations/versions/<new>.py`
  - 验收：migration up/down 可逆；scan 成功后 spec_version 递增；旧数据默认 0 不崩。
  - 依赖：**协调 2026-07-02-change-detail-file-tree-editor 的 migration 先合**（两变更并行，execute 时查 alembic_version 定 head）

- [x] task-10: backend lease payload 加 latest_spec_version（D-010）
  - scan/agent/init lease payload 统一加 `latest_spec_version` 字段（取 SpecWorkspace.spec_version）。
  - 文件：`backend/app/modules/agent/service.py`（start_scan_dispatch/start_init_dispatch）、agent dispatch lease payload schema
  - 验收：lease payload 含 latest_spec_version；集成测覆盖。
  - 依赖：task-09

- [x] task-11: daemon 缓存日常保鲜（D-010）
  - daemon 每次 agent/scan 任务执行前，比对 lease 的 latest_spec_version 与本地 `.sillyspec-platform.json.spec_version`；不一致触发 pullSpecBundle；pull 后更新本地 spec_version。
  - 文件：`sillyhub-daemon/src/spec-sync.ts`、`task-runner.ts`/`interactive/`
  - 验收：A 重扫后 B 下次任务前比对到版本落后 → 自动 pull；版本一致不重复 pull。
  - 依赖：task-10

- [x] task-12: daemon pull 前回灌本地改动（D-008）
  - `pullSpecBundle` 前检查本地未回灌改动（postSpecSync 失败标记 `.runtime/pending_push` 或本地 mtime 新于 synced_at）→ 先 postSpecSync 再 pull；回灌失败 abort pull + lease failed。
  - 文件：`sillyhub-daemon/src/spec-sync.ts`
  - 验收：本地有未回灌改动时 pull 前先 push（单测 mock 未回灌标记）；回灌失败不覆盖本地。
  - 依赖：无（独立 daemon 改动）

- [x] task-13: backend + daemon 手动同步 outbox（D-012，复用 DaemonChangeWrite）
  - backend：POST 端点建 `DaemonChangeWrite` 行 kind=spec-sync（path_source 分流：server-local 直接收 / daemon-client 入 outbox）；GET 端点查 pending 状态。
  - daemon：task-runner 处理 kind=spec-sync 行 → postSpecSync 整树回灌 → complete。
  - **零 schema 变更**（kind 为 free-form str，依赖 change-detail-file-tree-editor 的 kind 列先合；若该变更未合则本变更自带 kind 列 migration，down_revision 协调）。
  - 文件：`backend/app/modules/workspace/router.py`（或 spec_workspace/router.py，sync 端点）、`daemon/change_write_router.py`（kind 识别）、`sillyhub-daemon/src/task-runner.ts`（spec-sync 处理）
  - 验收：点「同步到服务器」→ daemon-client 建 outbox 行 → daemon postSpecSync 回灌 → pending→done；server-local 直接 apply_sync 落盘。
  - 依赖：task-09（spec_version）+ **kind 字段存在**（来自 change-detail-file-tree-editor 或本变更兜底 migration）

- [x] task-14: frontend「同步到服务器」按钮 + 状态机轮询（D-012）
  - 就绪态加「同步到服务器」按钮；调 task-13 的 POST 端点；返 pending 后轮询 GET pending 直到 done/failed（对齐 change-detail-file-tree-editor 状态机：2s 间隔 + 5min 上限 + visibilitychange 暂停）。
  - 文件：`frontend/src/app/(dashboard)/workspaces/[id]/page.tsx`、`lib/spec-workspaces.ts`（或新 lib）
  - 验收：点同步→显示「同步中」→轮询→「已同步」/「失败」；页面不可见停止轮询。
  - 依赖：task-13

### Wave 4｜整合测试 + 文档同步

- [x] task-15: backend 集成测试（三端联调）
  - 覆盖：placement 用 member binding（task-01）、scan owner+count 门禁（task-02）、init dispatch + platform.json（task-06/07）、spec_version 递增（task-09）、spec-sync outbox kind 识别（task-13）。
  - 文件：`backend/app/modules/{agent,workspace,spec_workspace,daemon}/tests/`
  - 验收：所有新增/改动端点有测试；两分支（server-local/daemon-client）覆盖。
  - 依赖：task-01~14

- [x] task-16: daemon 测试
  - 覆盖：init lease 处理 + platform.json 写入（task-07）、版本检查保鲜（task-11）、pull 前回灌（task-12）、kind=spec-sync 处理（task-13）。
  - 文件：`sillyhub-daemon/tests/`
  - 验收：vitest 全绿。
  - 依赖：task-07/11/12/13

- [x] task-17: frontend 测试 + 模块文档同步
  - 覆盖：三态引导（task-08）、编辑入口（task-05）、switcher per-member（task-04）、同步按钮状态机（task-14）、扫描门禁弹窗（task-02/08）。jsdom 下 MarkdownText vi.mock（已知坑）。
  - 模块文档：scan 重生 module-card 时融入（init/sync 流程进注意事项），不另加变更索引。
  - 文件：`frontend/src/components/__tests__/`、`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/`
  - 验收：vitest 全绿；typecheck/lint 无新增。
  - 依赖：task-04/05/08/14

## 任务总表

| task | 优先级 | 依赖 | Wave | 覆盖决策 |
|---|---|---|---|---|
| task-01 | P0 | — | W1 | D-006 |
| task-02 | P0 | task-01 | W1 | D-006/D-003@V2/D-004 |
| task-03 | P1 | task-09 | W1 | D-010（init_synced 字段） |
| task-04 | P0 | — | W1 | D-011 |
| task-05 | P0 | task-03/04 | W1 | D-007 |
| task-06 | P0 | task-01/09 | W2 | D-002/D-009 |
| task-07 | P0 | task-06 | W2 | D-002/D-009 |
| task-08 | P0 | task-02/06/07 | W2 | D-002/D-005/D-003@V2 |
| task-09 | P0 | 协调 change-detail migration | W3 | D-010（schema） |
| task-10 | P1 | task-09 | W3 | D-010 |
| task-11 | P1 | task-10 | W3 | D-010 |
| task-12 | P1 | — | W3 | D-008 |
| task-13 | P0 | task-09 + kind 字段 | W3 | D-012 |
| task-14 | P1 | task-13 | W3 | D-012 |
| task-15 | P0 | task-01~14 | W4 | 全（集成测） |
| task-16 | P0 | task-07/11/12/13 | W4 | 全（daemon 测） |
| task-17 | P0 | task-04/05/08/14 | W4 | 全（frontend 测） |

## 关键路径

task-01 → task-02 → task-06 → task-08（owner 扫描 + 初始化主流程）；task-09 → task-13 → task-14（spec_version + 手动同步）；task-09 与 change-detail-file-tree-editor 的 migration 协调是 W3 关键风险点。

## FR ↔ task 覆盖矩阵

| FR | 覆盖 task |
|---|---|
| FR-001（per-member scan/dispatch 接线 D-006） | task-01, task-02 |
| FR-002（客户端路径 per-member 可编辑 D-007） | task-05 |
| FR-003（Switcher per-member D-011） | task-04 |
| FR-004（初始化按钮重定义 D-002/D-005/D-009） | task-06, task-07, task-08 |
| FR-005（.sillyspec-platform.json D-002） | task-07 |
| FR-006（扫描门禁 owner D-003@V2/D-004） | task-02, task-08 |
| FR-007（初始化只拉已有 D-005） | task-08 |
| FR-008（文档整包同步 D-001） | task-12（pull 前 push）, task-13（outbox 整树） |
| FR-009（缓存日常保鲜 D-010） | task-10, task-11 |
| FR-010（双向冲突保护 D-008） | task-12 |
| FR-011（数据模型变更 D-010） | task-09, task-03 |
| FR-012（默认零回归/兼容） | task-01（回退读全局列）, task-09（旧数据默认 0）, 全局验收 |
| FR-013（手动同步 outbox D-012） | task-13, task-14 |

## 全局验收标准

- 两成员各自绑定不同 daemon+路径，scan/agent 按 actor 路由（不读 workspace 全局列）。
- 已绑定成员能改 root_path/runtime_id（PUT /my-binding）；switcher 改 per-member runtime_id。
- 「初始化」→ init lease → daemon 写 `.sillyspec-platform.json` + pull 文档；init_synced_at 更新；服务器无文档提示先扫描。
- 非 owner 扫描 → 403；owner 已扫 → 409 + 确认重扫。
- A 重扫 spec_version 递增；B 自动 pull；本地有未回灌改动 pull 前先 push。
- 「同步到服务器」按钮 → outbox kind=spec-sync → daemon postSpecSync → pending→done。
- 默认零回归（无 force/未初始化行为不变）；旧 binding 回退读全局列。
- **兼容性（brownfield）**：SpecWorkspace.spec_version 缺失默认 0；Workspace 全局列保留只读；migration 可回滚；kind 字段缺失时 spec-sync 端点降级（或兜底加列）。

## 自检

- ✅ checkbox 格式（`- [x] task-XX:`）
- ✅ 验收标准具体可验证
- ✅ D-001~D-012 当前版本（D-003@V2）在任务总表覆盖矩阵可追踪
- ✅ 无 P0/P1 unresolved blocker
- ✅ 无 Mermaid 图（依赖线性清晰，关键路径文字标注）/ 无估时 / 无泛泛风险
- ✅ 无函数签名/代码示例（实现细节留 execute）
- ✅ plan.md 文件清单与 design.md §14 一致（17 文件）
- ✅ full 级：task 编号 + Wave checkbox + 总表（优先级/依赖）+ 关键路径 + 全局验收 + 覆盖矩阵 + 兼容条款
- ✅ 调用点搜索记录在上方（placement/scan/bootstrap/switcher/DaemonChangeWrite/SpecWorkspace）
- ✅ 交叉依赖（change-detail-file-tree-editor kind 字段 + migration）已显式标注 task-09/task-13
