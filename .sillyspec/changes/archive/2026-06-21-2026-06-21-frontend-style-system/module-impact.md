---
author: qinyi
created_at: 2026-06-22T01:20:00
---

# 模块影响分析 — 前端样式系统重设计

## 三重交叉验证
- **声明范围**(design §6 文件清单):styles/tokens+fonts、components/ui/*、components/layout/*、top-bar、antd-providers、app-shell、globals.css、tailwind.config、layout.tsx、login、ppm 各 page、topology、ppm-resource-table
- **任务范围**(plan/tasks task-01~12):同上
- **真实变更**(git diff frontend/):一致(20 改 + 18 新)
- 结论:声明 = 任务 = 真实,无偏差

## 模块影响矩阵
| 模块 | 影响类型 | 相关文件(摘要) | 更新内容 | needs_review |
|---|---|---|---|---|
| frontend_app | 样式变更 | `app/(auth)/login/page.tsx`、`app/(dashboard)/ppm/{kanban,project-plans,task-plans,milestone-details,work-hour-statistics}`、`workspaces/[id]/components/topology`、`app/globals.css`、`app/layout.tsx` | 登录页同色系重做、各页统一 PageContainer/DataTable、globals.css 注入 token+动效、layout 接入 Inter | false |
| frontend_components | 新增 + 修改 | `components/ui/*`(button/badge 改造 + card/tag/avatar/skeleton/tooltip/dropdown-menu/dialog/empty-state/status-badge 新增)、`components/layout/*`(6 组件)、`components/top-bar.tsx`、`antd-providers.tsx`、`app-shell.tsx`、`ppm-resource-table.tsx` | shadcn 视觉组件、共享布局组件、AppShell lucide+顶栏、antd ConfigProvider 全面定制 | false |
| frontend_lib | 样式变更 | `lib/ppm/aggregations.ts` | CHART_COLORS echarts 配色 → tokens 色阶(verify 后 gap1 修复) | false |

## 未匹配文件
无(本次改动全部落在 frontend_app / frontend_components / frontend_lib 三个模块内)。

## 模块文档同步建议
- `frontend_app.md`:补"样式系统统一(PageContainer/DataTable/同色系)"到变更索引
- `frontend_components.md`(若存在):补 shadcn 组件层 / 共享布局层 / antd ConfigProvider token 体系
- `frontend_lib.md`:aggregations CHART_COLORS 走 token
