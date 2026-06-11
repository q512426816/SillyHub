---
schema_version: 1
doc_type: module-card
module_id: lib-utils
author: qinyi
created_at: 2026-06-10T16:55:00
---

# lib-utils

## 定位
通用工具函数。仅包含 className 合并工具。

## 契约摘要
- `cn(...inputs: ClassValue[])` — 合并 Tailwind CSS className（基于 clsx + tailwind-merge）

## 关键逻辑
- 使用 clsx 处理条件 className，tailwind-merge 处理 Tailwind 类冲突

## 注意事项
- 被 components-ui 和 components-shared 广泛使用

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
