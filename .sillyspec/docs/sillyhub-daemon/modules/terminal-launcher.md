---
schema_version: 1
doc_type: module-card
module_id: terminal-launcher
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:10:50
---
# terminal-launcher

## 定位
跨平台「弹独立终端窗口 tail 日志」工具（`src/terminal-launcher.ts`，ql-20260616-003）。daemon 启动 agent run 时可选弹一个本地终端 tail `~/.sillyhub/daemon/runs/<leaseId>/terminal.log`，让用户在独立窗口实时看执行过程，主 daemon 进程保持管道化。设计核心：失败绝不抛错（弹窗是辅助能力，不能影响任务执行）；detached + unref 与 daemon 解耦。

## 契约摘要
- `LaunchTerminalOptions`（title/logPath/closeOnExit?/customCommand?）。
- `launchTerminal(opts: LaunchTerminalOptions): void` ——按平台或自定义命令弹窗，无返回值（异步 fire-and-forget）。

## 关键逻辑
```
customCommand 优先（replaceAll {log}/{title} 后 shell:true 执行）
否则按平台分支：
  win32: wt.exe new-tab --title powershell Get-Content -Wait；
         wt 不可用 → child.on('error') fallback cmd /c start powershell
  darwin: osascript 让 Terminal.app do script "tail -f '<path>'" + activate
  linux:  候选顺序 x-terminal-emulator → gnome-terminal → konsole → xterm，
          第一个能 spawn 的就用（同步 ENOENT 试下一个，异步 error 不重试避免重复弹窗）
所有 spawn: detached:true + stdio:'ignore' + unref()
所有 child.on('error') 静默吞错（业务不受影响）
```

## 注意事项
- **铁律：弹窗失败不影响业务**——所有 spawn 错误吞掉（child.on('error') + try/catch），调用方只需知道「弹没弹出」不影响 agent run。
- detached + unref：子终端与 daemon 解耦，daemon 退出后终端继续。
- closeOnExit 当前不影响 Windows 实现（wt 无法精准控制 close 时机，保持 -NoExit 让用户看完整日志，符合默认 false 预期）。
- Linux 候选终端拿到 PID 即认为成功返回，异步 error 不试下一个（避免重复弹窗）。
- shellQuote：POSIX 单引号包裹 path（含单引号用 '\'' 转义）；Windows 路径走 PowerShell 单引号 + '' 转义，不走本函数。
- customCommand 是完全自定义命令模板，用户可用 `--terminal-command` 配置。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
