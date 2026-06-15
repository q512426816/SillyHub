---
author: qinyi
created_at: 2026-06-15T17:11:20
---

# SillyHub Daemon

本地任务执行守护进程。从平台 backend 拉取任务、在本机调用本地代理（Claude Code / Codex / Copilot 等）执行、把日志和结果回传。

当前实现是 **Node.js / TypeScript**（曾经是 Python，已在 task-21 重写为 TS，旧 `sillyhub_daemon/` Python 包目录是历史残留，不再使用）。

## 前置要求

- Node.js ≥ 20（`engines.node`）
- pnpm 9.6.0（推荐，`packageManager`）—— 没有 pnpm 也可改用 npm
- 本机已装好至少一个本地代理（`claude` / `codex` / `copilot` 等）

## 安装

> ⚠️ 如果之前装过 Python 旧版的 `sillyhub-daemon`（典型症状：本机 `Python3XX/Scripts/sillyhub-daemon.exe` 还在，运行报 `ModuleNotFoundError: No module named 'sillyhub_daemon.__main__'`），先卸载：

```bash
pip uninstall -y sillyhub-daemon sillyhub_daemon
# pip 找不到包时，直接删 entry point：
# Windows: del "%USERPROFILE%\AppData\Local\Programs\Python\Python3XX\Scripts\sillyhub-daemon.exe"
# macOS/Linux: rm ~/.local/bin/sillyhub-daemon
```

确认干净后，构建并全局链接本仓库：

```bash
cd sillyhub-daemon

# 推荐：pnpm
pnpm install
pnpm build          # 生成 dist/cli.js

# 没有 pnpm 时：npm
npm install
npx tsc             # 同样生成 dist/cli.js

# 全局链接，让 sillyhub-daemon 命令指向此项目
npm link

# 验证
sillyhub-daemon --version   # 应输出 0.1.0
```

> `npm link` 之后修改源码需要重新 `pnpm build`（或 `npx tsc`）才能生效。链接关系是一次性的，不依赖 dist 实时编译。

## 启动

最快的办法：登录平台 → 进入 `/runtimes` 页面 → 点右上角"复制命令"，得到一条形如：

```bash
sillyhub-daemon start --server http://127.0.0.1:8001 --token <ACCESS_TOKEN>
```

把这条命令粘到本机终端运行即可。`--token` 是登录后从平台获取的访问令牌，**不要手填**。

### `start` 全部选项

| 选项 | 说明 |
| --- | --- |
| `--server <url>` | 平台 backend 地址，例如 `http://127.0.0.1:8001` |
| `--token <token>` | 登录后从平台获取的 access token（必填） |
| `--workspace-dir <dir>` | workspace 工作目录基路径 |
| `--poll-interval <sec>` | HTTP 轮询间隔（秒） |
| `--heartbeat-interval <sec>` | WebSocket 心跳间隔（秒） |
| `--max-concurrent <n>` | 最大并发任务数 |
| `--log-level <level>` | 日志级别：`debug` / `info` / `warn` / `error` |

启动后进程会常驻，靠 SIGINT / SIGTERM 退出。PID 写入 `~/.sillyhub/daemon/daemon.pid`，日志写入 `~/.sillyhub/daemon/daemon.log`。

## 其他子命令

```bash
sillyhub-daemon status          # 查看运行状态（State/PID/Runtime ID/Server URL/Config dir）
sillyhub-daemon stop            # 向运行中的 daemon 发 SIGTERM
sillyhub-daemon logs [--tail N] # 查看最后 N 行日志，默认 50
```

## 配置文件路径

| 文件 | 路径 | 用途 |
| --- | --- | --- |
| 配置 | `~/.sillyhub/daemon/config.json` | `start` 选项会被持久化到这里，下次启动可作为默认值 |
| PID | `~/.sillyhub/daemon/daemon.pid` | 运行中进程的 PID |
| 日志 | `~/.sillyhub/daemon/daemon.log` | 全部运行日志 |
| Workspaces | `~/.sillyhub/daemon/workspaces/` | 任务工作区基目录 |

`~/.sillyhub/daemon/` 在所有平台上都展开为 `$HOME/.sillyhub/daemon`（Windows 上 `$HOME` 通常是 `C:\Users\<you>`）。

## 故障排查

**`sillyhub-daemon: command not found` 或 PowerShell 报"无法将 sillyhub-daemon 识别为 cmdlet"**
→ 没有跑 `npm link`，或 `npm link` 用的 Node 不在 PATH 里。重跑 `npm link`，用 `where sillyhub-daemon`（Windows）/ `which sillyhub-daemon`（Unix）确认命令位置。

**`ModuleNotFoundError: No module named 'sillyhub_daemon.__main__'`**
→ 还在调用旧 Python 实现的 entry point。按上文"安装"小节先 `pip uninstall`，删掉残留的 `sillyhub-daemon.exe`，再 `npm link`。

**`--token is required. Get one from the SillyHub web UI.`**
→ 没传 `--token`，或 token 为空。回到平台 `/runtimes` 页面复制命令，里面会带最新 token。

**复制命令里的 `--token` 报 401**
→ token 过期了（JWT 短期）。重新登录平台，再复制一次命令。

**daemon 启动了但 `/runtimes` 页面看不到 runtime**
→ 检查 `--server` 地址是否能从本机访问；查 `sillyhub-daemon logs` 看注册是否成功；浏览器刷新页面（列表 15 秒自动刷新一次）。

**`pnpm: command not found`**
→ 装 pnpm：`npm install -g pnpm@9.6.0`，或直接用 npm 替代（见"安装"小节）。

## 开发

```bash
pnpm dev          # tsc --watch，开发时实时编译
pnpm typecheck    # 仅类型检查
pnpm test         # vitest 全套
pnpm test:watch   # vitest watch 模式
```

源码组织（`src/`）：

- `cli.ts` —— 入口，commander 子命令分发
- `daemon.ts` —— 守护进程主循环（HTTP 轮询 + WS 心跳）
- `hub-client.ts` —— 平台 backend HTTP/WS 客户端
- `task-runner.ts` —— 拉取任务、调用 adapter 执行、回传日志/结果
- `workspace.ts` —— workspace 工作目录管理
- `credential.ts` —— 各 provider 的凭证/环境变量注入
- `agent-detector.ts` —— 探测本机已装的本地代理（claude/codex/copilot/...）
- `adapters/` —— 各 provider 的输出协议适配（stream-json / text / ndjson / jsonl）
- `config.ts` / `version.ts` —— 配置文件读写、版本最低校验
