---
schema_version: 1
doc_type: module-card
module_id: lib-change-writer
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 变更写入·已删除（lib-change-writer）

## 定位
**已删除模块（墓碑卡）**。`frontend/src/lib/change-writer.ts` 于 commit c2262cca（2026-07-24，chore(frontend): 清理交叉引用层死代码）作为 0 引用死文件删除（knip+vulture+grep 三重确认，纯删除无 API 变更）。删除前仅剩 `createChange`（POST `/api/workspaces/{ws}/changes/create`）一个函数 35 行；当前工作树与 map 基线 commit 744e3de4 中该文件均不存在。

## 契约摘要
无。`createChange` 已删，`frontend/src` 内零命中。旧卡记录的 `generateDocs` / `batchGenerateDocuments` 在删除时已先不存在。

## 关键逻辑
```
（无源码）
```

## 注意事项
- `_module-map.yaml` 仍列本模块为 active——属 map 陈旧条目，下次 scan 应剔除或标记 removed。
- 「变更创建」语义现存去向：会话驱动化翻转（2026-08-14-change-center-conversation-driven）后创建入口并入变更列表/会话流程，`lib-changes` 的 `createChange`/`executeChange` 同步移除；spec 文档读写走 `lib-change-files`（list/get/save content）。
- 勿凭旧卡（ba87eec 版）描述恢复该文件或其端点。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
