# 设计文档（Design）— daemon 安装命令按操作系统自适应

<!-- author: qinyi -->
<!-- created_at: 2026-07-14 22:53:27 -->
<!-- 变更: 2026-07-14-daemon-install-os-aware -->

## 1. 背景

daemon（守护进程）的一键安装命令展示在「运行时」页面（`/runtimes`）的 `InstallDaemonBlock` 折叠区块，当前对所有操作系统只给一条 bash 命令：

```
curl -fsSL <server>/daemon/install.sh | bash -s -- --server-url <server>
```

Windows 用户在 **cmd** 里复制粘贴这条命令会**完全没输出**，实测确认两个独立根因（均发生在 bash 脚本逻辑之外，`install.sh` 内的 `IS_WSL` 判定救不了）：

1. **cmd 的 `bash` 默认命中 WSL 入口** `C:\Windows\System32\bash.exe`（本机装了 Ubuntu-24.04），不是 Git Bash → 脚本经 cmd 管道 stdin 接不通 / 冷启动，根本没执行 → 无输出。
2. 即便用 Git Bash 全路径 `"C:\Program Files\Git\bin\bash.exe"` 绕开，cmd 启动模式下脚本里的 `curl` 命中 `/mingw64/bin/curl`（Git for Windows 原生 Windows curl，已 `which curl` 确认），不认 `/c/Users/...` MSYS 路径 → 下载步骤报 `No such file or directory`。试过 `--login`、前置 `usr\bin` 都无效（Git Bash 自身把 `/mingw64/bin` 重排到 PATH 前面）。

对照：在 Git Bash 终端里跑同一条命令 100% 成功。但要求所有 Windows 用户先开 Git Bash 终端、不在熟悉的 cmd/PowerShell 里跑，体验差且容易踩坑（用户最初就是因此在 cmd 里盲目复制无输出）。

根本诉求：**给 Windows 用户一条在其原生终端（PowerShell/cmd）能直接跑的安装命令**，前端按操作系统展示对应命令，避免盲目踩坑。

## 2. 设计目标（FR）

- **FR-1**：`InstallDaemonBlock` 在客户端 mount 后按 `navigator.userAgent` 自动检测访问者操作系统，默认显示对应平台的安装命令。
- **FR-2**：Windows 显示 PowerShell 一行 `irm <serverUrl>/daemon/install.ps1 | iex`；后端新增公开端点 `GET /daemon/install.ps1`，**动态生成** install.ps1 时把 `server_url` 内嵌进脚本（用户选定方案 A，命令最短）。
- **FR-3**：提供「macOS / Linux ｜ Windows」手动切换开关，默认值跟随 FR-1 自动检测，用户可手动覆盖（应对「浏览器 OS ≠ daemon 目标机器 OS」的远程部署场景）。
- **FR-4**：macOS / Linux 保持现有 `curl -fsSL <serverUrl>/daemon/install.sh | bash -s -- --server-url <serverUrl>` 不变。
- **FR-5**：`install.ps1` 复刻 `install.sh` 全部逻辑——node ≥ 20 检测、拉 `latest.json`、下载 `sillyhub-daemon.js` **及 `mcp-server.js`**（team 主 agent MCP 依赖）、写 `.cmd` wrapper、写 `config.json`、`setx PATH`、验证 `--version`；路径用 Windows 原生（`$env:USERPROFILE\.sillyhub\daemon`），不依赖 MSYS。
- **FR-6**：后端 `dist_router` 新增 `GET /daemon/install.ps1`，无 `/api` 前缀，与现有 `/daemon/install.sh` 一致；分发物经 Dockerfile 打进 `daemon-dist`。

## 3. 非目标

- **不改 `install.sh`** 及 macOS/Linux 的 `curl|bash` 链路（已验证可用）。
- **不展示 Git Bash 命令**（用户明确：Windows 只给 PowerShell 一行）。
- **不改 daemon 运行时生命周期**（register / heartbeat / lease / claim / session / agent_run 状态流转全部不动；`install.ps1` 仅在安装时落盘 + 可选启动，启动后走既有 daemon 流程）。
- 不做版本管理 / self-update / 多 provider 选择（已有功能，不属本变更）。
- 不引入 Ant Design 重组件到 `InstallDaemonBlock`（该组件现为 shadcn/ui 风格，切换开关沿用同风格，保持一致）。

## 4. 拆分判断

无需拆分、无需批量模式。单一功能点（安装命令按 OS 展示）、改动集中在 `InstallDaemonBlock` 单组件 + 一个新脚本 + 一个后端端点，任务数 < 10，无跨页面状态流转，单角色（装 daemon 的用户）。

## 5. 总体方案（用户选定方案 A）

**一句话**：后端动态生成 `install.ps1` 并内嵌 `server_url`，前端按 OS 切换显示 `irm | iex`（Windows）或 `curl | bash`（macOS/Linux）。

### 5.1 后端（backend）

- `dist_router.py` 新增 `GET /daemon/install.ps1`：
  - 不再纯静态 `FileResponse`，改为读 `daemon-dist/install.ps1` 模板 → 把 `{{SERVER_URL}}` 占位替换为请求推导出的 `server_url` → 返回（`media_type="application/x-powershell"`，`filename="install.ps1"`）。
  - `server_url` 推导优先级（**DG-01 修正**）：scheme 取 `X-Forwarded-Proto` / `Forwarded: proto=` → 回退 `request.url.scheme`；host 取 `X-Forwarded-Host` / `Forwarded: host=` → 回退 `Host` 头 → 拼 `<scheme>://<host>`。与前端 `window.location.origin` 一致（前端 rewrite 代理 `/daemon/*` 到 backend，backend 据请求头还原对外地址）。
  - **注入防护（DG-03）**：`server_url` 内嵌进 ps1 前用正则白名单校验 host（仅允 `[a-zA-Z0-9._:/-]`），不合规回退 `request.base_url`，避免伪造 Host 头注入 PowerShell。
  - 文件不存在 → 404（同 `install.sh` 契约）。
- `Dockerfile`：新增 `COPY --from=daemon scripts/install.ps1 /app/daemon-dist/install.ps1`（紧挨现有 `install.sh` COPY 行）。**注意换行（DG-02）**：PowerShell 偏好 CRLF；现有 `sed -i 's/\r$//'` 只针对 `install.sh`（bash 要 LF），**不能**对 `install.ps1` 去 CR。为防 git autocrlf 在 Windows 提交时把 CRLF 转 LF，新增 `.gitattributes` 规则 `sillyhub-daemon/scripts/install.ps1 text eol=crlf`；双保险：Dockerfile COPY 后 `sed 's/$/\r/'` 把 LF 兜底转 CRLF。

### 5.2 安装脚本（sillyhub-daemon）

- 新增 `sillyhub-daemon/scripts/install.ps1`，用 PowerShell 5.1+ 语法（Win10 自带，`irm`/`iex` 可用），逻辑与 `install.sh` 对齐：
  1. `Test-NodeVersion`：`Get-Command node` → 回退注册表 `HKLM\...\Environment` PATH 查 `node.exe` → 无则提示安装 Node ≥ 20 并退出。
  2. `Get-LatestManifest`：`irm <serverUrl>/daemon/latest.json` 取 `version` / `downloadUrl`（serverUrl 由模板内嵌，无参数）。
  3. `Download-Bundle`：`Invoke-WebRequest <serverUrl>/daemon/latest/sillyhub-daemon.js` → `$env:USERPROFILE\.sillyhub\daemon\bin\sillyhub-daemon.js`；同样下载 `mcp-server.js`（**FR-5 / D-003**，缺失则 team 主 agent MCP spawn 失败）。
  4. `Write-CmdWrapper`：写 `sillyhub-daemon.cmd`（`node "%~dp0sillyhub-daemon.js" %*` 风格，绝对路径兜底 node.exe）。
  5. `Save-Config`：写 `config.json`（含内嵌的 `server_url`、`runtime_id` 新 UUID、默认 poll/heartbeat/max_concurrent 等，对齐 `install.sh` 的 `save_server_url` 字段集）。
  6. `Set-Path`：`setx PATH` 把 bin 目录加到用户 PATH（幂等，先查再设）。
  7. `Invoke-Verify`：`node sillyhub-daemon.js --version` 验证。
  8. **不自动 start（DG-04）**：Windows 命令 `irm | iex` 不传参（对齐 install.sh 无 `--server` 时不 start 的行为），装完只打印下一步提示「`sillyhub-daemon start --api-key <你的 API Key>`」（server_url 已写 config.json，无需再传 `--server`）。
  - ExecutionPolicy 兜底：脚本头注释提示「`irm | iex` 在当前会话执行下载内容，不受 `ExecutionPolicy Restricted` 限制；若环境仍拦，管理员执行 `Set-ExecutionPolicy -Scope Process Bypass`」。

### 5.3 前端（frontend）

- `InstallDaemonBlock`（`page.tsx` 165-223）改造：
  - 复用现有 `mounted` state 模式：`useEffect` 里同时设 `serverUrl = window.location.origin` 与 `os = detectOs(navigator.userAgent)`（`Windows` → `"windows"`，其余 → `"unix"`），避免 SSR/客户端 hydration 不一致（**R-03**）。
  - 新增 `os` state（`"windows" | "unix"`）+ 手动切换 UI：shadcn 风格的两按钮 toggle（`macOS / Linux` | `Windows`），active 态高亮，点击 `setOs` 覆盖自动检测（**FR-3**）。
  - 命令按 `os` 分支：
    - `windows`：`irm ${serverUrl}/daemon/install.ps1 | iex` + 琥珀提示「⚠️ 在 PowerShell 或 cmd 中运行（开始菜单搜 PowerShell 打开后粘贴）」。
    - `unix`：现有 `curl -fsSL ${serverUrl}/daemon/install.sh | bash -s -- --server-url ${serverUrl}`（不变）。
  - 复制按钮复制当前 `os` 对应命令（`handleCopy` 用当前命令）。
  - 样式复用现有 dashed border / muted bg / `text-[11px]` / Terminal 图标 / outline Button（遵循 CLAUDE.md 规则 17 frontend-style-system）。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `sillyhub-daemon/scripts/install.ps1` | PowerShell 安装脚本，复刻 install.sh 逻辑，含 `{{SERVER_URL}}` 占位（CRLF） |
| 修改 | `backend/app/modules/daemon/dist_router.py` | 新增 `GET /install.ps1` 动态生成端点（读模板 + 替换占位 + 推导 server_url） |
| 修改 | `backend/Dockerfile` | 加 `COPY --from=daemon scripts/install.ps1 /app/daemon-dist/install.ps1`；确保不对 ps1 去 CR |
| 修改 | `backend/tests/test_daemon_dist.py` | 加 `test_install_ps1`：200 + 含内嵌 server_url + `application/x-powershell` + 模板占位已替换 |
| 修改 | `frontend/src/app/(dashboard)/runtimes/page.tsx` | `InstallDaemonBlock` 加 OS 检测 + 手动切换 + Windows PowerShell 命令 + 提示 |
| 新增 | `frontend` 同文件或 `__tests__` 下 vitest 用例 | OS 检测默认值 + 手动切换 + 两 OS 命令正确性 |

## 7. 接口定义

### 7.1 后端 `GET /daemon/install.ps1`（公开，无 /api 前缀）

- 请求：无参数；`server_url` 由 backend 据请求头推导（`X-Forwarded-Host` → `Host`）。
- 响应：`200`，`Content-Type: application/x-powershell`，body 为 install.ps1 文本（`{{SERVER_URL}}` 已替换为真实地址）；`404` 若镜像未打包 install.ps1。
- 实现签名（dist_router.py）：
  ```python
  @router.get("/install.ps1")
  async def get_install_ps1(request: Request) -> Response:
      """动态生成 PowerShell 安装脚本，内嵌 server_url（方案 A）。"""
      path = get_settings().daemon_dist_dir / "install.ps1"
      if not path.is_file():
          raise HTTPException(status_code=404, detail="install.ps1 not bundled in image")
      server_url = _derive_server_url(request)  # scheme(X-Forwarded-Proto)+host(X-Forwarded-Host→Host)+白名单校验,见 §5.1 DG-01/03
      body = path.read_text(encoding="utf-8").replace("{{SERVER_URL}}", server_url)
      return Response(content=body, media_type="application/x-powershell",
                      headers={"Content-Disposition": 'attachment; filename="install.ps1"'})
  ```

### 7.2 前端 `detectOs(ua: string): "windows" | "unix"`

- 纯函数，输入 `navigator.userAgent`，`/Win/i` 命中 → `"windows"`，否则 `"unix"`。便于单测。

## 7.5 生命周期契约表

**本变更虽含「daemon」关键词，但不引入任何 daemon 运行时生命周期事件。** `install.ps1` 是一次性安装脚本，仅在安装阶段：下载文件 → 写 `config.json` → 写 `.cmd` wrapper → `setx PATH` → 可选 `sillyhub-daemon start`。启动后的 daemon 仍走既有 `register / heartbeat / lease / claim / session / agent_run` 流程，这些事件的发起方 / 接收方 / 必需字段 / 状态变化**均不在本变更范围**，无新增、无改动。故生命周期契约表无新增行；现有契约见 `2026-07-12-team-main-agent-orchestration` / `2026-07-13-fix-interactive-session-zombie` 等已归档变更。

## 8. 数据模型

无表结构 / 字段变更。`config.json`（daemon 本地配置，非 DB）字段集与 `install.sh` 的 `save_server_url` 一致，不新增字段。

## 9. 兼容策略（brownfield）

- **macOS / Linux 完全不变**：仍展示并使用 `curl | bash` + `install.sh`，链路零改动。
- **Windows 回退**：若新镜像未打包 `install.ps1`（旧部署），`GET /daemon/install.ps1` 返回 404；前端 Windows 命令复制后用户执行会收到 404 提示，可回退到「开 Git Bash 跑 curl|bash」（前端可在 404 时给降级提示，**列为可选增强，非本变更硬性要求**）。
- **`install.sh` 与 `/daemon/install.sh` 端点不动**：Dockerfile 现有 `sed 's/\r$//' install.sh` 保持（bash 要 LF），只新增 install.ps1 的 COPY，互不干扰。
- 不改变的 API / 表：所有 `/api/*`、DB 表、daemon WS/SSE 协议。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 某些锁死环境 PowerShell `ExecutionPolicy` 拦截脚本执行 | P2 | `irm \| iex` 在当前会话执行下载内容不受 `Restricted` 限制；install.ps1 头注释给 `Set-ExecutionPolicy -Scope Process Bypass` 兜底提示 |
| R-02 | `install.ps1` 是新脚本，CI（Linux）跑不了 PowerShell，无法自动化回归 | P1 | backend 单测只验端点（200 + 占位替换 + media_type）；install.ps1 真实执行留 verify 阶段在真实 Windows PowerShell 手动验证（装一遍 + `sillyhub-daemon --version`） |
| R-03 | Next.js SSR 首屏 `navigator.userAgent` 与客户端不一致（hydration mismatch） | P2 | 沿用现有 `mounted` state 模式（`serverUrl` 已这么做），OS 在 `useEffect` 客户端设，首屏不渲染命令 |
| R-04 | `server_url` 推导在直连 / 反代 / https 终止差异下可能不准 | P2 | 推导优先级 `X-Forwarded-Proto`+`X-Forwarded-Host`/`Forwarded` → `Host`；前端用 `window.location.origin`，backend 据请求头还原，两者一致；verify 在 docker compose（反代）场景实测 |
| R-05 | git autocrlf 在 Windows 把 install.ps1 的 CRLF 转 LF → PowerShell 解析异常 | P2 | `.gitattributes` 标注 `eol=crlf` + Dockerfile COPY 后 sed 加 CR 双保险（DG-02） |

## 11. 决策追踪

| 决策 ID | 内容摘要 | 覆盖 FR / 章节 | 状态 |
|---|---|---|---|
| D-001@v1 | Windows 安装命令用 PowerShell 一行 `irm <serverUrl>/daemon/install.ps1 \| iex`，新增 install.ps1 + 后端动态端点；macOS/Linux 保持 curl\|bash | FR-2, FR-4, FR-5, FR-6 / §5 | 已确认（用户 Step 6 拍板） |
| D-002@v1 | 前端默认按 `navigator.userAgent` 自动检测 OS + 提供「macOS/Linux ｜ Windows」手动切换（应对浏览器 OS ≠ daemon 目标 OS 的远程部署） | FR-1, FR-3 / §5.3 | 已确认（用户 Step 7 拍板） |
| D-003@v1 | install.ps1 必须对齐 install.sh 下载 `mcp-server.js`（team 主 agent MCP 依赖），server_url 经模板内嵌（无参数），PowerShell 5.1+ | FR-2, FR-5 / §5.2, §7 | 自查确认（代码依据：`install.sh:254-262` 下 mcp-server.js；`dist_router.py:62` mcp 端点） |

无未解决决策。剩余风险见 §10。

## 12. 自审

- **需求覆盖**：对话式探索确认的需求（Windows 原生命令 + 手动 OS 切换 + macOS/Linux 不变）→ FR-1~FR-6 全覆盖。✅
- **Grill 覆盖**：decisions.md 含 D-001~D-003，design §11 逐一引用并映射 FR/章节。✅
- **约束一致性**：前端沿用 shadcn/ui 风格 + `mounted` 模式 + 中文文案（frontend.md / CLAUDE.md 规则 12/17）；后端沿用 `dist_router` 公开端点无 `/api` 前缀契约（dist_router.py 现有模式）；local.yaml lint/test 命令不变。✅
- **真实性**：文件名 / 方法名 / 端点 / Dockerfile COPY / `daemon_dist_dir` / `mcp-server.js` 依赖均来自真实代码（`dist_router.py`、`Dockerfile:93-98`、`install.sh:254-262`）；新增项（install.ps1、`get_install_ps1`、`detectOs`、`_derive_server_url`）已标注「新增」。✅
- **YAGNI**：未引入 Git Bash 命令展示、未做 404 降级提示硬性要求（列为可选）、未改 install.sh、未动 daemon 运行时。✅
- **验收标准**：FR 均可测——前端 vitest 验 OS 检测/切换/命令；backend `test_daemon_dist.py` 验 `/install.ps1`；install.ps1 真实 Windows 执行验 `--version`。✅
- **非目标清晰**：§3 明确 5 项不做。✅
- **兼容策略**：§9 说明 macOS/Linux 不变 + Windows 404 回退 + install.sh 不动。✅
- **风险识别**：§10 列 R-01~R-04 含对策。✅
- **生命周期契约表**：§7.5 已含本章节，如实说明不引入运行时生命周期事件（虽含 daemon 关键词但非 lifecycle/claim/heartbeat 语义）。✅

自审通过，进入下一步。
