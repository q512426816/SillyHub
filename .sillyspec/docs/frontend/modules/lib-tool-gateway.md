---
schema_version: 1
doc_type: module-card
module_id: lib-tool-gateway
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 工具网关·已删除（lib-tool-gateway）

## 定位

**墓碑卡（死条目）**：源文件 `frontend/src/lib/tool-gateway.ts` 已在 commit
`cbde5217`（chore: 清理全仓死代码 backend/frontend/daemon）中删除。全仓 grep 无
任何 `executeTool` 实现或导入残留，`_module-map.yaml` 中该条目为过时索引，
待下次 scan 剔除。

## 契约摘要

无。旧契约（worktree 租约内受控工具执行代理，`/api/worktrees/{leaseId}/tools`，
`executeTool`）已随文件删除一并消失，前后端均无对应活跃端点消费。

## 关键逻辑

```
（无源码 —— 不存在可描述逻辑）
```

## 注意事项

- 本卡仅作墓碑记录，防止按旧索引/旧卡引用 `@/lib/tool-gateway` 复活死代码。
- 若未来重新引入 worktree 工具代理，应建新 change 并重写本卡，而非恢复旧实现。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
