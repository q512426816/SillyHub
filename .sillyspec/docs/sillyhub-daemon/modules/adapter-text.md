---
schema_version: 1
doc_type: module-card
module_id: adapter-text
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 纯文本输出适配器（adapter-text）

## 定位
antigravity（agy CLI）纯文本 stdout 协议的 adapter 实现，6 协议中最简单的一个。agy 的 stdout 逐行纯文本、无任何结构化事件/无 JSON，每条非空行即一条 text 事件。1:1 迁移自 Python text.py 的 parse_line。

## 契约摘要
- `TextAdapter implements ProtocolAdapter`：
  - `provider = 'antigravity'`（硬编码单值，必须与 PROTOCOL_PROVIDERS.text 数组逐字一致）。
  - `buildArgs()` —— 返回空数组占位：本机无 agy 二进制，agent-detector 应已标 offline、daemon 不会接到 antigravity lease；待 agy CLI 上线后补全（参考 `--print` / `--no-color` 模式，prompt 走默认 stdin `${prompt}\n`）。
  - `parse(line): AgentEvent[] | null` —— trim 后非空 → `[{ type:'text', content: stripped }]`；空/纯空白行 → null。

## 关键逻辑
```text
parse(line):
  stripped = line.trim()
  return stripped === '' ? null : [{type:'text', content: stripped}]
  # trim 同时吃掉残留 \r/\n（readline 已去行尾，trim 兜底双保险）
```

## 注意事项
- **complete/error 事件不在此产出**：终态（completed/failed/timeout）由 TaskRunner 在子进程退出回调按 exit code 合成，不经 parse（与 Python text backend 一致）。
- 无实例状态（除 readonly provider），6 个 adapter 中唯一真正无状态、理论上可共享实例的；但工厂仍统一每次 new，保持语义一致。
- 方案 B：output 累积也下沉 TaskRunner（累积事件 content），本类只保留纯解析。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
