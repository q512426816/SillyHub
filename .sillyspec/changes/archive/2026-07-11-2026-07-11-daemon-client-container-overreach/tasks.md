---
author: qinyi
created_at: 2026-07-11 23:30:36
change: 2026-07-11-daemon-client-container-overreach
---

# 任务清单（Tasks）— daemon-client 容器越界修复

> brainstorm 阶段的粗任务清单，按 Phase 分组。plan 阶段将细化为 Wave + 依赖关系 + 具体文件级步骤。每个 Task 对应 design.md 的 Phase / 文件变更清单。

## Phase 1 — 删 archive 死代码 + 补 status 投影

### task-01：删除 backend archive 模块
- 删 `backend/app/modules/archive/router.py` + `service.py` + `tests/`
- `backend/app/main.py` 注销 archive router import + include_router
- 验证：backend 无 archive import 错误，`/archive` `/distill` 端点 404
- 对应：FR-1.1 / AC-1

### task-02：补 archive stage status 投影 ★唯一新代码
- `backend/app/modules/change/service.py:1430-1478` `complete_stage("archive")` 收尾分支补：`change.status="archived"` / `location="archive"` / `archived_at=now(UTC)` / `path` 经 `_resolve_change_dir` 同步
- 或在 `dispatch.py:1801-1825 _sync_stage_status_daemon_client` 检测 sillyspec.db `current_stage="archived"` 时投影
- 新增单测：投影写入正确（断言 status/location/archived_at）
- 对应：FR-1.4 / AC-3 / R-01（P0）

### task-03：删除前端 archive 死代码
- 删 `frontend/src/lib/archive.ts`
- grep + 删页面残留 `handleArchive` / `archiving` state（定位 page.tsx）
- 验证：`pnpm build` + `pnpm test` 通过，grep 零残留
- 对应：FR-1.2 / AC-2

### task-04：清理孤立权限常量
- `backend/app/modules/auth/permissions.py` 若 `CHANGE_ARCHIVE` 删 archive 端点后孤立则移除
- grep 确认无其他引用
- 对应：FR-1.3

## Phase 2 — change_dir 删死路径

### task-05：requires_worktree 全改 False
- `backend/app/modules/change/dispatch.py:84/92/100/116` propose/plan/execute/archive `requires_worktree` 改 False
- 对齐 verify 的 D-004（`:108`）
- 对应：FR-2.1

### task-06：删除 _ensure_change_dir_in_worktree
- 删 `backend/app/modules/agent/service.py:1208-1250` 函数定义 + `:1059-1065` 调用点
- 确认 `work_dir`（:1038 resolve_work_dir 返回）独立保留，无死变量
- 确认 `resolve_work_dir` 的 `requires_worktree` 形参（死参数）不需额外处理（函数体不读）
- 对应：FR-2.2 / AC-4

### task-07：同步 requires_worktree 测试断言
- `backend/tests/modules/change/test_dispatch_stage_config.py:41-82`（6 处）改 False
- `backend/tests/modules/change/test_dispatch.py:48/71/101/463/816`（5 处）改 False
- 验证：两测试文件通过
- 对应：FR-2.3 / AC-5 / R-03

## Phase 3 — scanner/parser 扁平布局修复

### task-08：PostScanValidator 扁平修复
- `backend/app/modules/agent/post_scan_validator.py:156` `spec_root/".sillyspec"/"docs"` → `spec_root/"docs"`
- 确认 :170-227 rglob/glob 基于 :156 自动适配（G8 验证）
- 单测：扁平 fixture 跑 PostScanValidator 不报 expected_docs_missing
- 对应：FR-3.1 / AC-6

### task-09：WorkspaceScanner 扁平重写
- `backend/app/modules/workspace/scanner.py:78-130` scan() 语义翻转：`sillyspec = root`（不再 `root/.sillyspec`）
- `REQUIRED_TOP_LEVEL` / `OPTIONAL_TOP_LEVEL` 常量调整
- 核实所有 WorkspaceScanner 调用方（`/scan` + `rescan` 端点）传扁平根
- 对应：FR-3.2 / AC-7 / R-04

### task-10：WorkspaceParser 扁平修复
- `backend/app/modules/workspace/parser.py:108` `projects_subdir=".sillyspec/projects"` → `"projects"`
- 或经 SpecPathResolver platform_managed 适配
- 单测：扁平根下 projects/*.yaml 正确解析
- 对应：FR-3.3 / AC-7

### task-11：scanner 测试 fixture 扁平化
- `backend/tests/modules/workspace/test_scanner.py:21-160` 约 14 处 fixture + 断言改扁平布局
- 对应：FR-3.4 / AC-7 / R-04

## 横切任务

### task-12：全量回归验证
- backend 全量测试（`uv run pytest`）
- frontend 全量测试（`pnpm test` + `pnpm build`）
- 确认 delegate 9 方法 / stage dispatch / complete_lease 零回归
- 对应：NFR-1 / AC-8

## 依赖关系（粗略，plan 细化）

- task-02（status 投影）依赖 task-01（删 archive 端点，去掉旧 status 写入点）——建议 task-01 先
- task-07 依赖 task-05（先改 requires_worktree 再改测试断言）
- task-11 依赖 task-09/task-10（先改实现再改 fixture）
- Phase 1/2/3 之间相对独立，可并行（plan 阶段排 Wave）

## 范围外（独立后续变更）

- worktree lease 创建逻辑清理（`_try_acquire_lease` / `WorktreeService.acquire`，D-003）
- 其他 server-local 死代码清理（read_verify_result / diff_collector / git_gateway / tool_gateway / worktree 子系统）
