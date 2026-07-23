---
author: qinyi
created_at: 2026-07-14 23:03:19
---

# 提案书（Proposal）

## 动机

daemon（守护进程）的一键安装命令在「运行时」页面只给一条 bash 命令 `curl | bash`，Windows 用户在熟悉的 **cmd / PowerShell** 里复制后**完全没输出**，被迫先开 Git Bash。要让 Windows 用户在其原生终端也能一行装上，前端按操作系统展示对应命令。

## 关键问题

1. **cmd 的 `bash` 默认是 WSL 入口**（`C:\Windows\System32\bash.exe`，非 Git Bash）→ 脚本经 cmd 管道 stdin 接不通 / 冷启动，根本没执行 → 无输出。
2. **即便用 Git Bash 全路径绕开**，cmd 启动模式下脚本里的 `curl` 命中 `/mingw64/bin/curl`（Git for Windows 原生 curl），不认 `/c/Users/...` MSYS 路径 → 下载步骤报 `No such file or directory`。两个坑都在 bash 脚本逻辑之外，脚本内 `IS_WSL` 判定救不了。

## 变更范围

- 前端 `InstallDaemonBlock` 按 `navigator.userAgent` 自动检测 OS + 「macOS/Linux ｜ Windows」手动切换。
- Windows 显示 PowerShell 一行 `irm <serverUrl>/daemon/install.ps1 | iex`。
- 后端 `dist_router` 新增 `GET /daemon/install.ps1`，**动态生成**（模板替换 `{{SERVER_URL}}`，scheme/host 推导 + 注入白名单）。
- 新增 `sillyhub-daemon/scripts/install.ps1`（PowerShell 安装脚本，复刻 install.sh：node 检测、下载 sillyhub-daemon.js + mcp-server.js、.cmd wrapper、config.json、setx PATH、--version 验证；不自动 start）。
- Dockerfile 打包 install.ps1（CRLF，`.gitattributes eol=crlf` + sed 兜底）。

## 不在范围内（显式清单）

- 不改 `install.sh` 及 macOS/Linux 的 `curl|bash` 链路（已验证可用）。
- 不展示 Git Bash 命令（Windows 只给 PowerShell 一行）。
- 不改 daemon 运行时生命周期（register/heartbeat/lease/claim/session/agent_run 全不动）。
- 不做 install.ps1 的 404 降级提示硬性要求（旧镜像未打包时，列为可选增强）。
- 不引入 Ant Design 重组件到 InstallDaemonBlock（保持 shadcn/ui 风格一致）。

## 成功标准（可验证）

- macOS/Linux 用户看到的命令与行为**完全不变**（回归零影响）。
- Windows 用户在 **PowerShell 或 cmd** 跑 `irm <serverUrl>/daemon/install.ps1 | iex` 能装上 daemon（下载 sillyhub-daemon.js + mcp-server.js、写 config.json、setx PATH、`sillyhub-daemon --version` 通过）——在真实 Windows PowerShell 手动验证。
- 前端默认按浏览器 OS 自动选中命令，可手动切换覆盖（远程部署场景）。
- backend `GET /daemon/install.ps1` 返回 200 + `application/x-powershell` + `{{SERVER_URL}}` 已替换为真实地址；模板缺失 404（单测覆盖）。
- server_url 推导含 scheme（`X-Forwarded-Proto`）+ 注入白名单（单测覆盖边界）。
