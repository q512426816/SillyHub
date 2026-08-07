---
author: qinyi
created_at: 2026-08-07
status: 活跃坑（待 sillyspec 工具修复 / 根因待确认）
---

# 主仓库 git index 残留跨变更 staged 文件，commit 易串台

## 现象
主仓库 `git diff --cached` 出现**非本次操作显式 stage** 的文件——一整个 change 的
文档产物（如 `2026-08-06-public-mcp-server` 的 design/proposal/requirements/tasks.md
+ tasks/task-01~15.md 共 20 个 .md，A 状态）残留在 index，跨变更。

执行另一个 quick（`ql-20260807-001-f9ba`）改 hook 文件时，若 `git commit` 不做
path 限定，会把这 20 个无关的 .md 一起提交进 quick 的 commit，造成**跨变更串台**。

## 根因（待确认）
疑似某 sillyspec CLI 命令（brainstorm/plan/execute 阶段，或边界审计 `记录已有脏文件`）
内部对 change 目录跑了 `git add` 但未 commit，产物残留在 index。也可能来自历史上
某次 `git add .sillyspec/changes/<change>/`（会连带 stage 目录全部）。

确切触发命令待重现确认（需要时 grep sillyspec 源码找 `git add` 调用点）。

## 影响 + 绕过
- 影响：commit 前若不检查 `git diff --cached`，`git commit -m "..."`（不带 path）
  会把 index 里所有 staged 文件提交——包括其它变更的残留产物，污染本次 commit。
  多变更并发时尤其危险（A 变更的 commit 裹挟 B 变更未完成的文档）。
- 绕过：
  1. commit 前 **必查** `git diff --cached --name-only`，确认 staged 都是本次产物；
  2. 用 **path 限定 commit**：`git commit -m "..." -- <本次文件>`，只提交指定 path，
     其余 staged 留 index（本次 quick hook 提交 49a80ea1 就这么隔离的，20 个 .md 没被裹挟）；
  3. 若残留 staged 是误入，`git restore --staged <file>` 退回工作区。

## 待修（给工具）
- sillyspec 命令若需 stage 产物（如边界审计），应**只 stage 本次命令直接产生的文件**，
  且命令结束前提示「已 stage N 个文件待提交」让 agent/用户知情；
- 或：`--done` / worktree apply 等命令前，检测 index 有非本变更 staged 文件时**告警**
  （类似 dirty baseline 提示），避免静默串台；
- 或：sillyspec 命令统一不 `git add`，stage/commit 完全交给调度者显式控制。

## 相关
- 本次 `ql-20260807-001-f9ba`（pre-commit mypy 单文件扫）发现：提交 hook 前
  `git diff --cached` 列出 20 个 public-mcp-server .md 残留，用 `git commit -- <path>`
  隔离提交。
- 对比 `finished/` 机制：以往 `git add .sillyspec/changes/<change>/` 曾误 stage
  相邻变更目录（本次会话早期也踩过 `git add .sillyspec/` 暂存 scan-doc-drift-gate
  → `git restore --staged` 隔离）。
