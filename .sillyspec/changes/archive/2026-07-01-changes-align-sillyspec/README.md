---
author: qinyi
created_at: 2026-07-01 22:50:00
change: 2026-07-01-changes-align-sillyspec（archive 重建）
---

# 变更 2026-07-01-changes-align-sillyspec 归档说明

## 变更概述

变更中心（Changes）流程完全对齐 SillySpec 工具契约。StageEnum 收敛 6 stage（scan/brainstorm/plan/execute/verify/archive），删 HumanGate 自造状态机，sillyspec.db 为 stage 单一真相源（Hub 表退缓存镜像），workflow transition 收敛到 change 模块（D-006），4 审核面板改为 stage 完成事件投影（D-004@v2，spike-01 实证调整）。

## 代码位置（已 merge main）

- `main` commit `197c53d7` — W1-W5 全部 13 task 实现
- `main` commit `1adbcb39` — merge sillyspec/2026-07-01-changes-align-sillyspec into main
- `main` commit `2d660562` — 清理 worktree 误带的 meta.json/package-lock.json

## ⚠️ 过程文档丢失说明

**sillyspec 3.20.5 平台模式 archive 流程有 bug**：archive 的「📦 已归档」操作实际**删除了变更目录**（`unregisterChange` 删 db 记录 + 目录从 daemon specDir/changes/ 消失），未移动到 archive/。导致本变更的以下过程文档**丢失**：
- design.md（12 节设计文档）
- plan.md（5 Wave 13 task）
- tasks/task-01~13.md（13 TaskCard）
- decisions.md（D-001~D-007）
- proposal.md / requirements.md
- prototype-change-flow-aligned.html

代码未受影响（已 merge main）。本目录为**归档重建**，仅含：
- `verify-result.md`（基于 main 代码 + 测试结果重建的验证报告）
- `README.md`（本说明）

过程文档的完整内容散落在执行会话的对话历史 + main commit message 摘要中。如需完整 design/plan，可从对话历史或记忆（`changes-align-sillyspec-status.md`）重建。

## 测试

- 后端 pytest：182 passed（change 117 + workflow 44 + change_writer 21）
- 前端 vitest：538 passed
- SC-1~SC-7 全通过（详见 verify-result.md）

## 相关 sillyspec CLI bug 记录

- `docs/sillyspec/platform-mode-archive-loses-changedir.md`（本变更 archive 丢目录 bug）
- `docs/sillyspec/runtime-cleanup-destroys-worktree-meta.md`（worktree 清理 bug，3.20.5 已修）
- `docs/sillyspec/progress-specdir-drift.md`（progress specDir 漂移 bug，待修）
