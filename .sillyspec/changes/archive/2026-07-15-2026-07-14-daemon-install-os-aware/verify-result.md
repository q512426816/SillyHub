---
author: qinyi
created_at: 2026-07-15 07:58:17
---

# 验证报告

## 结论

**PASS WITH NOTES**

代码实现完整、单测全绿、设计一致性达成。唯一未覆盖项是 task-08（真实 Windows PowerShell 端到端执行），属设计时已明确的手动验证项（R-02，CI Linux 跑不了 PowerShell），需用户部署含 task-04 的新镜像后手动跑一次。

## 任务完成度

| 任务 | 状态 | 证据 |
|---|---|---|
| task-01 install.ps1 | ✅ | 脚本含 `{{SERVER_URL}}` 占位 + 下载 mcp-server.js（D-003）+ 不自动 start（DG-04），静态核验 |
| task-02 .gitattributes | ✅ | `sillyhub-daemon/scripts/install.ps1 text eol=crlf`，不破坏其他规则 |
| task-03 dist_router GET /install.ps1 | ✅ | `_derive_server_url`（scheme+host+白名单）+ 端点 200/404，9 passed 覆盖 |
| task-04 Dockerfile | ✅ | COPY install.ps1 + sed CRLF 兜底，install.sh 去 CR 逻辑不动（静态核验，docker build 待部署） |
| task-05 backend 测试 | ✅ | 4 用例（200/404/占位/scheme/白名单）全过 |
| task-06 前端 InstallDaemonBlock | ✅ | detectOs + os state + 切换 + 两 OS 命令 + Windows 提示，13 passed |
| task-07 前端 vitest | ✅ | 13 用例（detectOs 5 UA + 组件 8 渲染/交互）全过 |
| task-08 真实 Windows PowerShell | ⚠️ cannot_verify | R-02：CI Linux 跑不了 PowerShell，待用户部署新镜像手动 `irm \| iex` 验证 |

## 设计一致性

实现与 design.md 完全一致：
- **FR-01** 前端 `navigator.userAgent` 检测（`detectOs`）✓
- **FR-02** Windows `irm <serverUrl>/daemon/install.ps1 | iex` + 后端动态端点 ✓
- **FR-03** 「macOS/Linux ｜ Windows」手动切换 ✓
- **FR-04** macOS/Linux `curl|bash` 逐字不变 ✓
- **FR-05** install.ps1 复刻 install.sh 含 mcp-server.js ✓
- **FR-06** `GET /daemon/install.ps1` 公开端点（无 /api 前缀）✓
- **DG-01** scheme=X-Forwarded-Proto→request.url.scheme ✓
- **DG-02** .gitattributes eol=crlf + Dockerfile sed 兜底 ✓
- **DG-03** host 正则白名单 `^[a-zA-Z0-9._:/-]+$` 不合规回退 ✓
- **DG-04** install.ps1 不自动 start，打印下一步 ✓

## 探针结果

- backend `GET /daemon/install.ps1`：单测用 httpx AsyncClient 真实调用，200 + `application/x-powershell` + `{{SERVER_URL}}` 已替换 ✓
- server_url 推导：X-Forwarded-Proto: https + X-Forwarded-Host: example.com → body 含 `https://example.com` ✓
- 注入防护：恶意 host（`evil.com'; rm -rf /`）→ 回退 base_url，body 不含恶意串 ✓
- 404：daemon_dist_dir 无 install.ps1 → 404 ✓
- 前端：Windows UA → 渲染 `irm|iex` + PowerShell 提示；mac/linux UA → `curl|bash`；手动切换覆盖 ✓

## 测试结果

- **backend** `tests/test_daemon_dist.py`：**9 passed**（含 task-05 新增 4 个 /install.ps1 用例）
- **backend** `ruff check` + `ruff format --check` + `mypy app/modules/daemon/dist_router.py`：全绿
- **frontend** `install-daemon-os.test.tsx`：**13 passed**
- **frontend** `tsc --noEmit`（typecheck）：无错误
- **frontend** `next lint`：无本次变更文件的 error/warning（预存 no-unused-vars Warning 属其他文件，非本次引入）
- **sillyhub-daemon** install.ps1：静态核验（本机 Git Bash 无法执行 .ps1，真实执行留 task-08）

## 变更风险等级

**medium**。本变更改 daemon **安装命令展示 + 安装脚本静态分发链路**（前端展示 + dist_router 端点 + install.ps1 脚本 + Dockerfile 打包），属安装/部署链路。不改 daemon 运行时生命周期（见下方判定说明）。macOS/Linux 链路零改动（回归零影响）。

## Runtime Evidence（deployment-critical）

端点集成证据（单测级，真实调用）：
- `test_install_ps1`：httpx AsyncClient 真实 `GET /daemon/install.ps1` → 200 + `content-type: application/x-powershell` + body 不含 `{{SERVER_URL}}`（占位真实替换）
- `test_install_ps1_server_url_derivation`：带 `X-Forwarded-Proto: https` + `X-Forwarded-Host: example.com` → body 含 `https://example.com`（DG-01 scheme 推导真实生效）
- `test_install_ps1_rejects_malicious_host`：带恶意 host 头 → 回退 base_url，body 不含 `evil.com` / `rm -rf`（DG-03 注入防护真实生效）
- 前端：`detectOs` 5 UA 用例（Windows NT/Win32/大小写 → windows；macOS/Linux/空 → unix）+ InstallDaemonBlock 8 渲染交互用例（Windows/mac/linux UA 渲染 + 手动切换 + 复制）

⚠️ **未覆盖（NOTES，需用户手动）**：真实部署端到端——
1. `docker compose build backend`（含 task-04 Dockerfile：COPY install.ps1 + sed CRLF）+ `up -d backend`
2. Windows PowerShell 跑 `irm http://<server>/daemon/install.ps1 | iex`
3. 验证：`$env:USERPROFILE\.sillyhub\daemon\bin\` 含 sillyhub-daemon.js + mcp-server.js；`config.json` 含 server_url；新终端 `sillyhub-daemon --version` 返回 0.1.0

这是 task-08（R-02），CI Linux 跑不了 PowerShell，必须真实 Windows 手动。

## deployment-critical 判定说明

本变更虽含「daemon」关键词，但属 daemon **安装命令展示 + 静态安装脚本分发**，不改 daemon 运行时生命周期（register / heartbeat / lease / claim / session / agent_run 状态流转全部不动，design §7.5 已论证）。install.ps1 是静态脚本文件（经 Dockerfile COPY 进 daemon-dist），dist_router `/install.ps1` 端点仅做模板 `{{SERVER_URL}}` 占位替换，不涉及 daemon 运行时状态。核心契约（端点 200/404 + scheme/host 推导 + 注入白名单 + 占位替换 + macOS/Linux 回归零影响）已由 9 个单测覆盖。真实 Windows PowerShell 执行（task-08）是部署/手动验证环节（R-02，设计时明确），非代码逻辑风险。综合判定：代码逻辑 PASS，部署端到端 WITH NOTES（待 task-08 手动）。
