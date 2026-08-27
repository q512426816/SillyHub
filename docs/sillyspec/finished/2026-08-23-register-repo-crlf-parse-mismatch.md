# local register-repo 写入 CRLF 与 parseRepoRegistry 读取不容 \r —— Windows 下跨仓注册永远「未注册」

- 日期：2026-08-23
- 状态：**活跃坑**（工具未修；本仓已用单行 LF 补丁绕过）
- 发现来源：变更 `2026-08-23-agent-activity-sessions` 启动 execute 报「repo 未注册」

## 现象

`sillyspec local register-repo sillyspec <path>` 成功写入 `.sillyspec/local.yaml` 的
`repos:` 段（该文件整体为 CRLF，写入器沿用了 CRLF 行尾），但随后启动 execute 仍报
`MultiRepoContext: 以下 repo 未在 local.yaml repos: 段注册：[sillyspec]`。

## 根因

- 写入侧 `local-register.js` 按既有文件行尾拼接（CRLF 文件 → 条目行带 `\r\n`）；
- 读取侧 `plan-postcheck.js parseRepoRegistry` 的条目正则
  `/^\s+([A-Za-z0-9_.\-]+):\s*(.*)$/` 中 `.*` 不匹配行终止符（JS 语义 `\r` 是行终止符），
  且 `$` 无 `m` flag 只匹配串尾——**尾部 `\r` 使整条正则失配，条目被静默跳过**；
- 段头正则 `/^repos:\s*(?:#.*)?$/` 因 `\s*` 恰好吞掉 `\r` 而存活，掩盖了问题（只有条目挂）。

## 影响

Windows（autocrlf=truetypically CRLF 的 local.yaml）下所有跨仓 repo 注册静默失效，
execute fail-closed 阻断，且报错文案引导用户重复 register-repo（写一遍还是 CRLF）死循环。

## 建议改进（工具侧）

`parseRepoRegistry` 三处任一即可：
1. 行统一 `line.replace(/\r$/, '')` 预处理；
2. 条目正则改 `/^\s+([A-Za-z0-9_.\-]+):[ \t]*(.*)$/`（值用 `[^\r]*` 或先行尾剥离）；
3. 写入侧 `local-register.js` 强制 LF 写该段。

## 绕过方式（当前）

把 `repos:` 条目行的行尾手工改为 LF（python 二进制替换该行 `\r\n` → `\n`），
解析即恢复；后续 register-repo 新增条目如再失效，同法补。
