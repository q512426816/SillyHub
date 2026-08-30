---
schema_version: 1
doc_type: module-card
module_id: cli
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 命令行入口（cli）

## 定位
sillyhub-daemon 的 commander 命令行入口（`#!/usr/bin/env node`，click → commander 迁移）。6 个子命令 start / stop / status / logs / clean / autostart（autostart 为首个嵌套子命令组：enable / disable / status，2026-08-30-daemon-autostart）；start 负责组装 Daemon 全量依赖（client / workspace / credential / task-runner / session-manager / policy / resilience / runtime-lock / mcp-config 合并）并管理 PID 与日志文件生命周期。全局安装后 `sillyhub-daemon start` 的实际入口。

## 契约摘要
- `start`：选项 `--server` / `--token` / `--api-key`（互斥，先于 config 加载校验）/ `--workspace-dir` / `--poll-interval` / `--heartbeat-interval` / `--max-concurrent` / `--log-level` / `--open-terminal` / `--terminal-mode` / `--terminal-close-on-exit` / `--terminal-command` / `--force`。
- `stop`：读 PID → 发 SIGTERM；`status`：打印 State/PID/Runtime ID/Server URL/Config dir 五字段；`logs --tail <n>`：读日志尾部 N 行（默认 50）；`clean [--dry]`：本地缓存清理（`cleanAction` 复用 cleanup.ts `performCleanup`，`--dry` 仅统计预览释放空间）。
- `autostart enable [--server <url>] [--api-key <key> | --token <t>]`：注册开机（或登录）自启。凭据管线与 startAction 同构（互斥校验先于 config 加载 → `loadConfigFn` 合并 CLI 覆盖（token↔api_key 互斥互清）→ 无条件 `saveConfigFn` 落盘先于凭据校验）；合并后无凭据 → stderr + return 1 不注册半残任务；`--token` 短时效琥珀警告（建议改用 --api-key，R-12）；成功打印任务标识/启动命令/日志位置/立即启动提示，exit 0/1。`autostart disable [--server <url> | --all]`：只注销注册不杀运行中进程（停进程用 stop）；均缺参时按本地记录 0 条 return 0 / 1 条直接注销 / 多条列出 return 1。`autostart status`：逐条打印 Server/任务标识/系统状态三态（已注册/注册丢失/查询失败），恒 return 0。动作函数 `autostartEnableAction` / `autostartDisableAction` / `autostartStatusAction` 导出供测试直调；平台注册能力在 autostart 模块（见 autostart.md）。
- 可测试性注入点（封装为函数供 vi.spyOn）：`getPidFile()`（~/.sillyhub/daemon/daemon.pid）、`getLogFile()`（daemon.log）、`loadConfigFn(server_url)`、`saveConfigFn(config, server_url)`。
- 进程管理：`readPid` / `writePid` / `removePid` / `isProcessAlive`。
- `resolveRunningDaemonConfig(pid)`：扫 locks/runtime-*.lock（含 pid + server_hash）按 pid 反查运行中进程实际连接的 per-server 配置（ql-20260818-001）。
- `createProgram()` 返回 commander Program；main 顶层 `process.on('unhandledRejection'/'uncaughtException')` → logFatal 吞异常保活（结构化 FATAL 日志，绝不 process.exit）。

## 关键逻辑
```text
startAction(opts):
  step 0 互斥校验（--token/--api-key 同给 → return 1）
  step 0.5 单实例守卫（ql-20260831-001-6dde）：readPid() 记录的 pid 存活且 ≠ 自身
          → stderr「already running (pid N)… stop first」+ return 1（双实例会 pid
          互相覆盖 / stop 只能停其一 / server 侧双 runtime 抢会话；典型触发：
          macOS autostart enable 的 bootstrap RunAtLoad 立即拉起第二实例）。
          豁免：env SILLYHUB_DAEMON_RESPAWN=1（respawnDaemonAndExit spawn 注入——
          自更新交接旧进程 exit(0) 前 pid 短暂并存是既定时序）与 pid=自身
  serverUrl = opts.server ?? DEFAULT_CONFIG.server_url   # 不带 --server 静默用 8000 定位 per-server 文件
  config = { ...loadConfigFn(serverUrl), ...CLI 覆盖 }（token↔api_key 互斥互清）
  saveConfigFn(config, config.server_url)                # 落盘到 per-server config-<hash>.json
  token/api_key 均缺 → stderr + return 1；setDaemonApiKey(api_key)（进程级，不落盘）
  组装：HubClient / WorkspaceManager / CredentialManager / FileOutbox(load 恢复 pending)
        / ResilienceService / PolicyEngine(+PolicyCache+AuditSink) / SessionManager
        （闭包延迟绑定 daemon 桥）/ TaskRunner / RuntimeLockManager(--force) / Daemon
  writePid(pid) → daemon.start()（acquire lock + register + 三循环 + WS）→ finally removePid()

stopAction: pid 缺/进程死 → 清 stale PID + return 1；process.kill(pid, SIGTERM) → 0
statusAction: running 时 resolveRunningDaemonConfig(pid) 反查实际 server 配置，
             失败/非 running 回退读 DEFAULT server 的 per-server 文件，恒 return 0
```

## 注意事项
- **per-server 配置坑**：start 不带 `--server` 时静默用 DEFAULT server_url（http://localhost:8000）定位配置文件——本地连 8001 的 daemon 必须显式带 `--server`，否则身份（runtime_id）落在 8000 那份配置上。status 此前固定展示 DEFAULT 那份（`--server` 启动的进程错显 8000），ql-20260818-001 已改为 running 时按 pid 从 runtime lock 反查；输出五字段格式不变（cli.test.ts 逐字断言，含字段后空格数）。
- 信号职责划分：Daemon 内部已注册 SIGINT/SIGTERM 调 daemon.stop() 并自注销，CLI 层不重复注册；PID 清理在 start 的 finally。
- RuntimeLockManager（`--force`）：同机同 provider 已有活跃 daemon 时 start 抛 LockHeldError 退 1；--force 仅回收 stale/corrupt lock，不强杀活跃进程。
- TaskRunner 构造是位置参数（含 config、resilience、policyCache 等），非 options 对象；TaskRunner 创建必须在 PolicyCache 之后（共享实例）。
- interactive 组装顺序：先 new SessionManager（deps 闭包引用 daemon）再 new Daemon，靠 `let daemon` 闭包延迟绑定解决循环引用。
- 三循环 fire-and-forget 的未捕获 rejection 由顶层 handler 吞掉保活——排查「daemon 静默不退」时先 grep `[FATAL ...]`。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
