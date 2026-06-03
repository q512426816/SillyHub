# 未分类知识

> execute/quick 执行中发现的坑暂存于此，用户审阅后归类到对应文件并更新 INDEX.md。

## 2026-06-03 — Claude Code PreToolUse hook 拦截 git commit

- `.claude/settings.json` 是 Claude Code hook 配置，只会拦截 Claude Code 自己发起的工具调用；普通终端或 IDE 里的 `git commit` 仍然只走 Git hooks。
- Windows 下用 `bash .claude/hooks/*.sh` 容易命中 WSL bash，并且 CRLF shell 脚本会触发 `$'\r': command not found` / `pipefail\r` 错误；跨平台 hook 优先用 `node .claude/hooks/*.cjs`。
- Claude Code `PreToolUse` 推荐用 `hookSpecificOutput.permissionDecision="deny"` 和 `permissionDecisionReason` 阻断工具调用；`continue:false` 是停止后续处理，不等同于 deny 当前 Bash 工具调用。
