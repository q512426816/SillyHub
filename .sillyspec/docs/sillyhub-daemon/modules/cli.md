---
schema_version: 1
doc_type: module-card
module_id: cli
author: qinyi
created_at: 2026-06-10T16:55:00
---

# cli

## 定位
命令行入口点。基于 Click 提供 start / stop / status / logs 四个子命令。通过 `python -m sillyhub_daemon` 或 `sillyhub-daemon` console script 调用。负责组装所有组件并启动 daemon 主循环。

## 契约摘要
- `cli` — Click group，顶层命令组
- `start --server? --token?` — 启动 daemon 进程（前台阻塞）
- `stop` — 发送 SIGTERM 停止 daemon
- `status` — 显示运行状态、PID、runtime_id、server_url
- `logs --tail=50` — 显示 daemon 日志尾部
- PID 文件：`~/.sillyhub/daemon/daemon.pid`
- 日志文件：`~/.sillyhub/daemon/daemon.log`

## 关键逻辑
```
start(server, token)
  DaemonConfig() → 更新 server_url/token → save()
  HubClient(config.server_url, token)
  WorkspaceManager(base_dir=DEFAULT_CONFIG_DIR/"workspaces")
  CredentialManager()
  TaskRunner(client, workspace_mgr, credential_mgr)
  Daemon(config, client, task_runner)
  _write_pid(os.getpid())
  asyncio.run(daemon.start() + loop until stopped)
  finally: _remove_pid()

stop()
  _read_pid() → os.kill(pid, SIGTERM)
```

## 注意事项
- start 命令必须提供 `--token`，否则直接退出（错误提示引导到 web UI）
- workspace 目录默认在 `~/.sillyhub/daemon/workspaces`（非 config.py 中的 `~/sillyhub_workspaces`）
- stop 通过 SIGTERM 信号停止，Windows 上 SIGTERM 行为与 Linux 不同
- status 通过 `os.kill(pid, 0)` 检测进程存活（跨平台）
- 所有子命令在内部延迟导入（如 `from sillyhub_daemon.daemon import Daemon`），保持启动速度
- 依赖 config 模块

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
