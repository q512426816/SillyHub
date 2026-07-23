---
author: qinyi
created_at: 2026-07-11 23:30:36
change: 2026-07-11-daemon-client-container-overreach
---

# 需求（Requirements）— daemon-client 容器越界修复

## 功能需求（FR）

### FR-1：删除 archive 死代码 + 补 status 投影

**FR-1.1** 删除 `archive_change` / `distill_knowledge` 两个 HTTP 端点及 `ArchiveService`（`backend/app/modules/archive/router.py` + `service.py` + tests），`main.py` 注销 router。
**FR-1.2** 删除前端死代码 `frontend/src/lib/archive.ts`（`archiveChange` / `distillChange`）+ 页面残留 `handleArchive` / `archiving` state。
**FR-1.3** 删除孤立的 `CHANGE_ARCHIVE` 权限常量（`auth/permissions.py`，若删除端点后孤立）。
**FR-1.4** 在 archive stage 完成时补 `change.status` 投影：`complete_stage("archive")` 收尾（或 `_sync_stage_status_daemon_client` 检测 sillyspec.db `current_stage="archived"`）时，写入 `change.status="archived"` / `location="archive"` / `archived_at=now` / `path` 更新。
**FR-1.5** 保留 `/archive-confirm` 端点（语义已是"记标志、agent 跑 CLI"，不变）。

### FR-2：change_dir 删死路径

**FR-2.1** `STAGE_AGENT_CONFIG` 的 propose/plan/execute/archive `requires_worktree` 改 `False`（`dispatch.py:84/92/100/116`），对齐 verify（`:108`）。
**FR-2.2** 删除 `_ensure_change_dir_in_worktree`（`agent/service.py:1208-1250`）+ 调用点（`:1059-1065`）。
**FR-2.3** 同步修改 requires_worktree 测试断言：`test_dispatch_stage_config.py:41-82`（6 处）+ `test_dispatch.py:48/71/101/463/816`（5 处）改 False。

### FR-3：scanner/parser 扁平布局修复

**FR-3.1** `PostScanValidator._check_output_paths`（`post_scan_validator.py:156`）：`spec_root/.sillyspec/docs` → 扁平根 `spec_root/docs`。
**FR-3.2** `WorkspaceScanner.scan`（`scanner.py:78-130`）：整个方法语义翻转（`sillyspec = root`，不再 `root/.sillyspec`），`REQUIRED_TOP_LEVEL`/`OPTIONAL_TOP_LEVEL` 常量同步调整。
**FR-3.3** `WorkspaceParser.__init__`（`parser.py:108`）：`projects_subdir=".sillyspec/projects"` → 扁平 `projects_subdir="projects"`。
**FR-3.4** 同步修改 `test_scanner.py` fixture 布局 + 断言扁平化（`:21-160` 约 14 处）。

## 非功能需求（NFR）

**NFR-1 零回归**：现有 complete_lease 收尾委托链路（apply_patch/post_scan_validation/stage_callback）、`HostFsDelegate` 9 个现有方法、stage dispatch 流转（brainstorm/plan/execute/verify）、所有保留的 router 与 DB 表结构行为不变。

**NFR-2 跨平台**：改动兼容 Windows / Linux / macOS（本变更无文件系统新增操作，仅删/改路径常量，风险低）。

**NFR-3 真实性**：所有改动基于真实代码核实（文件:行号见 design.md §6），不基于过时记忆。

## 验收标准（AC）

### AC-1（FR-1.1）archive 端点删除
- `POST /workspaces/{ws}/changes/{cid}/archive` 与 `/distill` 返回 404（router 注销）。
- `backend/app/modules/archive/` 目录删除或仅留空。
- `main.py` 不再 import / include archive router。
- backend 测试套件无 archive 相关 import 错误。

### AC-2（FR-1.2）前端死代码删除
- `frontend/src/lib/archive.ts` 删除。
- grep frontend 无 `archiveChange` / `distillChange` / `handleArchive` 残留引用。
- frontend 构建通过（`pnpm build`）。

### AC-3（FR-1.4）archive status 投影 ★关键
- e2e：change 走 verify → archive stage 完成（daemon agent 跑 sillyspec run archive）后，DB `change.status="archived"` / `location="archive"` / `archived_at` 非空。
- 单测：`complete_stage("archive")` 收尾断言 status/location/archived_at 写入。
- 前端"已归档"筛选（`changes/page.tsx`）正确显示已归档变更。

### AC-4（FR-2.1/2.2）change_dir 死路径删除
- grep `requires_worktree=True` 在 dispatch.py 仅余 verify 的历史定义（实际 propose/plan/execute/archive 全 False）。
- `_ensure_change_dir_in_worktree` 函数及调用点删除，grep 零命中。
- propose/plan/execute/archive stage dispatch 不再触发容器内 copytree。

### AC-5（FR-2.3）requires_worktree 测试同步
- `test_dispatch_stage_config.py` + `test_dispatch.py` 共 11 处断言改 False，测试通过。

### AC-6（FR-3.1）PostScanValidator 扁平
- 扁平根 spec_root 下存在 docs/ 时，scan 校验**不再**报 `expected_docs_missing`。
- 单测：扁平 fixture 跑 PostScanValidator 通过。

### AC-7（FR-3.2/3.3）Scanner/Parser 扁平
- 扁平根 rescan **不再**报 `WARN_NO_SILLYSPEC`。
- `WorkspaceParser` 扁平 projects_subdir 正确解析扁平根下 `projects/*.yaml`。
- `test_scanner.py` 扁平 fixture 通过。

### AC-8（NFR-1）零回归
- backend 全量测试通过（含 change dispatch / agent / workspace / daemon host_fs delegate 现有测试）。
- frontend 全量测试通过。
- delegate 9 个现有方法行为不变（host_fs delegate 测试零回归）。
- stage dispatch brainstorm/plan/execute/verify 流转不变。

## 验收方式

- AC-1/2/4/5/6/7：单测 + grep 断言（CI 可验）
- AC-3：单测（投影写入）+ e2e（归档全流程，需 daemon 环境）
- AC-8：全量测试套件零回归

## 遗留 e2e 验证（部署环境）

- AC-3 的 e2e（归档全流程：确认 → agent 移目录 → status 投影）需真实 daemon 部署验证（R-02）。
- archive stage 在 daemon-client 下端到端跑通验证。
