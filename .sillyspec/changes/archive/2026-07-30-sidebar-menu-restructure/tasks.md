---
author: qinyi
created_at: 2026-07-30 08:52:19
change: 2026-07-29-sidebar-menu-restructure
---

# 任务列表（Tasks）— SillyHub 侧边栏菜单信息架构重组

> 本文件为 brainstorm 阶段的初步任务拆分，plan 阶段将按 Wave 细化并补充依赖、文件级范围与验收标准。

- [ ] task-01: 后端 `permissions.py` 新增 `LLM_PROVIDER_READ` 枚举 + 权限测试（FR-05）
- [ ] task-02: `menu-permissions.ts` 重组（`MenuSection` 6 值 + 菜单项重排 + 新增 3 菜单项 + SECTION_ORDER/LABEL）（FR-01/02/03）
- [ ] task-03: 我的供应商独立页面 `/settings/providers`（复用 `LlmProviderSection`）+ 渲染测试（FR-02）
- [ ] task-04: 设置页瘦身（移除 EntryCard + providers Tab，默认 Tab 改工作区信息）（FR-04）
- [ ] task-05: `app-shell.tsx` 视觉统一（MENU_ICON_MAP 补图标 + 分组间距/高亮）（FR-06）
- [ ] task-06: 更新受影响测试（`menu-permissions.test.ts`/`admin-role-permission-picker.test.tsx`/`permission.test.ts`）（FR-01）
- [ ] task-07: 前端全量测试 + 后端权限测试 + typecheck 对照 design 验收
