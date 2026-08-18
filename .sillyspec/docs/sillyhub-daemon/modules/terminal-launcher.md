---
schema_version: 1
doc_type: module-card
module_id: terminal-launcher
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 独立终端窗口启动器（terminal-launcher）

## 定位
跨平台「弹独立终端窗口 tail 日志」工具（`src/terminal-launcher.ts`）。daemon 启动 agent run 时可选弹一个本地终端 tail `~/.sillyhub/daemon/runs/<leaseId>/terminal.log`，让用户在独立窗口实时看执行过程，主 daemon 进程保持管道化（平台事件流不变）。设计铁律：弹窗是辅助能力，失败绝不抛错、绝不影响任务执行；detached + unref 与 daemon 进程解耦。唯一调用方是 terminal-observer。

## 契约摘要
- `LaunchTerminalOptions`：`title`（窗口标题，wt/osascript 支持）/ `logPath`（要 tail 的日志绝对路径）/ `closeOnExit?` / `customCommand?: string | null`（命令模板，支持 `{log}` `{title}` 占位符，null 走平台默认）。
- `launchTerminal(opts): void`——fire-and-forget，无返回值；分派顺序：customCommand → win32 → darwin → linux。

## 关键逻辑
```
customCommand 优先：replaceAll({log},{title}) 后 spawn(cmd, {shell:true})
win32: wt.exe new-tab --title powershell -NoExit Get-Content -LiteralPath -Wait
       wt 不可用（error 事件）→ fallback cmd.exe /c start '' powershell 同命令
darwin: osascript → tell Terminal do script "tail -f '<path>'" + activate
linux:  候选 x-terminal-emulator / gnome-terminal / konsole / xterm 依次试 spawn，
        同步抛错（ENOENT）试下一个；拿到 PID 即返回，异步 error 不重试
所有 spawn: detached:true + stdio:'ignore' + unref()；error 一律静默吞
```

## 注意事项
- **铁律：弹窗失败不影响业务**——所有 child error 事件吞掉，调用方无需感知成败。
- closeOnExit 当前不影响 Windows 实现（wt 无法精准控制关闭时机，保持 `-NoExit` 让用户看完整日志，符合默认 false 预期）。
- Linux 候选终端拿到 PID 即认为成功；异步 error 不试下一个候选，避免重复弹窗。全候选同步失败则静默返回。
- 引号转义分两套：mac/linux 走 `shellQuote`（POSIX 单引号，内嵌单引号用 `'\''` 转义）；Windows 路径在 PowerShell 单引号内用 `''` 转义（`Get-Content -LiteralPath`），不经 shellQuote。
- customCommand 由用户 `--terminal-command` 配置传入，完全自定义（shell:true 执行），模板占位符外不做任何转义。
- Windows spawn 带 `windowsHide: false`（要的就是弹窗）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
