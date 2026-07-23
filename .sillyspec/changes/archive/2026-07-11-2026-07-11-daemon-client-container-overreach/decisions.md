---
author: qinyi
created_at: 2026-07-11 23:30:36
change: 2026-07-11-daemon-client-container-overreach
---

# 决策台账（Decisions）— daemon-client 容器越界修复

本文件记录本次变更有实现/验收影响的决策。含稳定版本 ID（`D-xxx@vN`），Design Grill 修正时新版本 `supersedes` 旧版本（旧版本保留为历史，`status: superseded`）。当前生效版本：D-001@v2、D-002@v1、D-003@v1、D-004@v2、D-005@v1、D-006@v1、D-007@v1。

---

## D-001@v1 — delegate 写原语形态 = 结构化原语 ❌ superseded

- **type**: architecture
- **status**: superseded（被 D-001@v2 推翻）
- **superseded_by**: D-001@v2
- **source**: brainstorm Step 8（基于"archive 必须写宿主源码路径"假设，该假设后被 Design Grill 证伪）
- **question**: delegate 写原语用什么形态补？
- **answer**（已废）: 补 mkdir/write_file/move 3 个结构化原语
- **为何推翻**: Design Grill 发现 archive 应删死代码归属 sillyspec（D-004@v2），无写宿主源码场景，delegate 写原语整个不需要
- **priority**: P0（历史）

---

## D-001@v2 — delegate 写原语不需要 ✅ current

- **type**: architecture
- **status**: accepted
- **supersedes**: D-001@v1
- **source**: design-grill（Step 12，agent 核实 archive 归属 + 用户洞察"应该是 sillyspec 做的"）
- **question**: 是否需要为 archive/change_dir 补 delegate 写原语？
- **answer**: **不需要**。archive 改为删死代码归属 sillyspec stage dispatch（D-004@v2/D-006@v1），change_dir 改为删死路径（D-002@v1），两者都不再写宿主源码路径。`HostFsDelegate` 现有 9 方法（读 + git apply + gate）已覆盖所有剩余场景（lease 收尾在 2026-07-10-remove-server-local task-08/09 已全链路委托）。
- **normalized_requirement**: 非目标界定（不补 delegate 写原语）
- **impacts**: design §3 非目标 / 不涉及 daemon host-fs-handler / 不涉及 allowed_roots
- **evidence**:
  - Design Grill agent：archive_change/distill_knowledge 是死代码（前端零调用 + daemon-client 下 move 恒跳过 + 与 stage dispatch archive stage 重叠）。
  - change_dir 删死路径后无容器写操作。
  - 本变更后 backend 对宿主源码路径零写需求。
- **priority**: P0

---

## D-002@v1 — change_dir 删死路径 + requires_worktree 全改 False ✅ current

- **type**: architecture
- **status**: accepted
- **source**: brainstorm Step 8（用户三选一确认）+ Design Grill G4 验证完整性
- **question**: `_ensure_change_dir_in_worktree`（`agent/service.py:1208`）在 daemon-client 下是越界活路径，如何处理？
- **answer**: 删死路径治本：(1) `requires_worktree` 全改 `False`（`dispatch.py:84/92/100/116` propose/plan/execute/archive，对齐 verify 的 D-004 `:108`）；(2) 删 `_ensure_change_dir_in_worktree`（`:1208-1250`）+ 调用点（`:1059-1065`）；(3) change 目录由 daemon 侧 sillyspec 自然创建。
- **normalized_requirement**: FR-2（change_dir 容器越界根治）
- **impacts**: `dispatch.py`（4 处 requires_worktree）/ `agent/service.py`（删函数）/ design §5 Phase 2
- **evidence**:
  - Grill G3：`resolve_work_dir` 的 `requires_worktree` 形参是死参数（函数体 :289-317 不读），改 False 零行为影响。
  - Grill G4：删 :1059-1065 + :1208-1250 无死变量残留，`work_dir`（:1038）独立保留。
  - worktree 在容器内创建（`WorktreeService.acquire` 容器内 clone+worktree_add）是越界根源，删路径治本。
- **priority**: P0

---

## D-003@v1 — worktree lease 创建逻辑不强删 ✅ current

- **type**: scope
- **status**: accepted
- **source**: 用户范围拍板（Step 6）+ Step 8 方案 C 排除
- **question**: worktree lease 创建逻辑（`_try_acquire_lease` + `WorktreeService.acquire`）是否一并清？
- **answer**: 不强删。requires_worktree 改 False 后该入口恒不达（成事实死代码），保留不强删，独立后续评估 worktree 模块整体去留。
- **normalized_requirement**: 范围界定（非目标）
- **impacts**: design §3 非目标 / §9 兼容策略 / R-05
- **evidence**: 彻底删范围溢出（接近死代码清理 5-7），worktree 模块多处引用需独立评估
- **priority**: P1

---

## D-004@v1 — archive 委托映射 + move 独立原语 ❌ superseded

- **type**: implementation
- **status**: superseded（被 D-004@v2 推翻）
- **superseded_by**: D-004@v2
- **source**: brainstorm Step 8（基于"archive 写 workspace.root_path"假设）
- **question**: archive 两端点如何映射到 delegate 原语？
- **answer**（已废）: archive_change→delegate.mkdir+move；distill→read_file+mkdir+write_file
- **为何推翻**: Design Grill G2 发现 archive 是独立 HTTP 端点不在 complete_lease 链路；进一步核实（D-006@v1）发现 archive 是死代码，正确归属是 sillyspec stage dispatch，应删除而非委托
- **priority**: P0（历史）

---

## D-004@v2 — archive 删死代码归属 sillyspec + 补 status 投影 ✅ current

- **type**: architecture
- **status**: accepted
- **supersedes**: D-004@v1
- **source**: design-grill（Step 12，用户洞察 + agent 核实 archive 归属）
- **question**: archive 模块如何处理？
- **answer**:
  - **删除** `archive/router.py` + `archive/service.py` + `archive/tests/` + `frontend/src/lib/archive.ts` + 孤立权限常量。
  - **补 status 投影**：archive stage 完成时（`complete_stage("archive")` 收尾）把 sillyspec.db 的 `current_stage="archived"` 态投影到 `change.status="archived"` / `location="archive"` / `archived_at` / `path`（D-007@v1）。
  - 归档完全归属现有 stage dispatch 的 archive stage（`STAGE_AGENT_CONFIG[ARCHIVE]`，daemon agent 跑 `sillyspec run archive --confirm`）。
- **normalized_requirement**: FR-1（archive 容器越界根治，方式=删死代码归属 sillyspec）
- **impacts**: `archive/` 整模块删 / `change/service.py:1430-1478` 补投影 / `frontend/src/lib/archive.ts` 删 / design §5 Phase 1 / §6 文件清单
- **evidence**:
  - Grill agent：`frontend/src/lib/archive.ts:24,35` 定义 archiveChange/distillChange，**全 frontend 零调用者**。
  - `archive/service.py:73 if change_dir.exists():` 恒 False（ws_root=workspace.root_path 容器不可达），shutil.move 永不执行。
  - archive 已是 `STAGE_AGENT_CONFIG[ARCHIVE]`（`dispatch.py:112-119`），`STAGE_ORDER` 含 archive（:36-42），verify→archive 合法流转（model.py:87）。
  - `/archive-confirm`（`change/service.py:1576`）已是"只记标志、agent 跑 CLI"，与重构方向一致，保留。
  - sillyspec `run archive` 是完整 5 步（module-impact + sync-module-docs + --confirm 移目录 + ROADMAP），在 spec_root 内由 daemon agent 执行。
- **priority**: P0

---

## D-005@v1 — scanner/parser 扁平布局修复 ✅ current（补充 parser）

- **type**: implementation
- **status**: accepted
- **source**: 用户 Step 6 拍板 + Design Grill G6/G8 补充爆炸半径
- **question**: PostScanValidator / WorkspaceScanner / WorkspaceParser 硬编码 `.sillyspec` 包裹布局如何修？
- **answer**:
  - `PostScanValidator._check_output_paths`（`post_scan_validator.py:156`）：`spec_root/.sillyspec/docs` → 扁平根 `spec_root/docs`（:170-227 rglob/glob 基于 :156，改 :156 即全修，G8 确认）。
  - `WorkspaceScanner.scan`（`scanner.py:78-130`）：整个方法语义翻转——`sillyspec = root`（不再 `root/.sillyspec`），`REQUIRED_TOP_LEVEL`/`OPTIONAL_TOP_LEVEL` 常量同步（G6 确认非局部改）。
  - `WorkspaceParser.__init__`（`parser.py:108`）：`projects_subdir=".sillyspec/projects"` → 扁平 `projects_subdir="projects"`（G6 新增，原 design 漏）。
- **normalized_requirement**: FR-3（scanner/parser 扁平修复）
- **impacts**: `post_scan_validator.py` / `scanner.py` / `parser.py` / `test_scanner.py`（fixture 扁平化）/ design §5 Phase 3
- **evidence**:
  - Grill G6：scanner 整个 scan() 是包裹语义，非 :78-130 局部；`:124 WorkspaceParser().parse(root)` 传同一包裹根，parser.py `:108 projects_subdir=".sillyspec/projects"` 硬编码包裹。
  - Grill G8：PostScanValidator 改 :156 前缀即够（:170-227 依赖 :156）。
  - 扁平为唯一布局（server-local 已删），无回退需要。
- **priority**: P1

---

## D-006@v1 — archive 归属 sillyspec stage dispatch ✅ current

- **type**: architecture
- **status**: accepted
- **source**: design-grill（用户洞察"应该是 sillyspec 工具做" + agent 核实）
- **question**: archive 的文件操作（move change 到 archive、生成 knowledge）归属 backend 还是 sillyspec 工具？
- **answer**: **归属 sillyspec 工具**（经 daemon agent 跑 `sillyspec run archive`）。归档的正确归属已在代码落地——`STAGE_AGENT_CONFIG[ARCHIVE]`（`dispatch.py:112-119`），用户点"确认归档"→`/archive-confirm`→daemon agent 在 archive stage 跑 `sillyspec run archive --confirm`。backend 的 archive_change/distill_knowledge 端点是平行冗余死代码，删除（D-004@v2）。
- **normalized_requirement**: FR-1 架构方向（archive 归属）
- **impacts**: design §1.A 背景 / §5 Phase 1 / 与项目"stage dispatch 触发 sillyspec"整体架构一致
- **evidence**:
  - sillyspec `run archive` 5 步：任务完成度检查 + extract-module-impact + sync-module-docs（用户 --continue）+ --confirm 移目录 + ROADMAP。
  - stage dispatch 已是项目标准模式（brainstorm/plan/execute/verify/archive 都经 daemon agent 跑 sillyspec）。
  - backend archive_change 端点自己在容器内搬文件是 server-local 遗留，与架构不一致。
- **priority**: P0

---

## D-007@v1 — archive stage status 投影缺口补齐 ✅ current

- **type**: implementation
- **status**: accepted
- **source**: design-grill（agent 识别 status 投影缺口为重构唯一关键新代码）
- **question**: 删 archive_change 端点后 `change.status="archived"` 谁来写？
- **answer**: 在 archive stage 收尾补 status 投影。当前 `complete_stage("archive")`（`change/service.py:1430-1478`）只改 `current_stage` 不改 `change.status`。补：检测 sillyspec.db `current_stage="archived"` 时，投影到 `change.status="archived"` / `location="archive"` / `archived_at=now` / `path`（经 `_resolve_change_dir` 读 sillyspec.db 同步新位置）。
- **normalized_requirement**: FR-1.1（status 投影，零回归前端"已归档"筛选）
- **impacts**: `change/service.py:1430-1478` 或 `dispatch.py:1801-1825 _sync_stage_status_daemon_client` / 新增单测 / R-01
- **evidence**:
  - agent：现有 stage dispatch 完全不改 `change.status`，删 archive_change 后无路径写 status="archived"。
  - 前端 changes/page.tsx:42,111 依赖 status 做"已归档"筛选，投影缺口会致筛选失真。
  - `complete_stage("archive")` 返回 `("archived", None)`（service.py:1424-1425），是投影的自然挂载点。
- **priority**: P0
