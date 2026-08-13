---
title: quick 独立阶段 模块影响分析
change_key: 2026-08-12-quick-independent-stage
stage: archive
created_at: 2026-08-13T10:25:00+08:00
author: WhaleFall
---

# 模块影响分析：quick 独立阶段全套适配

## 数据源

- **真实变更**：`git show 320bf97a --name-only`（本变更 commit，8 个源文件）
- **声明范围**：design.md §9 文件变更清单（7 文件 + task-08 router.py）
- **任务范围**：plan.md 8 task
- 三重交叉验证一致（真实 = 声明 = 任务），以 git diff 为准。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|-------------|
| backend/change | 数据结构变更 + 配置变更 | `backend/app/modules/change/model.py` | `StageEnum` 加 `QUICK="quick"` 辅助成员；新增 `spec_auxiliary_stages()` 返回 `[QUICK]`；`spec_stages()` 仍主线 5 阶段（断言保持）；`TRANSITIONS` 零改（无 quick 边） | false |
| backend/change | 配置变更 | `backend/app/modules/change/dispatch.py` | `STAGE_AGENT_CONFIG` 加 `StageEnum.QUICK.value` 配置（prompt=quick.md, phase=Quick, read_only=False, requires_worktree=False）；manual_dispatch generic 复用，无需改派发逻辑 | false |
| backend/change_writer | 逻辑变更 | `backend/app/modules/change_writer/proxy.py` | 创建分流：`change_type=="quick"→current_stage=quick`，否则 brainstorm（保持 ql-006）；`initial_stage` 变量统一 Change 构造 + 两处 log | false |
| backend/change_writer | 逻辑变更 | `backend/app/modules/change_writer/service.py` | 同上创建分流（worktree lease 路径）；`initial_stage` 统一 Change 构造 + log | false |
| backend/change_writer | 逻辑变更 | `backend/app/modules/change_writer/router.py` | `/changes/create` 端点补 quick 守卫：`change_type=="quick"` 跳过 brainstorm 覆盖 + auto-dispatch（task-08） | false |
| backend/change_writer | 配置变更（测试） | `backend/app/modules/change_writer/tests/test_classifier.py` | 扩展 5 例：QUICK 成员 / spec_auxiliary_stages / spec_stages 排除 quick / STAGE_AGENT_CONFIG 配置 / 分流映射 | false |
| frontend_app | 逻辑变更 | `frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx` | 列表页 `STAGE_LABEL` 加 `quick:快速任务`；`STAGE_KIND` 加 `quick:warning` | false |
| frontend_components | 逻辑变更 | `frontend/src/components/changes/detail/change-stage-actions.tsx` | 详情页 `ChangeStageActions` 加 quick 早返回分支（⚡快速修复 + 档案选择器 + 触发按钮 + 完成态）；完成态读 `change.stages.quick.status`（D-003 指定源） | false |

## 未匹配文件

| 文件 | 原因 |
|------|------|
| （无） | 全部 8 文件均匹配到 _module-map.yaml 已注册模块 |

## 影响汇总

- **后端 2 模块**（change / change_writer）：枚举扩展 + dict 配置 + 创建分流字符串变量 + 端点守卫。无 DB 迁移（current_stage 是 String 列），无 API 端点新增，无通信协议改动。
- **前端 2 模块**（frontend_app / frontend_components）：列表页标签 + 详情页 quick 分支。
- **主线隔离**：spec_stages / TRANSITIONS / STAGE_ORDER / 主线 dispatch 全不变（实跑断言通过），quick 走独立 manual_dispatch。
- **needs_review**：全部 false——改动范围明确，枚举/dict/分流/UI 分支，无不确定影响。

## 模块文档同步建议

- `_module-map.yaml`：本次无需改结构化字段（无新模块、无新 entrypoint/main_symbol、paths glob 已覆盖）。change 模块 `main_symbols` 可选补 `StageEnum.QUICK` / `spec_auxiliary_stages`，但非必须（枚举成员不改变模块对外接口）。
- 模块卡片（change.md / change_writer.md）：可选补「quick 辅助阶段」语义说明（quick 是独立流程，不走主线）。非必须——本次未改模块边界/接口契约。
