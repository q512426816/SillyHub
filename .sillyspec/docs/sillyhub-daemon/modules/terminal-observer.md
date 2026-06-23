---
schema_version: 1
doc_type: module-card
module_id: terminal-observer
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:10:50
---
# terminal-observer

## 定位
单任务终端观察日志写入器（`src/terminal-observer.ts`，ql-20260616-003）。每个 agent run 一个独立日志 `~/.sillyhub/daemon/runs/<leaseId>/terminal.log`，task-runner 在 spawn 全程往里写 header + parsed 事件文本 + raw stdout/stderr + close 收尾。daemon 启动时若 `terminal_observer_enabled=true` 会调 launchTerminal 弹独立终端 tail 该日志。设计核心：fire-and-forget 异步写入，绝不阻塞 stdout 主循环或抛错给业务。

## 契约摘要
- `TerminalObserver` 接口：`writeParsed(line)`/`writeRawStdout(line)`/`writeRawStderr(line)`/`close(summary?)`（幂等）。
- `CreateTerminalObserverOptions`（leaseId/cwd/cmdPath/args/config?）。
- `createTerminalObserver(opts): Promise<TerminalObserver>` ——建目录 + 写 header + 可选弹终端，返回实例（即使弹窗/写文件失败也返回可用 observer）。
- `NOOP_TERMINAL_OBSERVER` ——disabled 模式复用的空实现，所有 write 为 no-op、close 幂等。

## 关键逻辑
```
createTerminalObserver:
  mode = normalizeMode(config.terminal_observer_mode)  // parsed/raw/both，默认 parsed
  dir = DEFAULT_CONFIG_DIR/runs/<leaseId>; logPath = dir/terminal.log
  mkdir(dir, recursive) + 写 header（lease/cwd/cmd/mode/observer_enabled）
  if enabled: launchTerminal({title:'SillyHub <shortId>', logPath, closeOnExit, customCommand})
              失败 → 往日志 append warning（不抛）
  返回 observer 实例：
    writeParsed  → mode∈{parsed,both} 时 append(line+'\n')
    writeRawStdout → mode∈{raw,both} 时 append('[raw stdout] '+line)
    writeRawStderr → mode∈{raw,both} 时 append('[stderr] '+line)
    close → 幂等，append summary 行
  append 全部 void appendFile(...).catch(()=>{}) fire-and-forget
```

## 注意事项
- **fire-and-forget**：appendFile 异步、catch 静默吞错，绝不阻塞 stdout 主循环或抛错给业务。极端情况（磁盘满/权限）observer 接口仍返回，后续写入也都静默失败。
- mode 控制：parsed 只写事件文本；raw 只写原始 stdout/stderr；both 都写。
- **不写入敏感字段**：observer 只接收「业务事件渲染文本」+「子进程 stdout/stderr」两类输入；Token/API key 由 spawn-env 注入 env，不出现在 stdout/stderr。
- NOOP_TERMINAL_OBSERVER 让 task-runner 无脑调 writeParsed 不判空 enabled 状态。
- close 幂等（多次调用安全），shortLeaseId 取 leaseId 前 8 位（与 task-runner 一致）。
- 弹窗失败只往日志追加 warning，不抛错（业务不受影响）。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
