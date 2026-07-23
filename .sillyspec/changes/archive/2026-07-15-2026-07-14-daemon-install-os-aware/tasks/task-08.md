---
id: task-08
title: Verify install.ps1 on real Windows PowerShell
title_zh: 真实 Windows PowerShell 手动验证 install.ps1
author: qinyi
created_at: 2026-07-14 23:08:31
priority: P1
depends_on: [task-01, task-03, task-04]
blocks: []
allowed_paths:
  - sillyhub-daemon/scripts/install.ps1
---

## goal
在真实 Windows PowerShell 跑通 `irm <serverUrl>/daemon/install.ps1 | iex`，验证 install.ps1 端到端可用（覆盖 FR-02, FR-05；R-02 手动验证）。

## implementation
- 前置：task-01（install.ps1）+ task-03（端点）+ task-04（Dockerfile 打包）完成，且新 backend 镜像已部署（docker compose up --build backend）
- 在 Windows PowerShell（开始菜单搜 PowerShell）执行：
  `irm http://<serverUrl>/daemon/install.ps1 | iex`
- 验证：
  - 脚本输出 node 检测 / latest 版本 / 下载 sillyhub-daemon.js + mcp-server.js / wrapper / config / PATH 各步
  - `$env:USERPROFILE\.sillyhub\daemon\bin\` 含 sillyhub-daemon.js + mcp-server.js + sillyhub-daemon.cmd
  - `~/.sillyhub/daemon/config.json` 含正确 server_url
  - 新开 PowerShell（让 setx PATH 生效）跑 `sillyhub-daemon --version` 返回 0.1.0
- 记录验证结果到 verify 报告（截图或日志）

## 验收标准
- [ ] `irm | iex` 全程无错跑完
- [ ] sillyhub-daemon.js + mcp-server.js 下载到 bin/
- [ ] config.json 含 server_url
- [ ] `sillyhub-daemon --version` 通过（新终端）

## verify
- 手动真实 Windows PowerShell 执行（CI Linux 跑不了 PowerShell，R-02）
- 结果记入 verify 阶段报告

## constraints
- 真实 Windows 环境（非 WSL/Linux）
- 需新镜像部署（含 task-04 的 install.ps1 打包）
- R-02：CI 无法自动化，必须手动
