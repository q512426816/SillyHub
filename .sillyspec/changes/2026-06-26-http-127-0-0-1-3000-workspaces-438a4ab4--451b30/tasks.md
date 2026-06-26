---
author: WhaleFall
created_at: 2026-06-26 09:51:01
---

# Tasks — scan-docs 文档树最大高度

## 背景

扫描文档页面左侧「文档树」SectionCard 无高度限制，文档多时把页面撑得很长。
参考 `admin/users` 表格做法（`scroll={{ y: "calc(100vh - 430px)" }}`），给文档树限定一屏高度并内部滚动。

## 偏移量依据（calc(100vh - 220px)）

- 顶部导航栏 TopBar `h-14` = 56px（`frontend/src/components/top-bar.tsx:90`）
- PageContainer `py-6` 上下各 24px（`page-container.tsx:36`）
- PageHeader 两行标题（返回链接 + 「扫描文档」h1）≈ 55px
- `gap-4`（header→grid）= 16px
- SectionCard header「文档树」标题栏 ≈ 40px
- 合计 ≈ 215px → 取 220px 留余量

> admin/users 用 430px 是因表格上方还有筛选表单 + 当前筛选文案 + 操作行 + 分页；
> scan-docs 文档树上方只有 PageHeader，故偏移更小。

## 任务

- [x] task-01：`frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx` 文档树 SectionCard 内，给 `<TreeView>` 外层包一个 `max-h-[calc(100vh-220px)] overflow-auto` 滚动容器，使文档超出时内部滚动、一屏可显示。不动 SectionCard 组件本身，只改用法。
