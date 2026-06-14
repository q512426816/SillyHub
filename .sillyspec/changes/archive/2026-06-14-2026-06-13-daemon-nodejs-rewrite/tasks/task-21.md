---
author: qinyi
created_at: 2026-06-14T00:08:01+0800
id: task-21
title: CLI（src/cli.ts，commander: start/stop/status/logs）
priority: P0
estimated_hours: 3
depends_on: [task-20, task-12]
blocks: [task-22, task-23]
allowed_paths:
  - sillyhub-daemon/src/cli.ts
  - sillyhub-daemon/package.json
---

# task-21: CLI（src/cli.ts，commander: start/stop/status/logs）

> 变更：`2026-06-13-daemon-nodejs-rewrite` · Wave W5（CLI + 冒烟 + 收尾）· 依赖 task-20（Daemon 主类）。
> 对应 design.md §5.2 W5「CLI + 真实冒烟」、§4.3 CLI Commands。
> 对应 requirements FR-09（npm i -g 安装 + CLI 可用）。
> 替代 Python 源 `sillyhub-daemon/sillyhub_daemon/__main__.py`（共 204 行，已逐行读完作为权威基准）。

本任务实现 daemon 的 CLI 入口，用 `commander` 替代 `click`，提供 4 个子命令：`start`、`stop`、`status`、`logs`。通过 `npm i -g sillyhub-daemon` 后可直接运行 `sillyhub-daemon start --server <url> --token <token>`。

被 task-22（测试迁移）依赖，因此 CLI 的输出格式和退出码必须与 Python 版行为等价。

## 修改文件

| 文件 | 动作 | 说明 |
|---|---|---|
| `sillyhub-daemon/src/cli.ts` | 新建 | commander CLI 入口，4 个子命令 |
| `sillyhub-daemon/package.json` | 修改 | 添加 `"bin": { "sillyhub-daemon": "dist/cli.js" }` |

## Python → TypeScript 对照

### 命令映射

| Python (click) | TypeScript (commander) | 说明 |
|---|---|---|
| `sillyhub-daemon start --server <url> --token <token>` | 同 | 启动 daemon，写 PID 文件 |
| `sillyhub-daemon stop` | 同 | 读 PID 文件，发 SIGTERM |
| `sillyhub-daemon status` | 同 | 显示运行状态、PID、runtime ID、server URL |
| `sillyhub-daemon logs [--tail N]` | 同 | 显示最后 N 行日志 |

### 辅助函数映射

| Python | TypeScript | 说明 |
|---|---|---|
| `_read_pid()` | `readPid(): number \| null` | 读 `~/.sillyhub/daemon/daemon.pid` |
| `_is_process_alive(pid)` | `isProcessAlive(pid: number): boolean` | `process.kill(pid, 0)` + try/catch |
| `_write_pid(pid)` | `writePid(pid: number): void` | 写 PID 文件 |
| `_remove_pid()` | `removePid(): void` | 删 PID 文件（best-effort） |

### 关键差异

1. **async 入口**：Python 用 `asyncio.run()`，Node.js 直接 `async function main()` + 顶层 await（ESM）
2. **信号处理**：Python `os.kill(pid, signal.SIGTERM)`，Node.js `process.kill(pid, 'SIGTERM')`
3. **进程存活检测**：Python `os.kill(pid, 0)`，Node.js `process.kill(pid, 0)` + catch `Error`
4. **日志路径**：与 Python 一致 `~/.sillyhub/daemon/daemon.log`

## 实现要点

### start 命令

```
1. 解析 --server、--token 参数
2. 创建 DaemonConfig，保存配置
3. 校验 token 存在（否则 stderr + exit(1)）
4. 实例化 HubClient、WorkspaceManager、CredentialManager、TaskRunner、Daemon
5. 写 PID 文件
6. 调用 daemon.start()
7. 注册 SIGINT/SIGTERM handler → daemon.stop() + removePid()
8. 保持进程运行（等待 daemon 停止）
```

### stop 命令

```
1. 读 PID 文件，不存在则 exit(1)
2. 检查进程存活，不存活则删 stale PID + exit(1)
3. process.kill(pid, 'SIGTERM')
```

### status 命令

```
1. 读 DaemonConfig
2. 读 PID 文件 + 检查存活
3. 输出格式（与 Python 完全一致）：
   State:       running | stopped | stopped (stale PID)
   PID:         <pid> | -
   Runtime ID:  <runtime_id>
   Server URL:  <server_url>
   Config dir:  ~/.sillyhub/daemon
```

### logs 命令

```
1. 读 ~/.sillyhub/daemon/daemon.log
2. --tail N（默认 50）
3. 输出最后 N 行
```

## 验收标准

- [x] `sillyhub-daemon start --server http://localhost:8000 --token test123` 能启动 daemon
- [x] `sillyhub-daemon status` 正确显示运行状态
- [x] `sillyhub-daemon stop` 能停止 daemon
- [x] `sillyhub-daemon logs --tail 10` 能显示日志
- [x] 输出格式与 Python 版完全一致
- [x] `npm i -g .` 后 `sillyhub-daemon` 命令可用
- [x] SIGINT (Ctrl+C) 正确触发优雅关闭
