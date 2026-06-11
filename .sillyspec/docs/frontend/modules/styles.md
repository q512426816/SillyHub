---
schema_version: 1
doc_type: module-card
module_id: styles
author: qinyi
created_at: 2026-06-10T16:55:00
---

# styles

## 定位
全局样式系统。基于 Tailwind CSS + CSS 变量实现主题化（亮色/暗色模式）。

## 契约摘要
- `globals.css` — 全局样式入口
  - CSS 变量定义：亮色模式（`:root`）和暗色模式（`.dark`）
  - 变量包括：background、foreground、card、primary、muted、destructive、border、input、ring、success、warning
  - Tailwind 基础层（base/components/utilities）导入
  - 全局排版样式：body 字体栈（含中文 PingFang/Microsoft YaHei）、标题层级（h1/h2/h3）、表格样式
- `tailwind.config.ts` — Tailwind 配置
  - darkMode: `["class"]`
  - 自定义颜色映射到 CSS 变量
  - tailwindcss-animate 插件
- `postcss.config.mjs` — PostCSS 配置（tailwindcss + autoprefixer）

## 关键逻辑
- 颜色系统通过 HSL CSS 变量实现，Tailwind 通过 `hsl(var(--xxx))` 引用
- 暗色模式通过给 html 元素添加 `.dark` class 触发

## 注意事项
- 新增颜色变量需在 globals.css 的 `:root` 和 `.dark` 中同时定义
- tailwind.config.ts 中对应的颜色映射也需同步更新

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
