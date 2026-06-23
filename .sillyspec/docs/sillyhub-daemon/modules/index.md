---
schema_version: 1
doc_type: module-card
module_id: index
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:10:50
---
# index

## 定位
sillyhub-daemon 源码入口占位文件（`src/index.ts`）。当前仅 `export {}`，不含业务逻辑。最早为 W0 阶段让 tsc 有输入、避免空 include 触发 TS18003（"No inputs were found in config file"）而存在。

## 契约摘要
- 无导出符号（`export {}`）。
- 不被任何模块 import，无对外接口。

## 关键逻辑
```
export {};
```
文件内注释说明：后续业务模块（types.ts / protocol.ts / ... / cli.ts）在 src/ 增量补齐；如需聚合导出可在此扩展，当前保持空。

## 注意事项
- 实际入口是 `cli.ts`（package.json bin 指向 dist/cli.js），不是 index.ts。
- 该文件存在的唯一原因是 tsc 编译占位；删除会导致 include 为空时报 TS18003。
- 修改本文件无业务影响，除非确实需要 barrel re-export。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
