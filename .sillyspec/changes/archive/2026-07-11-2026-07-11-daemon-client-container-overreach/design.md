---
author: qinyi
created_at: 2026-07-11 23:30:36
change: 2026-07-11-daemon-client-container-overreach
revision: v3 (Design Grill 修正：archive 归属 sillyspec，delegate 写原语不需要)
---

# 设计文档（Design）— daemon-client 容器越界修复

## 1. 背景

multi-agent-platform 采用 daemon-client 架构：backend 跑在 Docker 容器内，项目源码与宿主文件在容器外（容器内只读够不到写）。宿主文件操作必须经 `HostFsDelegate` 委托 daemon 或操作容器内可达的平台托管目录（`spec_ws.spec_root`，bind mount）。

经 Design Grill 三轮核实，本变更聚焦的"容器越界"真问题最终收敛为**两类遗留代码**（与最初基于过时记忆的判断不同，见 decisions.md D-001@v2 / D-004@v2 的演进）：

### A. archive 模块整块死代码（归属错位）

`backend/app/modules/archive/`（`archive_change` + `distill_knowledge` 两端点）是 server-local 时代遗留：
- **前端零调用**：`frontend/src/lib/archive.ts` 定义了 `archiveChange` / `distillChange`，但全 frontend 无调用者。
- **daemon-client 下恒失效**：`archive/service.py:68` 用 `ws_root = Path(workspace.root_path)`（宿主源码路径，容器不可达），`change_dir.exists()`（`:73`）恒 False，`shutil.move` 永不执行——只改 DB status，文件没动。
- **与 stage dispatch 重叠**：归档的正确归属已落地——`STAGE_AGENT_CONFIG[ARCHIVE]`（`change/dispatch.py:112-119`），用户点"确认归档"走 `/archive-confirm`（`change/service.py:1576`，只记 `archive_confirmed` 标志），由 daemon agent 在 archive stage 跑 `sillyspec run archive --confirm` 在 spec_root 内移目录 + 更新 ROADMAP + 同步模块文档。

即 archive 的"正确做法"（sillyspec 工具做）**已经在代码里**，archive 模块是平行的冗余死代码。

### B. `_ensure_change_dir_in_worktree` 容器越界活路径

`backend/app/modules/agent/service.py:1208` 在 propose/plan/execute/archive 四个写阶段恒触发容器内 `shutil.copytree`（源用宿主路径 `workspace.root_path`、目标是容器路径，跨界）。worktree 本身也在 backend 容器内创建（`WorktreeService.acquire` 容器内 `git clone + worktree add`）——越界根源。execute stage 已在 D-004（`dispatch.py:108` verify）改 `requires_worktree=False`，propose/plan/execute/archive 未跟上（迁移不完整）。

### C. scanner/parser 扁平布局 bug（同源路径假设错误，非越界）

daemon-client 平台模式下 `spec_root` 是扁平根（直接 `docs/`、`changes/`、`.runtime/`，无 `.sillyspec` 包裹），但三处假设老包裹布局：
- `PostScanValidator._check_output_paths`（`agent/post_scan_validator.py:156`）：硬编码 `spec_root/.sillyspec/docs` → 恒报 docs missing。
- `WorkspaceScanner`（`workspace/scanner.py:78-130`）：假设 `root/.sillyspec/...` → rescan 恒报 WARN_NO_SILLYSPEC。
- `WorkspaceParser`（`workspace/parser.py:108`）：`projects_subdir=".sillyspec/projects"` 硬编码包裹。

> 注：记忆 `daemon-client-container-overreach-root-cause` 标称"complete_lease 收尾 3 处未修（apply_patch/post_scan_validation/stage_callback）"**已过时**——`2026-07-10-remove-server-local-workspace-mode` task-08/09 已让这三处全链路委托 delegate。`HostFsDelegate` 9 个现有方法（读 + git + gate）已覆盖 lease 收尾需求，本变更**不补 delegate 写原语**（D-001@v2，无写宿主源码场景）。

## 2. 设计目标

- **删除 archive 模块死代码**（backend 端点 + service + tests + 前端 lib + 权限常量），归档完全归属 sillyspec stage dispatch（已在用）。
- **补 archive stage 完成时的 status 投影**：删 archive_change 后无人写 `change.status="archived"`，需在 archive stage 收尾把 sillyspec.db 的 archived 态投影到 `change.status/location/archived_at/path`。
- **`_ensure_change_dir_in_worktree` 根治**：删除该路径，requires_worktree 全改 False，写阶段不再容器内预创建 change 目录。
- **scanner/parser 扁平布局修正**：PostScanValidator / WorkspaceScanner / WorkspaceParser 改用扁平根 / SpecPathResolver，scan 校验与 rescan 恢复正确判定。
- 零回归：现有 complete_lease 收尾委托链路、delegate 9 方法、stage dispatch 流转行为不变。

## 3. 非目标

- **不补 delegate 写原语**（mkdir/write_file/move）：archive 改为删死代码后，无任何写宿主源码路径的场景；delegate 现有 9 方法已够（D-001@v2 推翻 v1）。
- **不清理 server-local worktree 其他遗留死代码**（`read_verify_result` / `diff_collector` / `coordinator._run_sillyspec_background` / `git_gateway` / `tool_gateway` / `worktree` 子系统）：独立后续 cleanup。
- **不强删 worktree lease 创建逻辑**（`_try_acquire_lease` + `WorktreeService.acquire`）：requires_worktree 改 False 后该入口恒不达（成事实死代码），本变更保留不强删（D-003）。
- 不改 DB schema（无 Alembic 迁移）。
- 不改 delegate 协议 / daemon host-fs-handler（无新 RPC）。
- 不改 session/lease/agent_run 生命周期状态机。

## 4. 拆分判断

单变更足够，4 个工作块同源（daemon-client 遗留/路径假设），非批量模式，体量小（backend 删 ~170 行 + 补 ~15 行投影 + 改 4 处 requires_worktree + 删 1 段函数 + 3 处扁平修复 + 前端删死代码）。

## 5. 总体方案

### Phase 1 — 删除 archive 死代码 + 补 status 投影

**删**：
- `backend/app/modules/archive/router.py` + `archive/service.py` + `archive/tests/`（archive_change / distill_knowledge 两端点 + ArchiveService）
- `main.py` 注销 archive router
- `frontend/src/lib/archive.ts`（archiveChange / distillChange 死代码）+ 页面里残留的 `handleArchive` / `archiving` state（如有）
- `auth/permissions.py` 的 `CHANGE_ARCHIVE` 权限常量（若孤立）

**补（唯一新代码）**：archive stage 完成时 `change.status` 投影。当前 `complete_stage("archive")`（`change/service.py:1430-1478`）只改 `current_stage` 不改 `change.status`。在 archive 收尾分支（或 `_sync_stage_status_daemon_client` `dispatch.py:1801-1825` 检测 sillyspec.db `current_stage="archived"` 时）补：`change.status="archived"` / `location="archive"` / `archived_at=now` / `path` 更新为 archive 相对路径。复用现有 `_resolve_change_dir`（已 spec_root 优先）读新位置。

**保留不动**：`/archive-confirm` 端点（`change/service.py:1576`）——其语义已是"只记确认、由 agent 跑 CLI"，与重构方向一致。

### Phase 2 — change_dir 删死路径

1. `requires_worktree` 全改 `False`（`dispatch.py:84/92/100/116` 的 propose/plan/execute/archive），对齐 verify 的 D-004（`:108`）。
2. 删除 `_ensure_change_dir_in_worktree`（`agent/service.py:1208-1250`）+ 调用点（`:1059-1065`）。
3. `resolve_work_dir` 的 `requires_worktree` 形参是死参数（函数体 `:289-317` 不读），改 False 零行为影响（Grill G4 确认）。
4. agent 写阶段 change 目录由 daemon 侧 sillyspec 执行时自然创建（sillyspec brainstorm/plan/execute/archive 各 stage 自建），backend 不再预创建。

### Phase 3 — scanner/parser 扁平布局修复

- `PostScanValidator._check_output_paths`（`post_scan_validator.py:156`）：`spec_root/.sillyspec/docs` → 扁平根 `spec_root/docs`（参照 `spec_paths.py:114 _spec_root()`）。:170-227 的 rglob/glob 基于 :156 的 `expected_docs`，改 :156 即全修（Grill G8 确认）。
- `WorkspaceScanner.scan`（`scanner.py:78-130`）：整个方法语义从"找 `.sillyspec` 子目录"翻转为"root 直接当内容根"——`sillyspec = root`（不再 `root/.sillyspec`），`REQUIRED_TOP_LEVEL`/`OPTIONAL_TOP_LEVEL` 常量同步调整。
- `WorkspaceParser.__init__`（`parser.py:108`）：`projects_subdir=".sillyspec/projects"` → 扁平 `projects_subdir="projects"`（或经 SpecPathResolver 适配 platform_managed）。
- 扁平为唯一布局（server-local 已删），无回退需要。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 删除 | `backend/app/modules/archive/router.py` | archive_change / distill_knowledge 死端点 |
| 删除 | `backend/app/modules/archive/service.py` | ArchiveService（容器越界实现） |
| 删除 | `backend/app/modules/archive/tests/` | 对应测试 |
| 修改 | `backend/app/main.py` | 注销 archive router import + include |
| 修改 | `backend/app/modules/change/service.py` | `complete_stage("archive")` 收尾补 `change.status/location/archived_at/path` 投影（`:1430-1478`）；保留 `/archive-confirm`（`:1576`） |
| 修改 | `backend/app/modules/change/dispatch.py` | propose/plan/execute/archive `requires_worktree` 改 False（`:84/92/100/116`） |
| 删除 | `backend/app/modules/agent/service.py` | 删 `_ensure_change_dir_in_worktree`（`:1208-1250`）+ 调用点（`:1059-1065`） |
| 修改 | `backend/app/modules/agent/post_scan_validator.py` | `:156` 硬编码 `.sillyspec/docs` → 扁平根 |
| 修改 | `backend/app/modules/workspace/scanner.py` | `:78-130` scan() 语义翻转 + 顶层常量调整 |
| 修改 | `backend/app/modules/workspace/parser.py` | `:108` `projects_subdir` 默认值改扁平 |
| 删除 | `frontend/src/lib/archive.ts` | archiveChange / distillChange 死代码 |
| 修改 | `frontend/src/...page.tsx` | 移除残留 handleArchive / archiving state（grep 定位） |
| 修改 | `backend/app/modules/auth/permissions.py` | 移除孤立 `CHANGE_ARCHIVE` 常量（若孤立） |
| 修改测试 | `backend/tests/modules/change/test_dispatch_stage_config.py` | `:41-82` 6 处 `requires_worktree is True` 断言改 False |
| 修改测试 | `backend/tests/modules/change/test_dispatch.py` | `:48/71/101/463/816` 5 处 requires_worktree 断言改 False |
| 修改测试 | `backend/tests/modules/workspace/test_scanner.py` | fixture 布局 + 断言扁平化（`:21-160` 约 14 处） |
| 新增测试 | `backend/tests/modules/change/` | archive stage status 投影单测（archived 态写入） |

## 7. 接口定义

**无新接口**（删除为主）。

删除的公开接口：
- `POST /workspaces/{ws}/changes/{cid}/archive`（archive_change）
- `POST /workspaces/{ws}/changes/{cid}/distill`（distill_knowledge）
- `ArchiveService.archive_change` / `distill_knowledge`

保留接口（语义不变）：
- `POST /workspaces/{ws}/changes/{cid}/archive-confirm`（只记标志，daemon agent 跑 CLI）
- `HostFsDelegate` 9 个现有方法（不改）
- 所有 stage dispatch 接口

新增内部逻辑（非公开接口）：
```python
# change/service.py complete_stage("archive") 收尾分支补投影
# 检测 sillyspec.db current_stage="archived" 时：
change.status = "archived"
change.location = "archive"
change.archived_at = datetime.now(UTC)
# change.path 由 sillyspec archive 移动后的新相对路径，经 _resolve_change_dir 读 sillyspec.db 同步
```

## 7.5 生命周期契约表

> **声明**：本变更**不改变** session/lease/agent_run 生命周期状态流转。archive 归属现有 stage dispatch 的 archive stage（已是 `STAGE_AGENT_CONFIG` 一员），本变更只删平行死代码 + 补 status 投影。下表列出涉及的已有事件：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 | 本变更影响 |
|---|---|---|---|---|---|
| archive stage dispatch | backend | daemon | agentRunId, changeId, specRoot | pending → running | 不变（已在用） |
| archive stage 完成（sillyspec run archive）| daemon | backend | runId, status, sillyspec.db current_stage=archived | running → completed | **补 status 投影**：complete_stage("archive") 收尾把 sillyspec.db archived 态投影到 change.status/location/archived_at |
| archive-confirm | frontend | backend | changeId, archive_confirmed=True | 无（记标志） | 不变（保留） |

必需字段（`agentRunId`/`changeId`/`specRoot`）为现有字段，本变更不改。

## 8. 数据模型

无 DB schema 改动。`Change.status` / `location` / `archived_at` / `path` 字段已存在（`change/model.py:127/210`），只是写入点从 `archive_change` 端点迁移到 `complete_stage("archive")` 投影。无 Alembic 迁移。

## 9. 兼容策略（brownfield）

- **archive 端点删除的兼容**：前端零调用（已核实），删除无外部行为影响。归档走 `/archive-confirm` + stage dispatch（已在用，不变）。
- **status 投影缺口（R-01）**：删 archive_change 后 `change.status="archived"` 唯一写入点消失，必须在 archive stage 收尾补投影，否则前端"已归档"筛选（`changes/page.tsx:42,111`）失真。这是本变更唯一关键新代码。
- **requires_worktree 改 False（R-03）**：Grill G3 已 grep 全量下游——`resolve_work_dir` 形参不读此参（死参数），无功能性依赖；仅 11 处测试断言需同步改（test_dispatch_stage_config.py 6 + test_dispatch.py 5）。
- **worktree lease 创建逻辑保留**：requires_worktree 改 False 后 `_try_acquire_lease`（`agent/service.py:1252`）入口恒不达，成事实死代码（保留不强删，D-003）。
- **scanner/parser 扁平**：server-local 已删，扁平为唯一布局，无回退需要。
- 不改变的接口/表：delegate 9 方法、所有保留 router、所有 DB 表结构。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 删 archive_change 后 change.status="archived" 无写入点 | P0 | archive stage 收尾补 status 投影（Phase 1 唯一新代码）+ 单测覆盖；前端"已归档"筛选回归验证 |
| R-02 | daemon-client 下 archive stage 端到端未验证跑通 | P1 | sillyspec archive 命令成熟（5 步 + --confirm 硬校验）；e2e 验证归档全流程（确认→agent 移目录→status 投影） |
| R-03 | requires_worktree 改 False 的 11 处测试断言债 | P2 | 同步改 test_dispatch_stage_config.py + test_dispatch.py；Grill G3 已确认无功能下游依赖 |
| R-04 | scanner/parser 扁平修复爆炸半径（scan() 整体重写 + parser + 14 处 test fixture） | P2 | 核实 WorkspaceScanner 所有调用方（`/scan` + `rescan`）；扁平 fixture 重写 |
| R-05 | worktree lease 创建（`_try_acquire_lease`/`WorktreeService.acquire`）遗留越界未清 | P2 | 本变更范围外（D-003），requires_worktree 改 False 后入口恒不达成事实死代码，独立后续评估 |
| R-06 | distill_knowledge 端点可能有非前端外部依赖 | P2 | grep 已确认前端零调用；删除前再搜 e2e 测试 / 外部脚本确认 |

## 11. 决策追踪

当前版本决策（详见 `decisions.md`）：
- **D-001@v2**（supersedes v1）— delegate 写原语**不需要**（archive 改删死代码后无写宿主源码场景）→ 覆盖 §3 非目标
- **D-002@v1** — change_dir 删死路径 + requires_worktree 全改 False → 覆盖 §5 Phase 2
- **D-003@v1** — worktree lease 创建逻辑不强删 → 覆盖 §3 非目标、§9、R-05
- **D-004@v2**（supersedes v1）— archive **删死代码归属 sillyspec** + 补 status 投影（非委托、非修路径模型）→ 覆盖 §5 Phase 1
- **D-005@v1**（补充）— scanner/parser 扁平修复（PostScanValidator:156 + WorkspaceScanner + WorkspaceParser）→ 覆盖 §5 Phase 3
- **D-006@v1** — archive 归属 sillyspec stage dispatch（删 backend 端点）→ 覆盖 §1.A、§5 Phase 1
- **D-007@v1** — archive stage status 投影缺口补齐 → 覆盖 §5 Phase 1、R-01

无未解决决策（Grill P0-1/P0-2/P0-3 随方案重构全部消解：delegate 注入不需要、archive 容错叙事重写为 stage dispatch、allowed_roots 不涉及）。

## 12. 自审

| 检查项 | 结果 |
|---|---|
| 需求覆盖 | ✅ 3 Phase（删 archive 死代码+投影 / change_dir 删路径 / scanner+parser 扁平）覆盖用户拍板的活路径修复，archive 经 Design Grill 演进为更正确的"删死代码归属 sillyspec" |
| Grill 覆盖 | ✅ D-001@v2~D-007@v1 全部在 §5/§6/§9 引用；Grill 发现的 P0-1/P0-2/P0-3 在 §11 记录消解 |
| 约束一致性 | ✅ 复用现有 stage dispatch / `_resolve_change_dir`（spec_root 优先）/ SpecPathResolver 平台托管模式；与 ARCHITECTURE.md daemon-client 一致 |
| 真实性 | ✅ 所有文件路径/行号/方法名来自真实代码核实（Design Grill agent + 直接读码 + sillyspec CLI 验证） |
| YAGNI | ✅ 不补 delegate 写原语（无需求）、不强删 worktree 模块（范围外）、不清理其他死代码（独立后续） |
| 验收标准 | ✅ 核心 AC：archive 端点删除后归档走 stage dispatch 跑通 + status 投影正确、change_dir 路径删除、scanner/parser 扁平后 scan 校验恢复 |
| 非目标清晰 | ✅ §3 明确 6 项非目标 |
| 兼容策略 | ✅ §9 archive 端点删除（前端零调用）/ status 投影缺口（R-01）/ requires_worktree 测试债 / worktree 入口死代码 / 扁平唯一布局 |
| 风险识别 | ✅ §10 R-01~R-06 |
| 生命周期契约表 | ✅ §7.5（本变更不改状态机，archive 归属现有 stage dispatch，仅补 status 投影） |

自审通过（Design Grill 修正后）。
