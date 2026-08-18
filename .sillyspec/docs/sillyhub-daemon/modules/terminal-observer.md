---
schema_version: 1
doc_type: module-card
module_id: terminal-observer
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 终端观察日志写入器（terminal-observer）

## 定位
单任务终端观察日志写入器（`src/terminal-observer.ts`）。每个 agent run 一个独立日志
`~/.sillyhub/daemon/runs/<leaseId>/terminal.log`，task-runner 在 spawn 全程往里写
header + parsed 事件文本 + raw stdout/stderr + close 收尾；
`terminal_observer_enabled=true` 时调 launchTerminal 弹独立终端 tail 该日志。
另承担 runs/ 目录的 7 天保留期清理（perf-remediation task-09 / FR-12）。
设计核心：fire-and-forget 异步写入，绝不阻塞 stdout 主循环或抛错给业务。
唯一调用方是 task-runner。

## 契约摘要
- `TerminalObserver` 接口：
  - `writeParsed(line)` / `writeRawStdout(line)` / `writeRawStderr(line)`；
  - `close(summary?)`——幂等，`closed` 标志守卫，重复调用安全。
- `CreateTerminalObserverOptions`：`leaseId` / `cwd` / `cmdPath` / `args` /
  `config?`（DaemonConfig，取 `terminal_observer_mode/enabled/close_on_exit/command` 四键）。
- `createTerminalObserver(opts): Promise<TerminalObserver>`——建目录 + 写 header +
  可选弹终端 + 触发一次性清理；弹窗/写文件失败也返回可用 observer。
- `NOOP_TERMINAL_OBSERVER`——disabled 模式复用的空实现，调用方无需判空。
- `RUNS_RETENTION_MS`（7 天）与 `cleanupOldRuns(opts?)`（`now`/`runsDir` 可注入，
  供测试断言过期边界）导出。

## 关键逻辑
```
createTerminalObserver:
  scheduleRunsCleanupOnce()          // 进程内 in-flight guard，整个生命周期只跑一次
  mode = normalizeMode(mode)         // parsed/raw/both，非法值归一为 parsed
  mkdir runs/<leaseId>/ + writeFile header（lease/cwd/cmd/mode/observer_enabled）
  if enabled → launchTerminal({title:'SillyHub <shortId>', logPath, ...})
              失败只 append warning 到日志本身，不抛
  返回 observer：writeParsed→mode∈{parsed,both}；raw 写带 [raw stdout]/[stderr] 前缀
  所有写入 void appendFile(...).catch(()=>{})，fire-and-forget
cleanupOldRuns: readdir runs/ → 逐子目录 stat → mtime 距 now ≥ 7 天 → rm recursive
```

## 注意事项
- **fire-and-forget**：appendFile 异步、catch 静默吞错；极端情况（磁盘满/权限）
  observer 接口仍返回，后续写入全部静默失败。
- 清理（FR-12）全程容错：
  - runs/ 不存在直接 return（从未跑过任务）；
  - 单个子目录 stat/rm 失败跳过，不影响其余；
  - 只删子目录、mtime 新鲜的绝不误删；任何失败绝不 throw 影响任务链路。
- 触发时机是 createTerminalObserver **首次**调用（等价启动时——daemon 空闲期无日志
  写入，无需更早），此后进程内不再重复。
- mode 控制：parsed 只写事件渲染文本（与本地 echo 同源）；raw 只写原始
  stdout/stderr；both 都写。
- **不写入敏感字段**：observer 只接收「业务事件渲染文本」与「子进程 stdout/stderr」
  两类输入；Token/API key 由 spawn-env 注入 env，不出现在日志。
- shortLeaseId：leaseId 长度 >12 取前 8 位，与 task-runner 行为一致。
- header 写失败（mkdir/writeFile 抛错）只 catch 继续，observer 照常返回。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
