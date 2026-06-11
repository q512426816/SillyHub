---
author: qinyi
created_at: 2026-06-10T00:00:00
---

# SillyHub Daemon -- 外部集成

## 上游：SillyHub Server (FastAPI 后端)

### REST API 集成
- **注册**: `POST /api/daemon/register` -- 注册 runtime（含 provider、protocol、capabilities）
- **心跳**: `POST /api/daemon/heartbeat` -- 定期上报存活状态（默认 15 秒间隔）
- **Lease 声明**: `POST /api/daemon/leases/{lease_id}/claim` -- 认领待执行任务
- **Lease 启动**: `POST /api/daemon/leases/{lease_id}/start` -- 标记任务开始
- **Lease 心跳**: `POST /api/daemon/leases/{lease_id}/heartbeat` -- 续约
- **消息上报**: `POST /api/daemon/leases/{lease_id}/messages` -- 流式事件转发
- **Lease 完成**: `POST /api/daemon/leases/{lease_id}/complete` -- 上报最终结果（含 diff）

### WebSocket 集成
- **连接**: `ws(s)://<server>/api/daemon/ws?runtime_id=<id>`
- **接收**: `daemon:task_available`（任务通知）、`daemon:heartbeat`（心跳确认）
- **发送**: `daemon:register`、`daemon:heartbeat_ack`、`daemon:lease_claim` 等
- 协议常量定义在 `protocol.py`，必须与 `backend/app/modules/daemon/protocol.py` 保持同步

### 认证
- Bearer Token 认证，通过 `--token` CLI 选项传入
- Token 持久化到 `~/.sillyhub/daemon/config.json`
- HTTP 客户端 `trust_env=False`，绕过系统代理

## 下游：本地 Agent CLI (12 种 Provider)

### Agent 二进制检测
- 环境变量覆盖：`SILLYHUB_<PROVIDER>_PATH`（如 `SILLYHUB_CLAUDE_PATH`）
- PATH 查找：`shutil.which()` 作为后备
- 版本检测：`<binary> --version` + 正则匹配

### 支持的 Provider 及协议

| Provider | 二进制名 | 协议 | 最低版本 |
|----------|----------|------|----------|
| claude | claude | stream_json | 2.0.0 |
| codex | codex | json_rpc | 0.100.0 |
| copilot | copilot | jsonl | 1.0.0 |
| gemini | gemini | stream_json | - |
| cursor | cursor-agent | stream_json | - |
| hermes | hermes | json_rpc | - |
| kimi | kimi | json_rpc | - |
| kiro | kiro-cli | json_rpc | - |
| opencode | opencode | ndjson | - |
| openclaw | openclaw | ndjson | - |
| pi | pi | ndjson | - |
| antigravity | agy | text | - |

### 子进程交互模式
- `asyncio.create_subprocess_exec` 创建子进程
- stdin 写入 prompt（JSON 或纯文本）
- stdout 逐行读取并解析为结构化事件
- stderr 后台 drain 防止管道阻塞
- 超时控制（默认 10 秒）+ 进程 kill 兜底

## 本地文件系统

### 配置与数据目录
- `~/.sillyhub/daemon/config.json` -- 守护进程配置
- `~/.sillyhub/daemon/credentials.json` -- 凭证存储（mode 0600）
- `~/.sillyhub/daemon/daemon.pid` -- 进程 PID 文件
- `~/.sillyhub/daemon/daemon.log` -- 运行日志
- `~/.sillyhub/daemon/workspaces/` -- 工作空间镜像目录

### Git 操作
- `git clone -b <branch> <repo_url> <dir>` -- 首次克隆
- `git pull --ff-only` -- 更新工作空间
- `git status --porcelain` -- 检测变更
- `git diff --shortstat` / `git diff` -- 收集变更统计和补丁

## 跨平台兼容

- Windows: `_on_rmtree_error` 处理 git objects 的只读文件删除
- 进程检测: `os.kill(pid, 0)` 跨平台检查
- PID 文件路径: 使用 `pathlib.Path` 确保 Windows/Linux 兼容
