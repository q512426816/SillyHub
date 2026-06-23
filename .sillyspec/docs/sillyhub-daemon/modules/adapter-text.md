---
schema_version: 1
doc_type: module-card
module_id: adapter-text
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:10:50
---
# adapter-text

## 定位
antigravity（agy CLI）纯文本 stdout 协议的 adapter（`src/adapters/text.ts`）。antigravity stdout 是逐行纯文本（无结构化事件/无 JSON），每条非空行即一条 text 事件，空行丢弃。1:1 迁移自 Python text.py:85-102。无状态：每次 parse 互不影响，多 lease 可共享同一实例。方案B：只保留纯解析职责，output 累积/终态判定下沉 task-runner。

## 契约摘要
- `TextAdapter implements ProtocolAdapter`：
  - `provider = 'antigravity'`（必须与 PROTOCOL_PROVIDERS.text 数组逐字一致）。
  - `buildArgs()` ——当前返回 `[]`（本机无 agy 二进制，agent-detector 应已标 offline；待 agy CLI 上线补全）。
  - `parse(line): AgentEvent[] | null`。

## 关键逻辑
```
parse(line):
  stripped = line.trim()
  stripped === '' → 返回 null（空行/纯空白丢弃，B-01/B-02）
  stripped !== '' → 返回 [{ type:'text', content: stripped }]
  trim 同时吃掉残留 \r/\n（B-03 双保险，readline 已去行尾）
```
content 用 trim 后值（与 Python content=stripped 一致）。永不返回 complete/error 类型事件。

## 注意事项
- **complete 事件不在此产出**：Python text.py 的 parse_line 同样只产 text，终态（completed/failed/timeout）由 execute() 的 proc.wait() 获得；Node 版由 task-runner 在子进程退出回调据 exit code 合成 complete/error 事件。
- 无实例状态（除 readonly provider），多 lease 共享单例（task-11 工厂可缓存）。
- buildArgs 当前空数组——因本机无 agy 二进制；agent-detector 应已标 offline，daemon 不会接到 antigravity lease。待 agy CLI 上线后补 `--print`/`--no-color` 等启动参数（prompt 走 stdin 默认 buildInput）。
- trim 兜底处理 \r\n（即便 readline 已分行也再 trim，B-03）。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
