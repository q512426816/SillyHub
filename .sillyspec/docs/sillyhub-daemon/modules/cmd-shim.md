---
schema_version: 1
doc_type: module-card
module_id: cmd-shim
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:10:50
---
# cmd-shim

## 定位
Windows npm cmd-shim `.cmd` 包装解析器（`src/cmd-shim.ts`）。npm 全局 bin（codex.cmd / claude.cmd / cursor-agent.cmd）由 cmd-shim 包生成，Node `child_process.spawn(cmd.cmd, args, {shell:true})` 在不同 shell（git-bash/PowerShell）下行为不一致甚至 ENOENT。本模块直接读 `.cmd` 文件提取真实 exe + target，用 `spawn(exe, [target, ...args])` 绕开 shell。

## 契约摘要
- `resolveWindowsCmdShim(cmdPath: string): { exe: string; prependArgs: string[] } | null`
  - `exe`：真实可执行（node.exe 或 claude.exe 等）。
  - `prependArgs`：exe 后续固定位置参数（codex.js 路径等），调用方须把 adapter.buildArgs() 结果追加其后。
  - 非 Windows / 读失败 / 无匹配模式 → null。

## 关键逻辑
读 .cmd 全文，按三种模式顺序匹配（flat = 去换行后的内容）：
```
模式0 PowerShell -File 包装（cursor-agent.cmd）:
  匹配 powershell ... -File "<ps1>" %* → 先试 resolveCursorVersionEntry(ps1)
    命中 → 返回 { nodeExe, [indexJs] }（绕过坏 ps1）
    未命中 → 返回 powershell.exe + ['-NoProfile','-ExecutionPolicy','Bypass','-File',ps1]
模式1 node+js（codex.cmd）: 匹配 "%_prog%" "<target>" %* → exe=dp0\node.exe 或 process.execPath, prependArgs=[target]
模式2 原生 exe（claude.cmd）: 匹配 "<exe>" %* → 返回 {exe, []}
```
`expand()` 展开 `%dp0%`/`%SCRIPT_DIR%` 变量。

## 注意事项
- **非 Windows 直接返回 null**（process.platform !== 'win32'），无副作用。
- `%dp0%` = .cmd 文件所在目录；node 优先用 `dp0\node.exe`（nvm4w 全局目录通常带），缺失回落 `process.execPath`。
- codex.cmd 的 `endLocal & goto ... & "%_prog%" "..." %*` 是单行混合模式，不能按行首关键字跳过，故改全文搜索包含 `%*` 的双引号命令。
- cursor-agent.ps1 因版本目录正则不匹配新版目录而 exit 1，故模式0 优先调 cursor-version 绕过；详见 cursor-version 模块。
- 调用方（task-runner / interactive）拿到 prependArgs 后必须把业务 args 追加在后面，否则丢参数。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
