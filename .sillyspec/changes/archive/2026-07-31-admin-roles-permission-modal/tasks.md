---
author: WhaleFall
created_at: 2026-07-31T15:00:54
---

# 任务清单（Tasks）— /admin/roles 新建弹窗 + 权限左树右权

> 方案 B · plan 阶段细化 Wave 与 task 卡片。

## Wave 1 — 实现

- task-01: `admin/roles/page.tsx` RoleDrawer(:441-520)抽屉 → antd Modal(居中 w-720),字段/校验/保存/只读逻辑迁移不变(覆盖 FR-01, D-001)
- task-02: `admin-role-permission-picker.tsx` 重写为左树(section/menu,带选中数 n/m + 高亮)+ 右权限面板(全选/indeterminate + 权限列表),高度固定 h-420 左右滚动,默认选第一个 menu(覆盖 FR-02/03/04, D-002/003)

## Wave 2 — 测试

- task-03: `admin-role-permission-picker` 左树右权测试(左树切换/全选/indeterminate/选中数 n/m/默认选第一个 menu/disabled)(覆盖 FR-02/03/04)
- task-04: RoleDrawer→Modal 测试(打开居中 Modal + 字段/保存/只读不变)(覆盖 FR-01)

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D |
|---|---|---|---|---|---|
| task-01 | RoleDrawer 抽屉→Modal | W1 | P0 | — | FR-01, D-001 |
| task-02 | picker 重写左树右权 | W1 | P0 | — | FR-02/03/04, D-002/003 |
| task-03 | picker 左树右权测试 | W2 | P0 | task-02 | FR-02/03/04 |
| task-04 | RoleDrawer→Modal 测试 | W2 | P0 | task-01 | FR-01 |
