# 决策台账（decisions）— daemon 安装命令按操作系统自适应

<!-- author: qinyi -->
<!-- created_at: 2026-07-14 22:53:27 -->
<!-- 变更: 2026-07-14-daemon-install-os-aware -->

> 本文件是本次变更的决策台账（非长期术语表）。只记录有实现/验收影响的决策。

---

## D-001@v1: Windows 安装命令用 PowerShell 一行（irm | iex）

- **type**: product / architecture
- **status**: confirmed
- **source**: brainstorm Step 6 对话式探索（用户 AskUserQuestion 拍板）
- **question**: daemon 安装命令在 Windows 上怎么展示？（cmd 跑 bash 脚本已确认走不通）
- **answer**: Windows 只给 PowerShell 一行 `irm <serverUrl>/daemon/install.ps1 | iex`；macOS/Linux 保持现有 `curl | bash` 不变。需新增 `install.ps1`（复刻 install.sh 逻辑）+ backend `GET /daemon/install.ps1` 分发端点。
- **normalized_requirement**: FR-2（Windows PowerShell 一行）、FR-4（macOS/Linux 不变）、FR-5（install.ps1 复刻 install.sh）、FR-6（后端公开端点）
- **impacts**:
  - 新增 `sillyhub-daemon/scripts/install.ps1`
  - 修改 `backend/app/modules/daemon/dist_router.py`（新增动态端点）
  - 修改 `backend/Dockerfile`（COPY install.ps1）
  - 修改 `frontend/.../runtimes/page.tsx` InstallDaemonBlock（Windows 命令分支）
- **evidence**:
  - cmd 跑 curl|bash 无输出根因实测（WSL bash 入口 + mingw curl 不认 /c 路径，见 design §1）
  - Git Bash 终端跑 curl|bash 100% 成功（已实测装好 daemon）
  - 现有 `dist_router.py` / `Dockerfile:98` install.sh 分发模式可复用
- **priority**: P0

---

## D-002@v1: 前端 OS 自动检测 + 手动切换开关

- **type**: product
- **status**: confirmed
- **source**: brainstorm Step 7 需求澄清 Grill（用户 AskUserQuestion 拍板）
- **question**: daemon 装到哪台机器的 OS 可能与打开浏览器的机器 OS 不一样（远程部署），要不要加手动切换 OS 的开关？
- **answer**: 加。默认按 `navigator.userAgent` 自动检测 OS 显示对应命令；额外提供「macOS / Linux ｜ Windows」手动切换开关，用户可覆盖自动检测。
- **normalized_requirement**: FR-1（UA 自动检测）、FR-3（手动切换覆盖）
- **impacts**:
  - `InstallDaemonBlock` 加 `os` state + `detectOs(ua)` 纯函数（mounted 后设值，避免 hydration 不一致）
  - 加 shadcn 风格两按钮 toggle UI
  - 命令与提示按 `os` 分支
- **evidence**:
  - 项目有远程 daemon 场景（本机即有连本地 + 连远程的 daemon 实例）
  - 浏览器 UA 是访问者 OS，非 daemon 目标机器 OS，纯自动会给错
- **priority**: P1

---

## D-003@v1: install.ps1 实现细节（对齐 install.sh / 模板内嵌 server_url / PS 5.1+）

- **type**: architecture
- **status**: confirmed（自查 + 用户方案 A 选择）
- **source**: brainstorm Step 7 Grill 自查 + Step 8 方案选择（方案 A：后端动态生成内嵌 server_url）
- **question**: install.ps1 怎么拿 server_url？mcp-server.js 要不要下？PowerShell 版本下限？
- **answer**:
  1. server_url 由后端动态生成 install.ps1 时内嵌（模板 `{{SERVER_URL}}` 占位替换，请求头推导），ps1 无参数；Windows 命令 = `irm <serverUrl>/daemon/install.ps1 | iex`（最短一行）。
  2. install.ps1 必须对齐 install.sh 下载 `mcp-server.js`（task-05/06 team 主 agent MCP 依赖，缺失则 MCP spawn 失败、5 tool 链路断）。
  3. PowerShell 5.1+（Win10 自带）支持 `irm`/`iex`；ExecutionPolicy Restricted 不影响 `irm|iex`。
- **normalized_requirement**: FR-2（命令最短）、FR-5（含 mcp-server.js）
- **impacts**:
  - `install.ps1` 含 `{{SERVER_URL}}` 占位 + CRLF 换行
  - `dist_router.get_install_ps1` 动态替换占位 + `_derive_server_url`（X-Forwarded-Host → Host）
  - Dockerfile 对 install.ps1 **不**执行去 CR（与 install.sh 的 sed 区分）
- **evidence**:
  - `install.sh:254-262` 下载 mcp-server.js
  - `dist_router.py:62` `get_mcp_server_bundle` 端点
  - 用户 Step 8 选方案 A（preview 命令 `irm <url>/daemon/install.ps1 | iex`）
- **priority**: P0
