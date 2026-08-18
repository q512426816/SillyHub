---
schema_version: 1
doc_type: module-card
module_id: index
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 源码入口占位文件（index）

## 定位

sillyhub-daemon 源码入口占位文件。W0 阶段 src/ 尚无业务模块时为让 tsc 有输入而
建；业务模块（types / protocol / ... / cli）已在 src/ 增量补齐，本文件保持空占位。

## 契约摘要

- 无导出符号（`export {}`）。
- 不被任何模块 import，无对外接口。

## 关键逻辑

```
export {};   // 防 tsc 空 include 触发 TS18003（"No inputs were found"）
```

## 注意事项

- 实际 CLI 入口是 cli.ts（package.json bin 指向 dist/cli.js），不是本文件。
- 删除本文件会导致 include 为空时 TS18003 编译失败；保留是零成本保险。
- 项目未采用 barrel re-export 风格，新模块不在此登记。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
