---
schema_version: 1
doc_type: module-card
module_id: cursor-version
author: qinyi
created_at: 2026-08-18 01:45:00
---

# cursor 版本目录解析器（cursor-version）

## 定位

cursor-agent 版本目录解析器，绕过官方坏掉的 cursor-agent.ps1。官方 ps1 用正则
`^\d{4}\.\d{1,2}\.\d{1,2}-[a-f0-9]+$` 找最新版本目录，但新版目录名是
`YYYY.MM.DD-HH-MM-SS-commit`（含时分秒、多段 `-`），不匹配 → ps1 WriteError + exit 1，且该查找在 `$args` 之前执行，导致 cursor-agent 任何调用都崩（版本探测
注册 'unknown'、task 执行启动即崩）。本模块直接扫描 `versions/` 目录取最新版本
的 node.exe + index.js 入口（ql-20260620-002-f8c1）。

## 契约摘要

- `CursorVersionEntry`（readonly versionDir / nodeExe / indexJs / version）——
  最新版本入口，version 为目录名原样（如 `2026.06.16-20-30-07-a07d3ac`）。
- `resolveCursorVersionEntry(cmdOrDir): CursorVersionEntry | null`——输入
  cursor-agent.cmd/.ps1 路径或其所在目录，自动定位同目录 `versions/` 子目录；
  任一环节缺失或 fs 异常返回 null（不抛），调用方回落原行为。

## 关键逻辑

```
baseDir = statSync(x).isDirectory() ? x : dirname(x)   # stat 失败按目录 dirname 兜底
names = readdirSync(versions/) 过滤「目录 && YYYY.MM.DD 前缀」
sort 降序：key = [yyyymmdd 数值, 完整目录名]（同日按时分秒字典序 = 时间序）
取第一个 → 校验 node.exe + index.js 存在（缺一视为不完整 → null）→ entry
```

兼容新旧目录命名（`YYYY.MM.DD-HH-MM-SS-commit` / `YYYY.MM.DD-commit`）：
VERSION_PREFIX_RE 只匹配日期前缀、不校验后缀，靠排序取最新。

## 注意事项

- 消费方：agent-detector（cursor 版本探测 fallback）与 cmd-shim
  （resolveWindowsCmdShim 模式0 增强：cursor-agent.ps1 → 直接返回版本目录 node
  入口，task-runner 改 spawn `node.exe index.js <args>` 绕过 ps1）。
- ps1 的 `node.exe index.js $args` 调法本身正确，只是它自己找不到目录；本模块
  复用同样的入口绕过查找这一步。
- 缺关键入口文件返回 null 而非半残 entry（回落原 ps1 行为比 spawn 半残入口安全）。
- 仅 Windows cursor-agent 自更新结构有效；POSIX 无 versions/ 目录自然返回 null。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
