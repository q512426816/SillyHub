---
schema_version: 1
doc_type: module-card
module_id: components-ui
author: qinyi
created_at: 2026-06-10T16:55:00
---

# components-ui

## 定位
基础 UI 原子组件库。基于 Tailwind CSS + class-variance-authority（cva）实现的轻量级设计系统组件。不包含业务逻辑。

## 契约摘要
- `button.tsx` — Button 组件：支持 variant（default/destructive/outline/secondary/ghost/link）和 size（default/sm/lg/icon）
- `input.tsx` — Input 组件：标准文本输入框
- `badge.tsx` — Badge 组件：标签/徽章展示

## 关键逻辑
- 使用 `cva`（class-variance-authority）管理变体样式
- 通过 `cn()` 工具函数（基于 clsx + tailwind-merge）合并 className

## 注意事项
- 当前只有 3 个基础组件，按需扩展
- 遵循 shadcn/ui 风格但为手写实现

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
