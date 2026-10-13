---
author: flow-machine-draft
created_at: 2026-10-13T21:31:25.417Z
---
# 提案书（Proposal）— 2026-10-14-turn-anchor-cache-eviction

## 动机

任务原话转写：动机：轮锚快照内存缓存 _lastTreeBySession 只 set 不 delete，会话终结无清理（对照同文件 _chainBySession 有 finally 自清理），长驻 daemon 每会话残留约百字节条目，慢性增长（2026-10-14 24h 风险审查唯一实质发现，低危）。
成功标准：
- turn-anchor.ts 导出会话级缓存清理函数，terminateSession 会话终结时调用，对齐 _clearBackgroundTasks/_destroyUsageLedger 同点惯例
- 清理后同会话再打锚，prev 锚经 JSONL 尾行兜底恢复，去重与 diff 链无功能回归
- 未存在 sessionId 调用清理不抛错
- 新增单测覆盖以上三条，turn-anchor 相关测试全绿

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. turn-anchor.ts 导出会话级缓存清理函数，terminateSession 会话终结时调用，对齐 _clearBackgroundTasks/_destroyUsageLedger 同点惯例
2. 清理后同会话再打锚，prev 锚经 JSONL 尾行兜底恢复，去重与 diff 链无功能回归
3. 未存在 sessionId 调用清理不抛错
4. 新增单测覆盖以上三条，turn-anchor 相关测试全绿

## 成功标准（可验证）

1. turn-anchor.ts 导出会话级缓存清理函数，terminateSession 会话终结时调用，对齐 _clearBackgroundTasks/_destroyUsageLedger 同点惯例
2. 清理后同会话再打锚，prev 锚经 JSONL 尾行兜底恢复，去重与 diff 链无功能回归
3. 未存在 sessionId 调用清理不抛错
4. 新增单测覆盖以上三条，turn-anchor 相关测试全绿
