---
author: WhaleFall
created_at: 2026-06-25T14:01:00
---

# quick 任务 — default

- [x] **参考 ppm/project-plans 样式调整 admin/users 页面**（布局 + 查询条件 + 列表对齐 layout 组件模式）✅ 已完成
  - 文件：`frontend/src/app/(dashboard)/admin/users/page.tsx`
  - 方案：
    1. 布局：裸 `div max-w-7xl` → `PageContainer` + `PageHeader`(title 用户管理)
    2. 查询条件：裸 input/select/按钮 → `SectionCard`(bodyPadding p-2) + `SearchBar`(搜索 input + 状态 select) + `SearchBarActions`(共 N + 新建)；保留 debounce 搜索
    3. 列表：裸 antd `Table` → `DataTable`(bordered + emptyText)
  - 依据：`ppm/project-plans/page.tsx` 模式 + CLAUDE.md 规则 15（layout 组件样式系统）
  - 不变：load/handlers/columns 逻辑、Drawer/Dialog 子组件
