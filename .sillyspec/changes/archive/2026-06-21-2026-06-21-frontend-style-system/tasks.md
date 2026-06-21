---
author: qinyi
created_at: 2026-06-22T00:13:03
---

# Tasks — 前端样式系统重设计

> 只列任务名/文件/覆盖 FR·D,细节在 plan 阶段按 Wave 展开。

| ID | 任务 | 主要文件 | 覆盖 |
|---|---|---|---|
| T-01 | 建立 Design Token 单一源 | `styles/tokens.ts` | FR-01 |
| T-02 | 引入 Inter(@fontsource + next/font/local) | `styles/fonts.ts`, `package.json`, `layout.tsx` | FR-07, D-004@v2 |
| T-03 | antd ConfigProvider 全面定制 | `components/antd-providers.tsx` | FR-01 |
| T-04 | Tailwind config 映射 + globals.css 重构 | `tailwind.config.ts`, `globals.css` | FR-01 |
| T-05 | shadcn 视觉组件 copy-in | `components/ui/*` | FR-02, D-006 |
| T-06 | StatusBadge 统一状态语义 | `components/ui/status-badge.tsx` | FR-03, D-005 |
| T-07 | 共享布局组件 | `components/layout/*` | FR-04 |
| T-08 | AppShell 重做(侧栏 lucide + 顶栏) | `components/app-shell.tsx`, `top-bar.tsx` | FR-05, D-003 |
| T-09 | 逐页适配(看板/列表/拓扑/milestone/work-hour) | `app/(dashboard)/ppm/**` | FR-02, FR-04 |
| T-10 | 登录页重做 | `app/(auth)/login/page.tsx` | FR-06, D-002 |
| T-11 | 动效 + 收尾(滚动条/focus/reduced-motion) | `globals.css`, 组件 | FR-02 |
| T-12 | tsc + Docker rebuild 实测 + 截图对比 | — | 验收 |

## 决策覆盖(decisions.md 全引用)
- D-001@v1 暗色非目标 — 全任务遵守
- D-002@v1 登录页同色系 — T-10
- D-003@v1 lucide 图标 — T-08
- D-004@v1 Inter self-host v1(被 D-004@v2 取代)— T-02 按 v2 执行
- D-005@v1 状态色统一 — T-06
- D-006@v1 双库边界 — T-05/T-09 遵守
