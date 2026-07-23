---
plan_level: full
author: qinyi
created_at: 2026-07-12 00:37:08
change: 2026-07-11-daemon-client-container-overreach
---

# 实现计划（Plan）— daemon-client 容器越界修复

## Spike 前置验证

无 Spike。技术方案经 Design Grill 三轮核实已确定（archive 死代码归属 sillyspec / change_dir 越界根治 / scanner/parser 扁平），所有文件:行号已对照真实代码验证，无技术不确定性。

## Wave 1（并行，无相互依赖）

- [ ] task-01: 删除 backend archive 模块（router.py + service.py + tests/ + main.py 注销）（覆盖：FR-1.1, D-004@v2, D-006@v1）
- [ ] task-02: 删除前端 archive 死代码（lib/archive.ts + 页面 handleArchive/archiving 残留）（覆盖：FR-1.2）
- [ ] task-03: change_dir 删死路径（dispatch.py propose/plan/execute/archive requires_worktree 改 False + 删 _ensure_change_dir_in_worktree 及调用点）（覆盖：FR-2.1, FR-2.2, D-002@v1）
- [ ] task-04: PostScanValidator 扁平修复（post_scan_validator.py:156 去 .sillyspec 前缀）（覆盖：FR-3.1, D-005@v1）
- [ ] task-05: WorkspaceScanner 扁平重写（scanner.py:78-130 scan() 语义翻转 + 顶层常量）（覆盖：FR-3.2, D-005@v1）
- [ ] task-06: WorkspaceParser 扁平修复（parser.py:108 projects_subdir 改扁平）（覆盖：FR-3.3, D-005@v1）

## Wave 2（依赖 Wave 1 对应任务）

- [ ] task-07: 补 archive stage status 投影（complete_stage("archive") 收尾写 change.status/location/archived_at/path）（覆盖：FR-1.4, D-004@v2, D-007@v1）— 依赖 task-01
- [ ] task-08: 删除孤立 CHANGE_ARCHIVE 权限常量（auth/permissions.py，确认无引用后）（覆盖：FR-1.3）— 依赖 task-01
- [ ] task-09: 同步 requires_worktree 测试断言（test_dispatch_stage_config.py 6 处 + test_dispatch.py 5 处改 False）（覆盖：FR-2.3）— 依赖 task-03
- [ ] task-10: scanner 测试 fixture 扁平化（test_scanner.py 约 14 处 fixture + 断言）（覆盖：FR-3.4）— 依赖 task-05, task-06

## Wave 3（回归，依赖 Wave 1+2）

- [ ] task-11: 全量回归验证（backend pytest + frontend pnpm test/build，确认 delegate 9 方法/stage dispatch/complete_lease 零回归）（覆盖：NFR-1, AC-8）— 依赖 task-01..task-10

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 删 backend archive 模块 | W1 | P0 | — | FR-1.1, D-004@v2, D-006@v1 | router+service+tests 删，main.py 注销 |
| task-02 | 删前端 archive 死代码 | W1 | P0 | — | FR-1.2 | lib/archive.ts + page 残留 |
| task-03 | change_dir 删死路径 | W1 | P0 | — | FR-2.1, FR-2.2, D-002@v1 | requires_worktree 4 处 False + 删函数+调用点 |
| task-04 | PostScanValidator 扁平 | W1 | P0 | — | FR-3.1, D-005@v1 | post_scan_validator.py:156 |
| task-05 | WorkspaceScanner 扁平重写 | W1 | P0 | — | FR-3.2, D-005@v1 | scanner.py:78-130 语义翻转 |
| task-06 | WorkspaceParser 扁平 | W1 | P0 | — | FR-3.3, D-005@v1 | parser.py:108 projects_subdir |
| task-07 | 补 archive status 投影 ★ | W2 | P0 | task-01 | FR-1.4, D-004@v2, D-007@v1 | 唯一新代码，R-01 P0 |
| task-08 | 删 CHANGE_ARCHIVE 权限常量 | W2 | P2 | task-01 | FR-1.3 | 确认孤立后删 |
| task-09 | requires_worktree 测试断言 | W2 | P0 | task-03 | FR-2.3 | 11 处断言改 False |
| task-10 | scanner 测试 fixture 扁平化 | W2 | P0 | task-05, task-06 | FR-3.4 | test_scanner.py 14 处 |
| task-11 | 全量回归验证 | W3 | P0 | task-01..10 | NFR-1, AC-8 | backend+frontend 全量 |

## 关键路径

task-01 → task-07 → task-11（archive 删除 → status 投影 → 回归，最长路径）
task-05/task-06 → task-10 → task-11（scanner 扁平 → fixture → 回归，并行支线）

两条支线在 task-11 汇合。Wave 1 六任务全并行启动可最大化吞吐。

## 全局验收标准

- [ ] AC-1：`/archive` `/distill` 端点 404，archive/ 模块删除，main.py 无 import（task-01）
- [ ] AC-2：frontend grep 无 archiveChange/distillChange/handleArchive 残留，pnpm build 通过（task-02）
- [ ] AC-3：archive stage 完成后 change.status="archived"/location="archive"/archived_at 非空（单测+e2e）（task-07）★
- [ ] AC-4：propose/plan/execute/archive requires_worktree 全 False，_ensure_change_dir_in_worktree grep 零命中（task-03）
- [ ] AC-5：test_dispatch_stage_config.py + test_dispatch.py 共 11 处断言改 False 通过（task-09）
- [ ] AC-6：扁平根 spec_root 下 PostScanValidator 不报 expected_docs_missing（task-04）
- [ ] AC-7：扁平根 rescan 不报 WARN_NO_SILLYSPEC，WorkspaceParser 扁平解析通过（task-05, task-06, task-10）
- [ ] AC-8：backend 全量 pytest + frontend pnpm test 零回归；delegate 9 方法/stage dispatch/complete_lease 行为不变（task-11）
- [ ] （brownfield 兼容）未触发归档的变更状态不变；现有 stage dispatch brainstorm/plan/execute/verify 流转不变；HostFsDelegate 9 方法行为不变

## 覆盖矩阵（decisions.md 当前版本）

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v2（delegate 写原语不需要） | 非目标（无 task） | plan 不含 delegate 写原语任务 |
| D-002@v1（change_dir 删死路径） | task-03 | AC-4 |
| D-003@v1（worktree lease 不强删） | 非目标（无 task） | plan 不含 worktree lease 清理任务 |
| D-004@v2（archive 删死代码+投影） | task-01, task-07 | AC-1, AC-3 |
| D-005@v1（scanner/parser 扁平） | task-04, task-05, task-06 | AC-6, AC-7 |
| D-006@v1（archive 归属 sillyspec） | task-01 | AC-1（端点删，归属 stage dispatch） |
| D-007@v1（status 投影缺口） | task-07 | AC-3 |

无 P0/P1 unresolved blocker（decisions 全 accepted）。
