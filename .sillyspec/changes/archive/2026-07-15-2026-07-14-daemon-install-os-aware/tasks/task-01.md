---
id: task-01
title: Add PowerShell installer install.ps1
title_zh: 新增 PowerShell 安装脚本 install.ps1
author: qinyi
created_at: 2026-07-14 23:08:31
priority: P0
depends_on: []
blocks: [task-03, task-04, task-08]
allowed_paths:
  - sillyhub-daemon/scripts/install.ps1
---

## goal
新增 PowerShell 安装脚本，复刻 install.sh 全逻辑，让 Windows 用户在 cmd/PowerShell 一行 `irm | iex` 装上 daemon（覆盖 FR-02, FR-05, D-001@v1, D-003@v1, DG-04）。

## implementation
- PowerShell 5.1+ 语法，CRLF 换行，脚本内用 `{{SERVER_URL}}` 占位（后端 dist_router 动态替换）
- 函数对齐 sillyhub-daemon/scripts/install.sh：
  - Test-NodeVersion：`Get-Command node` → 回退注册表 `HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment` PATH 查 node.exe → 无则提示装 Node ≥ 20 退出
  - Get-LatestManifest：`irm {{SERVER_URL}}/daemon/latest.json` 取 version/downloadUrl
  - Download-Bundle：`Invoke-WebRequest` 下载 sillyhub-daemon.js **与 mcp-server.js** 到 `$env:USERPROFILE\.sillyhub\daemon\bin\`
  - Write-CmdWrapper：写 sillyhub-daemon.cmd（node.exe 绝对路径兜底 + `%~dp0` 自相对 bundle）
  - Save-Config：写 config.json（server_url 内嵌 + 新 runtime_id UUID + poll/heartbeat/max_concurrent/log_level/default_timeout，对齐 install.sh save_server_url 字段集）
  - Set-Path：`setx PATH` 幂等（先查 %PATH% 再设）
  - Invoke-Verify：`node sillyhub-daemon.js --version`
- 装完打印下一步 `sillyhub-daemon start --api-key <你的 API Key>`，**不自动 start**（DG-04，对齐 install.sh 无 --server 时不 start）
- 头部注释提示：`irm | iex` 在当前会话执行不受 ExecutionPolicy Restricted 限制；环境仍拦则 `Set-ExecutionPolicy -Scope Process Bypass`

## 验收标准
- [ ] 脚本含 `{{SERVER_URL}}` 占位（后端可替换）
- [ ] 下载 sillyhub-daemon.js + mcp-server.js（D-003，team 主 agent MCP 依赖）
- [ ] 写 config.json + sillyhub-daemon.cmd wrapper + setx PATH
- [ ] 不自动 start，打印下一步提示（DG-04）
- [ ] 文件为 CRLF 换行

## verify
- 静态：检查 `{{SERVER_URL}}` 占位存在、逻辑覆盖 install.sh 全步、CRLF
- 真实执行：task-08 在真实 Windows PowerShell 手动验证

## constraints
- PowerShell 5.1+（Win10 自带，irm/iex 可用）
- 不依赖 MSYS（用 Windows 原生路径 `$env:USERPROFILE\.sillyhub\daemon`）
- 对齐 install.sh 字段集与 mcp-server.js 下载（D-003）
