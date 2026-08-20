---
author: qinyi
created_at: 2026-08-20T22:10:00
---

# 提案书（Proposal）— 工作区子页面样式统一

## 动机

概览页工作台化后，8 个子页面（组件/变更/会话/文件/Skills/MCP/MCP 令牌/成员）交互模式各自为政：8 处手写错误条三种规格、4 处返回链接 hack、4 处手写空态、5 处语义色硬编码、2 页表格规格互异、列表卡无悬浮，与用户确认的新风格脱节。

## 关键问题

1. 共性模式无公共组件，同一错误条模式复制 8 次（D-301 明令禁止第 7+ 处）。
2. FRONTEND_PAGE_STYLE 旧 antd 全量条款与工作台式 shadcn 基线冲突无适用范围界定（D-304 解决）。
3. members 中英文混杂、explorer 高度锚过时等收尾债。

## 变更范围

9 项共性修复 × 8 页 + 公共 ErrorBanner 组件 + 2 个内嵌组件（shared-daemon-manager/workspace-member-row）+ 规范文件适用范围声明。

## 不在范围内（显式清单）

- 不拆 changes 675 行大文件（另立项）
- 不改业务逻辑/数据流/API
- 不重做 HTML 原型（风格已定型，D-302）
- 手写表不换 DataTable（D-303）

## 成功标准（可验证）

- grep 8 页+2 内嵌组件：bg-red-50 错误条清零（全换 ErrorBanner）、amber/emerald tone 硬编码清零（5 处改语义色）、英文文案清零（members）
- 4 处返回链接统一入 PageHeader actions 且目标一致（/workspaces/${id}）
- 4 处空态换 EmptyState；列表卡 hover=lift 生效
- tsc/eslint 0 error；全量 pnpm test 通过（断言同步后）
- Docker 抽查 3 页（skills/members/explorer）双主题观感
