---
author: qinyi
created_at: 2026-06-23 02:00:00
---

# 已知坑 (Known Issues)

## 🟡 sillyhub-daemon 于 2026-06-14 从 Python 重写为 Node.js

`scripts/`、旧文档、部分模块卡片可能仍引用 Python 文件名（`daemon.py` / `agent_detector.py` / `task_runner.py`），实际代码已全部是 TypeScript（`daemon.ts` / `agent-detector.ts` / `task-runner.ts`，ESM/pnpm）。改 daemon 前确认看的是 `.ts` 源码，勿被旧 Python 文档误导。

## 🔴 CI hook 复合命令可绕过 claude PreToolUse 层

两层 hook：claude `PreToolUse`（`git commit*` 前缀匹配 → 全量 mypy + frontend）+ git `pre-commit`（ruff）。坑：`git add && git commit` 这类**以 `git add` 开头的复合命令**会绕过 claude 层，只跑 ruff。需要全量检查时，应分开执行 `git add` 再 `git commit`，或单独触发。

## 🟢 daemon 重启 session 恢复已修复（gap-8.3 / commit 40e21d3）

daemon 重启后 interactive session 丢失致 turn 卡死的根因（`cli.ts` 漏传 persistence/recoveryClient）**已修复**（2026-06-20，commit 40e21d3，变更 `2026-06-19-fix-interactive-daemon-lifecycle` gap-8.3）：`cli.ts:412-449` 已装配 `JsonSessionPersistence` + `recoveryClient`（client 即 HubClient，实现 RecoveryCoordinator），backend 加 recovery 端点。有 `cli-session-manager-injection.test.ts` 守护。改 daemon session 逻辑可基于此已恢复前提。

## 🟡 AgentRunLog 无 metadata 列 / 三层日志 metadata 丢失

AgentRunLog 表无 metadata 列；三层日志（daemon/backend/前端）的 metadata 在 `submit_messages` 阶段会丢失。涉及 agent-run 日志/元数据传递的改动，需注意此约束（见变更 `agent-run-pipeline-fix`）。

## 🟢 本机可能存在多个 daemon 实例

连本地（daemon-start.bat）与连远程（手动 cmd）两类 daemon 可能并存。停 daemon 时按 `--server` 区分，勿误杀；无自动拉起机制。taskkill 禁用 `/IM` 通杀（会自杀当前 claude 会话），需按 PID 精确杀。
