---
plan_level: full
author: qinyi
created_at: 2026-07-14 23:08:31
---

# 实现计划（Plan）

> Spike 前置验证：无。技术不确定性（PowerShell 写法 / 动态端点 / CRLF / scheme 推导 / 注入防护）已在 design §5 + Grill DG-01~04 明确，task-08 verify 手动覆盖真实执行不确定性（R-02）。

## Wave 1（并行，无依赖）

- [x] task-01: 新增 sillyhub-daemon/scripts/install.ps1（覆盖：FR-02, FR-05, D-001@v1, D-003@v1, DG-04）
- [x] task-02: 新增 .gitattributes 规则 install.ps1 eol=crlf（覆盖：DG-02）
- [x] task-06: 前端 InstallDaemonBlock OS 检测 + 手动切换 + Windows PowerShell 命令（覆盖：FR-01, FR-02, FR-03, FR-04, D-002@v1）

## Wave 2（依赖 Wave 1）

- [x] task-03: backend dist_router 新增 GET /install.ps1 + _derive_server_url（依赖 task-01 模板）（覆盖：FR-06, DG-01, DG-03）
- [x] task-04: backend Dockerfile COPY install.ps1 + CRLF 兜底（依赖 task-01）（覆盖：FR-06, DG-02）
- [x] task-07: 前端 vitest（OS 检测默认 / 手动切换 / 两 OS 命令 / 复制）（依赖 task-06）（覆盖：FR-01, FR-03）

## Wave 3（依赖 Wave 2）

- [x] task-05: backend test_daemon_dist.py 加 /install.ps1 用例（依赖 task-03）（覆盖：FR-06, DG-01, DG-03）
- [ ] task-08: verify 手动真实 Windows PowerShell 跑 install.ps1（依赖 task-01, task-03, task-04）（覆盖：FR-02, FR-05）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 新增 sillyhub-daemon/scripts/install.ps1 | W1 | P0 | — | FR-02, FR-05, D-001, D-003, DG-04 | PowerShell 安装脚本，复刻 install.sh（node 检测/latest.json/下载 sillyhub-daemon.js+mcp-server.js/.cmd wrapper/config.json/setx PATH/--version），含 `{{SERVER_URL}}` 占位，CRLF，不自动 start |
| task-02 | 新增 .gitattributes | W1 | P1 | — | DG-02 | `sillyhub-daemon/scripts/install.ps1 text eol=crlf`（防 git autocrlf 破坏 CRLF） |
| task-03 | dist_router GET /install.ps1 + _derive_server_url | W2 | P0 | task-01 | FR-06, DG-01, DG-03 | 动态读模板替换 `{{SERVER_URL}}`；scheme=X-Forwarded-Proto→request.url.scheme；host=X-Forwarded-Host→Host + 正则白名单不合规回退 base_url；media_type application/x-powershell |
| task-04 | Dockerfile COPY install.ps1 + sed CRLF 兜底 | W2 | P0 | task-01 | FR-06, DG-02 | `COPY --from=daemon scripts/install.ps1 /app/daemon-dist/install.ps1` + COPY 后 `sed 's/$/\r/'` 兜底 CRLF；不并入现有 install.sh 的去 CR sed |
| task-05 | test_daemon_dist.py /install.ps1 用例 | W3 | P0 | task-03 | FR-06, DG-01, DG-03 | test_install_ps1（200 + 占位已替换 + application/x-powershell）+ test_install_ps1_server_url_derivation（X-Forwarded-Proto/Host + 白名单拒非法 host）+ 404（模板缺失） |
| task-06 | 前端 InstallDaemonBlock 改造 | W1 | P0 | — | FR-01~04, D-002 | detectOs(ua) 纯函数 + os state（mounted 设值，同 serverUrl 模式）+ 「macOS/Linux ｜ Windows」切换 UI（shadcn 风格）+ 命令按 os 分支 + Windows 琥珀提示 |
| task-07 | 前端 vitest | W2 | P0 | task-06 | FR-01, FR-03 | detectOs 默认（Windows/unix UA）+ 手动切换覆盖 + 两 OS 命令正确性 + 复制当前命令 |
| task-08 | verify 手动 Windows PowerShell | W3 | P1 | task-01, task-03, task-04 | FR-02, FR-05 | 部署后真实 `irm <serverUrl>/daemon/install.ps1 \| iex`，验证下载 sillyhub-daemon.js+mcp-server.js + config.json + `sillyhub-daemon --version`（CI Linux 跑不了 ps1） |

## 关键路径

- 后端主线：task-01 → task-03 → task-05
- 部署验证主线：task-01 → task-04 → task-08
- 前端主线（并行独立）：task-06 → task-07

最长路径 task-01 → task-03 → task-05 → task-08（决定交付周期）。

## 全局验收标准

- [x] backend 新测全绿：`cd backend && uv run pytest tests/test_daemon_dist.py -q`
- [x] backend lint + mypy 绿：`cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [x] 前端新测全绿：`cd frontend && pnpm test`（含 InstallDaemonBlock OS 检测/切换用例）
- [x] 前端 lint + typecheck 绿：`cd frontend && pnpm lint && pnpm typecheck`
- [x] macOS/Linux 命令逐字不变（FR-04 回归零影响）
- [ ] （verify 手动，task-08）真实 Windows PowerShell `irm | iex` 装上 daemon，`sillyhub-daemon --version` 通过
- [x] （brownfield）未部署新镜像时 macOS/Linux 用户与旧 Windows 用户体验不变（Windows 命令在新镜像才可用）

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-03, task-04, task-05, task-06 | install.ps1 + /install.ps1 端点 + Dockerfile 分发 + 前端 Windows 命令 |
| D-002@v1 | task-06, task-07 | detectOs 自动检测 + 手动切换开关 |
| D-003@v1 | task-01, task-05 | install.ps1 含 mcp-server.js + `{{SERVER_URL}}` 模板内嵌 |
| DG-01 | task-03, task-05 | _derive_server_url scheme=X-Forwarded-Proto + 测试 |
| DG-02 | task-02, task-04 | .gitattributes eol=crlf + Dockerfile sed 兜底 |
| DG-03 | task-03, task-05 | host 正则白名单 + 测试拒非法 host |
| DG-04 | task-01 | install.ps1 不自动 start，打印下一步提示 |
