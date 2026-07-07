---
author: qinyi
created_at: 2026-07-07 13:20:00
---

# Proposal: daemon-client stage 执行模型重构 + daemon skill/MCP 管理

## 动机

2026-07-06-daemon-host-fs-delegate 归档后 e2e 暴露：daemon 跑 stage 任务前把 stage prompt 覆盖写到 worktree `.claude/CLAUDE.md`（`task-runner.ts:457-463`），与 git apply patch 的 HEAD 基准不一致 → `does not match index` 冲突。

深挖两层根因：① stage prompt（任务说明）覆盖 `.claude/CLAUDE.md`（项目规则）语义错位 + 污染 worktree git 状态；② daemon-client 模式 claude 在宿主跑，但 daemon 不管 claude 的 skill/MCP 环境——worktree `.claude/skills/` 没有 sillyspec skills，claude 调不到 `/sillyspec-verify`，只能 backend 拼 prompt 兜底（写 CLAUDE.md）。

## 关键问题（现有方案为什么不够）

1. **stage prompt 写文件机制错位**：任务说明覆盖项目规则，且改变 worktree git 状态导致 patch 冲突。
2. **daemon 无能力管理**：claude 调不到 sillyspec skills（~20 个已存在），stage 执行本应调 skill 跑流程。
3. **无 MCP 配置注入**：daemon-client 无法配 MCP servers（web 搜索/数据库等），claude 能力受限。

## 变更范围

- **stage 投递重构（混合）**：backend 传 stage 元数据（change_id+stage+skill 名），claude 调 sillyspec skill 跑流程，不拼完整 prompt。
- **daemon skill 管理（中等）**：平台 sillyspec skills 同步（仿 self-update）+ workspace 自定义 skills（仿 spec sync）。
- **daemon MCP 管理**：workspace 级 `.mcp.json` + 平台默认，daemon 注入 claude `--mcp-config`。
- **删 task-runner.ts:457-463 写 CLAUDE.md**（点 1 融入）。

## 不在范围内

- 不改 daemon-client 架构本身（claude 宿主跑 + backend 调度模式保留）。
- 不改 host-fs-delegate（已归档，委托链路通）。
- 不重构 sillyspec skills 内部实现（只管投递/同步）。
- 不做完整 MCP 市场（动态安装/权限/版本生态，YAGNI——本变更只到"配置注入"）。
- 不清理 agent-stage-dispatch 停滞变更（单独处理）。

## 成功标准（可验证）

- daemon-client verify dispatch：claude 调 `/sillyspec-verify` skill 跑流程（不再 backend 拼 prompt）。
- `.claude/CLAUDE.md` 不被 stage prompt 覆盖 → complete_lease git_apply patch 无 `does not match index` 冲突。
- daemon 启动同步 sillyspec skills 到宿主，claude 可调到。
- MCP 配置（workspace + 平台）注入 claude 生效。
- 现有 host-fs-delegate 链路零回归。
