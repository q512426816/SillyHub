---
schema_version: 1
doc_type: module-card
module_id: cli
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:10:13
---
# cli

## 定位
sillyhub-daemon 的 commander 命令行入口（`#!/usr/bin/env node`）。解析 4 个子命令（start/stop/status/logs）、组装 Daemon 运行所需依赖、管理 PID/日志文件生命周期。1:1 迁移自 Python `__main__.py`（click → commander）。是全局安装后 `sillyhub-daemon start` 的实际入口。

## 契约摘要
- 子命令（语义）：
  - `start`：可选 `--server/--token/--api-key/--workspace-dir/--poll-interval/--heartbeat-interval/--max-concurrent/--log-level/--open-terminal/--terminal-mode/--terminal-close-on-exit/--terminal-command/--force`，构建 Daemon 后阻塞运行。`--force`（ql-006）强制回收 stale/corrupt runtime lock（不强杀活跃 daemon 进程）。
  - `stop`：读 PID 文件并向进程发 SIGTERM，按存活与否返回退出码 1/0。
  - `status`：读 PID 文件并校验进程存活，打印 State/PID/Runtime ID/Server URL/Config dir。
  - `logs --tail <n>`：读日志文件尾部 N 行（默认 50）。
- 可测试性注入点（均封装为函数供 `vi.spyOn`）：`getPidFile()`、`getLogFile()`、`loadConfigFn(path)`、`saveConfigFn`。
- PID/日志路径：`~/.sillyhub/daemon/daemon.pid`、`~/.sillyhub/daemon/daemon.log`。
- 进程管理：`readPid/writePid/removePid/isProcessAlive`。
- `createProgram()` 返回 commander Program。

## 关键逻辑
```
startAction(opts):
  config = { ...loadConfigFn(DEFAULT_CONFIG_PATH), ...optsOverrides }
  saveConfigFn(config)
  client    = new HubClient(server_url, api_key ?? token)
  workspace = new WorkspaceManager(workspaces/)
  credential= new CredentialManager()
  runner    = new TaskRunner(client, workspace, credential, config)
  session   = new SessionManager(...)            # interactive 会话
  lockMgr   = new RuntimeLockManager({ hostname, serverOrigin: server_url, pid, version, force })  # ql-006
  daemon    = new Daemon({ client, workspace, runner, sessionManager, lockManager: lockMgr, config, ... })
  writePid(process.pid)
  await daemon.start()           # acquire lock + register + 三循环 + WS
  finally: removePid()           # 与 Python finally:_remove_pid() 一致

stopAction(): pid=readPid() → 不存活 return 1 → process.kill(pid) → return 0
```

## 注意事项
- 信号 handler 划分：Daemon 内部已注册 SIGINT/SIGTERM 调 `daemon.stop()` 并自注销，CLI 层**不重复注册**，避免双重 stop。
- `--token`（短期 Bearer，15min）与 `--api-key`（长期 X-API-Key）互斥；api_key 优先作 `HubClientAuth`。
- 退出码与 Python 逐字对齐（status/stop 的 0/1），cli.test.ts 有逐字断言，改动需同步。
- TaskRunner 真实构造是 3 位置参数 + config（非 options 对象），与蓝图旧假设不同。
- start 失败时错误消息输出到 stderr。
- ql-006：start 注入 RuntimeLockManager（runtime-lock.ts）强制单实例；同机同 provider 已有活跃 daemon 时 daemon.start 抛 LockHeldError → startAction catch 退出 1（防共享 backend runtime_id 致 ownership 双通过+WS 重连风暴）。`--force` 仅回收 stale/corrupt lock，不强杀活跃进程。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
