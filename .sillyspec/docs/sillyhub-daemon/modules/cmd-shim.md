---
schema_version: 1
doc_type: module-card
module_id: cmd-shim
author: qinyi
created_at: 2026-08-18 01:45:00
---

# cmd 包装解析兼容层（cmd-shim）

## 定位
Windows 跨平台兼容层：解析 npm/cmd-shim 包生成的 `.cmd` 包装文件，提取真实可执行命令，让 daemon 用 `spawn(exe, [target, ...args])` 不依赖 shell 直启 agent CLI。解决 Node `spawn(cmd.cmd, args, {shell:true})` 在不同 shell（git-bash 启动 → ENOENT；PowerShell → stdout 被包装层吞掉）下行为不一致的问题。

## 契约摘要
- 唯一导出：`resolveWindowsCmdShim(cmdPath): { exe, prependArgs } | null`。
  - `exe`：真实可执行文件（node.exe / claude.exe / powershell.exe 等）。
  - `prependArgs`：exe 后续固定位置参数（codex.js 路径等），**调用方须把 adapter.buildArgs() 的结果追加在 prependArgs 之后**，否则丢参数。
  - 非 Windows / 读失败 / 无模式匹配 → null（调用方回退原路径）。
- 消费方：task-runner（batch spawn）与 interactive（会话驱动 spawn）。

## 关键逻辑
```text
resolveWindowsCmdShim(cmdPath):
  非 win32 → null；flat = .cmd 全文压成单行
  模式0 powershell ... -File "<ps1>" %*（cursor-agent.cmd）
        → 先试 resolveCursorVersionEntry(ps1)：命中 versions/<latest>/ 则绕过坏 ps1
          返回 { nodeExe, [indexJs] }
        → 未命中则 System32 powershell.exe + [-NoProfile,-ExecutionPolicy,Bypass,-File,ps1]
  模式1 "%_prog%" "<target>" %*（codex.cmd，node+js）
        → exe = dp0\node.exe（缺则 process.execPath），prependArgs=[target]
  模式2 "<exe>" %*（claude.cmd，原生 exe）→ { exe, [] }
  全不中 → null          # expand() 展开 %dp0% / %SCRIPT_DIR%
```

## 注意事项
- cursor 特判（ql-20260620-002-f8c1）：官方 cursor-agent.ps1 的版本目录正则不匹配新版目录命名 YYYY.MM.DD-HH-MM-SS-commit → ps1 必 exit 1；若 ps1 同目录存在 `versions/<latest>/`（cursor 自更新结构）直接绕过 ps1 返回该目录的 node.exe + index.js。复用 cursor-version 模块的 `resolveCursorVersionEntry`。
- codex.cmd 是 `endLocal & goto ... & "%_prog%" "..." %*` 单行混合模式，不能按行首关键字跳过，故全文搜索包含 `%*` 的双引号命令。
- `%_prog%` 静态解析时优先 `%dp0%\node.exe`（nvm4w 全局目录通常自带），fallback `process.execPath`。
- 模式 2 匹配到的 exe 若仍含未展开 `%VAR%` 则视为无效返回 null（防半解析路径）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
