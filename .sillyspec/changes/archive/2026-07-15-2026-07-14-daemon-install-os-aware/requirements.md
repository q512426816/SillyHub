---
author: qinyi
created_at: 2026-07-14 23:03:19
---

# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| Windows 用户 | 在 cmd / PowerShell 装 daemon，要求一行命令直接可用 |
| macOS / Linux 用户 | 在终端装 daemon，沿用 curl\|bash，行为不变 |
| 远程部署者 | 浏览器 OS 与 daemon 目标机器 OS 不同，需手动切命令 |

## 功能需求

### FR-01: 前端按操作系统自动检测并显示对应安装命令
覆盖决策：D-002@v1
Given 用户打开 `/runtimes` 页面且 `InstallDaemonBlock` 已在客户端 mount
When 读取 `navigator.userAgent` 判定 OS（`/Win/` → Windows，其余 → unix）
Then 默认显示对应平台的安装命令（Windows → PowerShell 一行；unix → curl\|bash），首屏不渲染命令以避免 hydration 不一致

### FR-02: Windows 显示 PowerShell 一行（后端动态内嵌 server_url）
覆盖决策：D-001@v1, D-003@v1
Given OS 选中为 Windows 且 `serverUrl = window.location.origin` 已就绪
When 渲染 Windows 命令
Then 显示 `irm <serverUrl>/daemon/install.ps1 | iex`，并附琥珀提示「在 PowerShell 或 cmd 中运行」；复制按钮复制该命令

### FR-03: 提供 OS 手动切换开关
覆盖决策：D-002@v1
Given `InstallDaemonBlock` 展开
When 用户点击「macOS / Linux」或「Windows」切换按钮
Then 命令与提示切换为对应平台；默认选中值跟随 FR-01 自动检测，可被手动覆盖

### FR-04: macOS / Linux 命令保持现状
覆盖决策：D-001@v1
Given OS 选中为 unix
When 渲染命令
Then 显示 `curl -fsSL <serverUrl>/daemon/install.sh | bash -s -- --server-url <serverUrl>`（与现状逐字一致），无 PowerShell 提示

### FR-05: install.ps1 复刻 install.sh 全逻辑（含 mcp-server.js）
覆盖决策：D-003@v1
Given Windows 用户执行 `irm <serverUrl>/daemon/install.ps1 | iex`
When install.ps1 运行
Then 完成：node ≥ 20 检测（Get-Command → 注册表 PATH）、拉 latest.json、下载 sillyhub-daemon.js **与 mcp-server.js**（team 主 agent MCP 依赖）、写 sillyhub-daemon.cmd wrapper、写 config.json（含内嵌 server_url + 新 runtime_id）、setx PATH（幂等）、`sillyhub-daemon --version` 验证通过；装完打印「`sillyhub-daemon start --api-key <key>`」下一步，不自动 start

### FR-06: 后端 GET /daemon/install.ps1 公开端点
覆盖决策：D-001@v1, D-003@v1
Given backend 镜像已打包 install.ps1 模板
When `GET /daemon/install.ps1`（无 /api 前缀）
Then 返回 200 + `Content-Type: application/x-powershell`，body 为模板且 `{{SERVER_URL}}` 已替换为推导地址；模板缺失返回 404

#### FR-06 边界：server_url 推导（DG-01）与注入防护（DG-03）
Given 请求经前端 rewrite 反代到达 backend
When 推导 server_url
Then scheme 取 `X-Forwarded-Proto`/`Forwarded: proto=` → 回退 `request.url.scheme`；host 取 `X-Forwarded-Host`/`Forwarded: host=` → 回退 `Host`；host 需通过正则白名单 `^[a-zA-Z0-9._:/-]+$`，不合规回退 `request.base_url`

## 非功能需求

- **兼容性**：macOS/Linux 链路零改动；`install.sh` 与 `/daemon/install.sh` 端点不动；所有 `/api/*`、DB 表、daemon WS/SSE 协议不变。
- **可回退**：旧镜像未打包 install.ps1 时端点 404，Windows 用户可回退开 Git Bash 跑 curl|bash（前端 404 降级提示列为可选）。
- **可测试**：前端 vitest 覆盖 OS 检测/切换/两 OS 命令；backend pytest 覆盖 `/install.ps1` 端点（200/404/占位替换/media_type/scheme/白名单）；install.ps1 真实执行在 verify 阶段真实 Windows PowerShell 手动验证。
- **跨平台**：install.ps1 仅 Windows 场景；源码 CRLF 由 `.gitattributes` 保证（DG-02）。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-02, FR-04, FR-05, FR-06 | Windows PowerShell 一行 + macOS/Linux 不变 + install.ps1 复刻 + 后端端点 |
| D-002@v1 | FR-01, FR-03 | 前端 UA 自动检测 + 手动切换 |
| D-003@v1 | FR-02, FR-05, FR-06 | install.ps1 含 mcp-server.js + 模板内嵌 server_url + PS 5.1+ |
