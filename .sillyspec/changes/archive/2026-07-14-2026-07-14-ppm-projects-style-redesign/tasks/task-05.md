---
id: task-05
title: "`projects/page.tsx` 枚举 statusKind/color 改造 + 成员抽屉换 antd"
title_zh: projects 页枚举语义化与成员抽屉规范化
author: WhaleFall
created_at: 2026-07-14 11:00:55
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: [D-003@v1, D-004@v1, D-006@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/projects/page.tsx
expects_from:
  task-01:
    - contract: PpmFieldOption
      needs: [statusKind]
goal: >
  状态枚举加 statusKind、类型 color 改 token 预设名（blue/cyan/default）、成员管理抽屉换 antd Drawer（maskClosable=false）。
implementation:
  - PROJECT_STATUS_OPTIONS 三项去 color、加 statusKind（ongoing=info / completed=success / paused=warning），交由 task-01 渲染分支走 StatusBadge
  - PROJECT_TYPE_OPTIONS color 调整：研发=blue、实施=cyan、运维由 geekblue 改 default（灰 Tag）
  - ProjectMembersDrawer 删除 fixed inset-0 bg-black/30 手写遮罩 + ✕ emoji 按钮，改为 antd Drawer（open/onClose/width=760/title/maskClosable=false），内部仍嵌 PpmProjectMembersTable
  - 保持 projectId 过滤、PpmProjectMembersTable 嵌套与 onClose 回调不变；仅替换浮层容器
acceptance:
  - 状态列经 task-01 渲染为带圆点 pill（进行中蓝 / 已完成绿 / 已暂停橙）
  - 类型列经 task-01 渲染为 Tag（研发蓝 / 实施青 / 运维灰）
  - 成员管理抽屉为 antd Drawer，点遮罩不关，ESC / 关闭按钮可关
  - 本文件 grep 不到 bg-black/30 与 ✕ emoji
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 消费 task-01 提供的 PpmFieldOption.statusKind
  - 纯样式，fields/CRUD/搜索/导出逻辑不变
---
