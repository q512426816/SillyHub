---
id: task-07
title: grep 残留验证 + Docker rebuild 实测 5 页
title_zh: 残留 grep 验证与 Docker 实测
author: WhaleFall
created_at: 2026-07-14 11:00:55
priority: P0
depends_on: [task-06]
blocks: []
requirement_ids: []
decision_ids: []
allowed_paths:
  - frontend/src/components/ppm-resource-table.tsx
  - frontend/src/components/ppm-project-members-table.tsx
  - frontend/src/app/(dashboard)/ppm
goal: >
  grep 确认 ppm 范围无手写浮层（bg-black/30 / ✕ emoji）与硬编码色（emerald-300）残留；
  Docker rebuild 后实测 5 页功能不回归、浮层遮罩不关、成员抽屉内嵌 Drawer 层级正常（R-06）。
implementation:
  - grep -rn "bg-black/30|emerald-300" frontend/src/components/ppm-* frontend/src/app/\(dashboard\)/ppm 确认无残留
  - grep ✕ emoji 关闭按钮确认无残留（ppm 范围）
  - docker compose rebuild frontend 后实测 5 页（项目 / 客户 / 干系人 / 项目成员 / 成员管理抽屉）
  - 验证浮层点遮罩不关（maskClosable=false）、ESC / ✕ / 取消可关
  - 验证「成员管理」抽屉内「编辑成员」Drawer 嵌套层级：内层 z-index 自动叠加、ESC 关最上层（R-06/G1）
acceptance:
  - grep 无 bg-black/30、✕ emoji 关闭按钮、emerald-300 残留（AC-01）
  - 4 个 ppm 列表页 + 成员管理抽屉 CRUD / 搜索 / 导出不回归（AC-05）
  - 浮层点遮罩不关、ESC/✕/取消可关（AC-03）
  - 成员管理抽屉内嵌编辑 Drawer 层级正常，内层遮罩与 ESC 行为正确（R-06/G1）
verify:
  - grep -rn "bg-black/30" frontend/src/components/ppm-resource-table.tsx frontend/src/components/ppm-project-members-table.tsx
  - grep -rn "emerald-300" frontend/src/components frontend/src/app/\(dashboard\)/ppm
  - cd deploy && docker compose up -d --build
constraints:
  - 实测以 Docker rebuild 后真页面为准，不只靠 tsc / lint
  - 发现功能回归或层级异常立即回退对应 task（task-02/04/05）
  - grep 范围限定 ppm，不误报其他模块
---
