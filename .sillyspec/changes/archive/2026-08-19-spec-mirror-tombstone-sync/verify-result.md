---
author: qinyi
created_at: 2026-08-19T23:15:00
---

# 验证报告（Verify Result）— 2026-08-19-spec-mirror-tombstone-sync

## 验证结论

**PASS**

四条验收标准（design §9）全部满足，依据如下。

## 验收标准逐条核对

| # | 验收标准 | 结果 | 证据 |
|---|---------|------|------|
| 1 | 造镜像幽灵目录 + 跑 import → 幽灵目录消失、备份区有残留副本 | ✅ | `test_full_sync_convergence.py::test_ghost_files_moved_to_backup_and_dirs_pruned_and_tombstoned`：3 幽灵文件全 move 备份区、`changes/`+`orphan-dir/` 空目录清理（converged_dirs=3）、changes 行删除由既有 reparse 链路覆盖（`test_full_sync_convergence` 直接验证 FS/manifest 层；reparse 删除环既有 `test_reparse_guard.py` 用例守卫） |
| 2 | manifest 无全表 wipe，被删文件行 exists=False | ✅ | 同上用例：`docs/A.md` 落盘行 version=1 新插、幽灵行 exists=False + version 3→4（行保留非删除）；`test_sync_incremental.py::test_old_tar_tombstones_manifest_and_next_incremental_rebuilds`：行集合 {docs/A.md 墓碑, docs/T.md v1}，`git diff` 中原 `delete(SpecFileManifest)` 块已移除 |
| 3 | 占位行 >7 天不再保护 | ✅ | `test_reparse_guard.py::test_placeholder_unprotected_after_7_days`（8 天 → deleted=1）；窗内对照 `test_placeholder_protected_within_7_days`（6 天 → deleted=0） |
| 4 | 既有测试全绿 + 新增用例全绿 | ✅ | 见下节测试结论（468 passed / 3 skipped；2 个断言旧语义的既有测试按 design FR-01/FR-02 更新为对账/墓碑语义——属设计明定的行为替换，非「为通过改测试」） |

## 单元测试结论

- 套件与命令：`cd backend && .venv/Scripts/python.exe -m pytest app/modules/spec_workspace app/modules/change -q`
- 结果：**468 passed, 3 skipped**（新增 7 用例：test_full_sync_convergence.py ×5 + test_reparse_guard.py ×2，首跑全绿）
- 26 个 ERROR 为**主仓库基线既有旧债**（`test_router.py`/`test_sync_documents_traversal.py` 的 fixture 经 API 建 workspace 缺 `type` 必填字段，2026-08-19-workspace-role-type 引入），已在 main 仓库原样复现实证（`test_no_auth_returns_401` 同样 422 报错），与本变更无关，不阻断本变更验收
- ruff：`ruff check` All checks passed；`ruff format --check` 60 files already formatted
- gen:types：不适用——无 API 契约变化（SSE 事件是流文本非 OpenAPI schema，加法字段前端不消费不破坏），`backend/openapi.json` 无需再生成

## Runtime Evidence（runtime evidence 章节与日志片段）

本变更不动 daemon 契约（design Non-Goals：daemon tar 打包方零改动）；集成面为「daemon tar → backend 全量同步落盘 → reparse」的**平台侧落点**，以下端到端（integration test 级）用例真实走完链路（真实 FastAPI app + 真实临时 spec_root FS 落盘 + 真实 DB，仅 mock 外部 reparse 解析器返回值）：

- `test_bundle_sync.py::test_sync_overwrites_and_reparses`：HTTP `POST /api/workspaces/{ws}/spec-workspace/sync`（application/x-tar）→ 镜像 A.md 对账删除进备份区、B.md 落盘、响应 200 `{"ok":true,...}`
- `test_sync_incremental.py::test_old_tar_tombstones_manifest_and_next_incremental_rebuilds`：增量 add 建行 → 全量 tar 覆盖 → 墓碑 → 下一次增量 R-07 重建 version=1（全量/增量协议交叉验证）

代码路径结构化日志（新增，生产可审计）：

```json
{"event": "spec_workspace.converged", "workspace_id": "...", "converged_files": 3, "converged_dirs": 3}
{"event": "spec_workspace.converge_skipped_empty_landing", "spec_root": "..."}   # 护栏①
{"event": "spec_workspace.converge_aborted_ratio", "disk_files": 402, "landed_files": 1}  # 护栏②
```

pytest 输出片段（worktree 实跑）：

```text
app/modules/spec_workspace/tests/test_full_sync_convergence.py app/modules/change/tests/test_reparse_guard.py
18 passed, 1 warning in 3.68s
============================= 468 passed, 3 skipped, 27 warnings, 26 errors in 96.01s
```

## 设计偏差与遗留

- 偏差①（已标注，plan 阶段确定）：task-02 manifest 对齐位置沿用原全表 wipe 点（最终 commit 后独立短事务），与 design §4.1 字面时序（commit 前）不同，功能等价（对账删除仍在 reparse 前，墓碑与落盘同一 `_write_spec_root` 调用内完成）。
- 偏差②（实现细化）：`_write_spec_root` 返回值由 `SpecWorkspace` 扩展为 `(SpecWorkspace, converged_files, converged_dirs)` 三元组——task-03 透传所需的实现载体，三个调用点同批适配，无对外 API 变化。
- 遗留（非本变更范围）：26 个基线 ERROR 旧债建议后续 quick 修（fixture 补 `type` 字段）。

## 模块文档同步状态

见 module-impact.md「更新结果」表：backend 模块卡待 archive 阶段同步后回填 done。
