---
author: qinyi
created_at: 2026-07-01 22:50:00
change: 2026-07-01-changes-align-sillyspec（archive 重建）
---

# Verify Result — 变更中心流程对齐 SillySpec 工具契约

## 结论：✅ PASS

## 任务完成度（W1-W5 / 13 task 全完成）

| Wave | 任务 | 状态 |
|---|---|---|
| W1 | task-01 StageEnum 收敛 6 stage + 删 HumanGate/ChangeFSM + 新增 ChangeStatus/StageStatus/StepStatus | ✅ |
| W1 | task-02 Alembic migration `202607011000`（drop human_gate + status→active） | ✅ |
| W1 | task-03 schema DTO（PendingReview 枚举 + pending_review 投影） | ✅ |
| W2 | task-04 dispatch STAGE_ORDER 断言 + 删 PROPOSE/QUICK + sync 去 guard + complete_stage 重映射 | ✅ |
| W2 | task-05 _resolve_db_path 强化（platform_managed 显式） | ✅ |
| W2 | task-06 workflow transition/submit_review 端点移除（D-006）+ change_writer ready_for_dev guard 删 | ✅ |
| W3 | task-07 StageProjectionService（D-004@v2 stage 完成事件投影） | ✅ |
| W3 | task-08 review 端点改基于 pending_review 推进 stage（D-007 archive-confirm） | ✅ |
| W4 | task-09 详情页 WORKFLOW_STAGES 主线 + GATE_PANELS 读 pending_review + 删幽灵反馈 | ✅ |
| W4 | task-10 列表页 STAGE 收敛 + 生命周期对齐 | ✅ |
| W4 | task-11 lib/workflow.ts 合并进 changes.ts + quickFixChange 独立入口 + step-progress waiting | ✅ |
| W5 | task-12 docs/sillyspec/progress-specdir-drift.md | ✅ |
| W5 | task-13 端到端 SC-1~SC-7 验证 | ✅ |

## 设计一致性（D-001~D-007）

- D-001 缓存镜像（Hub current_stage/stages 单向跟 sillyspec.db，删 human_gate 列）✅
- D-002 sillyspec.db 单一真相源（Hub 不直写 stage，mode=ro 只读）✅
- D-003 specDir 仅修平台侧（_resolve_db_path daemon）+ 记 CLI bug ✅
- D-004@v2 4 审核面板 = stage 完成事件投影（spike-01 实证 plan/verify/archive 无 requiresWait，supersedes D-004@v1）✅
- D-005 数据不要求历史兼容（migration 不回填）✅
- D-006 transition 真相入口 = change（移除 workflow transition_change/submit_review）✅
- D-007 archive-confirm = Hub 侧标记（--done --confirm 由 daemon agent）✅

## 测试结果

- **后端 pytest**：182 passed, 2 skipped（change 117 + workflow 44 + change_writer 21）
- **前端 vitest**：538 passed, 0 failed（main 分支全量）
- **tsc**：0 error / **ruff**：All checks passed

## SC-1~SC-7 状态

- ✅ SC-1 StageEnum == 工具 STAGE_ORDER（6 值，启动期断言）
- ✅ SC-2 changes 表 human_gate 列不存在（model 列定义删 + migration drop；SQLite 测试库 create_tables 验证）
- ✅ SC-3 human_gate 在 change/workflow 代码区 grep=0（dispatch auto_dispatch guard 死代码删 + model 列定义删）
- ✅ SC-4 幽灵 stage grep=0（ready_for_dev/business_review/technical_verification/rework_required/accepted 清零；archive gate 的 stages JSON flag `business_review_passed` 非 stage 枚举，保留）
- ✅ SC-5 POST transition 仅 change 模块注册（workflow transition_change 移除）
- ✅ SC-6 _resolve_db_path platform_managed 返回 daemon specDir 的 sillyspec.db
- ✅ SC-7 stage 流转语义与工具一致（brainstorm→plan→execute→verify→archive 主线）

## 变更风险等级：LOW

代码完成 + 全量测试通过 + 设计决策（含 D-004@v2 spike-01 调整）落地。唯一风险见下。

## Runtime Evidence / 遗留

- **sillyspec archive 平台模式 bug**：archive 流程的 `📦 已归档` 实际**删除了变更目录**（unregisterChange + 目录消失），未移到 archive/。导致本变更的 design/plan/TaskCard/decisions 过程文档丢失（代码安全，已 merge main commit `197c53d7`/`1adbcb39`）。详见 `docs/sillyspec/platform-mode-archive-loses-changedir.md`。
- main 与 origin/main 分叉（本地 4 / 远程 7），需 rebase/pull 后 push。
