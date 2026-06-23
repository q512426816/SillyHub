---
schema_version: 1
doc_type: module-card
module_id: cursor-version
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:10:50
---
# cursor-version

## 定位
cursor-agent 版本目录解析器（`src/cursor-version.ts`）。绕过官方坏掉的 cursor-agent.ps1，直接扫描 `%LOCALAPPDATA%\cursor-agent\versions\` 取最新版本目录的 node.exe + index.js 入口，供 agent-detector（cursor 版本探测 fallback）与 cmd-shim（resolveWindowsCmdShim 模式0）共用。

## 契约摘要
- `CursorVersionEntry`（readonly versionDir/nodeExe/indexJs/version）——最新版本入口。
- `resolveCursorVersionEntry(cmdOrDir: string): CursorVersionEntry | null` ——输入 .cmd/.ps1 路径或目录，自动定位同目录 `versions/` 子目录；任一环节缺失返回 null，调用方回落原行为。

## 关键逻辑
```
baseDir = statSync(cmdOrDir).isDirectory() ? cmdOrDir : dirname(cmdOrDir)
versionsDir = join(baseDir, 'versions')
names = readdirSync(versionsDir).filter(目录 && 匹配 YYYY.MM.DD 前缀)
sort 降序: key=[yyyymmdd数值, 完整目录名]（同日按时分秒字典序）
取 names[0] → 校验 node.exe + index.js 存在 → 返回 entry
```
兼容两种目录命名：新格式 `YYYY.MM.DD-HH-MM-SS-commit`、旧格式 `YYYY.MM.DD-commit`。VERSION_PREFIX_RE 只匹配前缀不校验后缀，靠排序取最新。

## 注意事项
- **背景**：官方 ps1 用正则 `^\d{4}\.\d{1,2}\.\d{1,2}-[a-f0-9]+$` 找版本目录，新版目录名含时分秒 + 多段 `-` 不匹配 → ps1 `exit 1`，导致 cursor-agent 任何调用（--version 探测、task 执行）都崩。本模块绕过该 ps1。
- 任何 fs 异常（权限/符号链接断裂/目录不存在）都返回 null，不抛错——调用方（cmd-shim）据此回落 spawn powershell ps1。
- ps1 的 `node.exe index.js $args` 调法本身正确，只是它自己找不到目录；本模块复用同样的 node 入口绕过查找。
- 仅 Windows 场景有效（cursor-agent 自更新结构），POSIX 上无 versions/ 目录会返回 null。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
