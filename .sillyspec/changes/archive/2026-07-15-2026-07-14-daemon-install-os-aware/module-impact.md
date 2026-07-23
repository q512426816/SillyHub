# 模块影响分析（Module Impact）— daemon 安装命令按操作系统自适应

<!-- author: qinyi -->
<!-- created_at: 2026-07-15 08:02:32 -->
<!-- 变更: 2026-07-14-daemon-install-os-aware -->

## 受影响模块

| 模块 | 影响类型 | 说明 |
|---|---|---|
| **frontend** | 修改 | `InstallDaemonBlock` 组件加 OS 检测 + 手动切换 + Windows PowerShell 命令；新增 vitest |
| **backend** | 修改 | `dist_router` 新增 `GET /daemon/install.ps1` 动态端点 + `_derive_server_url`；Dockerfile 打包 install.ps1；test_daemon_dist 加用例 |
| **sillyhub-daemon** | 新增文件 | `scripts/install.ps1`（PowerShell 安装脚本，复刻 install.sh） |
| 仓库根 | 新增文件 | `.gitattributes`（install.ps1 eol=crlf） |

## 变更文件清单

| 操作 | 文件 | 模块 |
|---|---|---|
| 新增 | `sillyhub-daemon/scripts/install.ps1` | sillyhub-daemon |
| 新增 | `.gitattributes` | 仓库根 |
| 修改 | `backend/app/modules/daemon/dist_router.py` | backend |
| 修改 | `backend/Dockerfile` | backend |
| 修改 | `backend/tests/test_daemon_dist.py` | backend |
| 修改 | `frontend/src/app/(dashboard)/runtimes/page.tsx` | frontend |
| 新增 | `frontend/src/app/(dashboard)/runtimes/__tests__/install-daemon-os.test.tsx` | frontend |

## 对外契约变化

### 新增契约
- **`GET /daemon/install.ps1`**（backend，公开端点，无 `/api` 前缀）：动态生成 PowerShell 安装脚本，`{{SERVER_URL}}` 占位替换为推导地址；`Content-Type: application/x-powershell`；模板缺失 404。与现有 `GET /daemon/install.sh` 并列。
- **`detectOs(ua): "windows" \| "unix"`**（frontend，export 纯函数）：供 InstallDaemonBlock 与单测消费。

### 不变的契约
- `GET /daemon/install.sh` / `/latest.json` / `/latest/sillyhub-daemon.js` / `/latest/mcp-server.js` 全部不动。
- macOS/Linux 的 `curl | bash` 安装链路逐字不变（FR-04 回归零影响）。
- daemon 运行时生命周期（register/heartbeat/lease/claim/session/agent_run）不变（design §7.5）。
- 所有 `/api/*`、DB 表、daemon WS/SSE 协议不变。

## 接口/数据模型变化

无 DB schema 变更。`config.json`（daemon 本地配置，非 DB）字段集与 install.sh 一致，不新增。

## 跨模块依赖

- frontend 展示的 Windows 命令 `irm <serverUrl>/daemon/install.ps1 | iex` 依赖 backend `/install.ps1` 端点（task-03）+ Dockerfile 打包 install.ps1（task-04）。
- install.ps1（sillyhub-daemon）下载 `sillyhub-daemon.js` + `mcp-server.js`（backend 现有端点，不变）。
- `.gitattributes` 保证 install.ps1 在 git 保持 CRLF（DG-02），Dockerfile sed 兜底。

## 模块文档需同步

- `modules/frontend.md`：InstallDaemonBlock OS 检测/切换 + detectOs export + install-daemon-os.test.tsx。
- `modules/backend.md`：dist_router /install.ps1 端点 + _derive_server_url。
- `modules/sillyhub-daemon.md`：scripts/install.ps1（PowerShell 安装脚本，与 install.sh 并列）。
- `_module-map.yaml`：backend/frontend/sillyhub-daemon 的 main_symbols/entrypoints 补 install.ps1 相关。
