---
schema_version: 1
doc_type: module-card
module_id: cli
author: qinyi
created_at: 2026-06-10T16:55:00
---

# cli

## 定位
命令行入口点。基于 commander 提供 start / stop / status / logs 四个子命令。通过 `node` 直接执行 `dist/cli.js`（或 `npm`/`pnpm` bin `sillyhub-daemon`）调用。负责组装所有组件并启动 daemon 主循环。

## 契约摘要
- `createProgram()` — commander Program，顶层命令组
- `start --server? --token?` — 启动 daemon 进程（前台阻塞）
- `stop` — 读取 PID 文件并发送 SIGTERM 停止 daemon
- `status` — 显示运行状态、PID、runtime_id、server_url
- `logs --tail=50` — 显示 daemon 日志尾部
- PID 文件路径辅助：`getPidFile()` → `~/.sillyhub/daemon/daemon.pid`
- 日志文件路径辅助：`getLogFile()` → `~/.sillyhub/daemon/daemon.log`
- 进程辅助：`readPid()` 读 PID 文件、`isProcessAlive(pid)` 跨平台存活检测
- `stopAction()` — commander 的 stop 子命令处理函数（供其他流程复用）

## 关键逻辑
```
start(server, token)
  DaemonConfig() → 更新 server_url/token → save()
  HubClient(config.server_url, token)
  WorkspaceManager(baseDir=DEFAULT_CONFIG_DIR/"workspaces")
  CredentialManager()
  TaskRunner(client, workspaceMgr, credentialMgr)
  Daemon({ config, client, taskRunner })
  writePidFile(process.pid)
  await daemon.start() + 循环 until stopped
  finally: removePidFile()

stopAction / stop
  pid = readPid() → isProcessAlive(pid) → process.kill(pid, SIGTERM)
```

## 注意事项
- start 命令必须提供 `--token`，否则直接退出（错误提示引导到 web UI）
- workspace 目录默认在 `~/.sillyhub/daemon/workspaces`
- stop 通过 SIGTERM 信号停止，Windows 上 SIGTERM 行为与 Linux 不同
- `isProcessAlive` 通过 `process.kill(pid, 0)` 检测存活（跨平台）
- 子命令内部按需 `await import()` 延迟加载，保持启动速度
- 依赖 config 模块

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
