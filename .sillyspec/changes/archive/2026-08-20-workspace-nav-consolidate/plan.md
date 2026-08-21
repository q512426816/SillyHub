---
author: qinyi
created_at: 2026-08-20T23:55:00
plan_level: light
---

# 轻量计划（Light Plan）：工作区导航整合

## 来源
用户反馈（宫格重复/子页缺菜单）+ design.md §5（Grill 修订版：standalone 收窄仅 topology）+ D-401~403。

## 范围
- frontend/src/app/(dashboard)/workspaces/[id]/page.tsx（删宫格段）
- frontend/src/components/workspace/quick-entry-grid.tsx（删除）
- frontend/src/components/workspace-tabs.tsx（13 项+滑动+双高亮修）
- frontend/src/app/(dashboard)/workspaces/[id]/layout.tsx（standalone 收窄）
- frontend/src/app/(dashboard)/workspaces/[id]/page.test.tsx（宫格断言删）

## Tasks
- task-01（FR-01, D-401）
- task-02（FR-02, D-402）
- task-03（FR-03, D-403）

## 验收
- grep QuickEntryGrid 全仓清零；菜单 13 项（label/href 逐一断言）；任意子页仅当前项 aria-current
- components/changes 页含顶部菜单（测试断言 workspace-tabs 渲染）；topology 无菜单（standalone 保留）
- tsc/eslint 0 error；全量 pnpm test 过；Docker 实测 components/changes/topology 三页

## 覆盖矩阵（如存在 decisions.md）
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-401 | task-01 | grep 清零 |
| D-402 | task-02 | 13 项断言+滑动类 |
| D-403 | task-03 | layout 测试+Docker |
