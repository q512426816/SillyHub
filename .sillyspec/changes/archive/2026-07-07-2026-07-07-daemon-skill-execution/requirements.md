---
author: qinyi
created_at: 2026-07-07 13:22:00
---

# Requirements: daemon-skill-execution

## 角色表

| 角色 | 职责 |
|---|---|
| backend | 构造 stage 元数据（change_id+stage+skill 名），通过 AgentSpecBundle 传 daemon；打包分发 sillyspec skills bundle；配平台默认 MCP |
| daemon（宿主） | 同步 sillyspec skills 到宿主 + workspace 自定义 skills；合并 MCP 配置注入 claude；spawn claude 时传 stage 元数据 + skill 指令（不写 CLAUDE.md） |
| claude | 启动调 sillyspec skill（如 /sillyspec-verify），skill 读 specDir + stage 元数据跑流程 |
| skill（sillyspec-*） | 接收 stage 元数据，读 specDir 文档，跑完整流程（verify/execute/...），产出结果 |

## 功能需求

### FR-01 stage 投递重构（混合元数据 + skill 调用）
- **Given** daemon-client workspace 触发 verify dispatch，**When** backend 构造 stage 元数据（change_id+stage+skill_name），**Then** claude 启动调 `/sillyspec-verify` skill（prompt 内嵌 `/sillyspec-verify --change X --stage verify` + env STAGE_META 备份），skill 读 specDir 跑流程，backend 不拼完整 stage prompt。

### FR-02 删 task-runner 写 CLAUDE.md
- **Given** daemon 跑 stage 任务，**When** spawn claude，**Then** 不写 `.claude/CLAUDE.md`（task-runner.ts:457-463 删除），worktree 原项目规则 CLAUDE.md 保留；complete_lease git_apply patch 基准一致，无 `does not match index` 冲突。

### FR-03 daemon 平台 skills 同步
- **Given** daemon 启动/注册，**When** 查 backend skills manifest 版本新，**Then** 拉 sillyspec skills bundle 解压到宿主 skills 目录，claude 启动可调 sillyspec skills。

### FR-04 daemon workspace 自定义 skills 同步
- **Given** workspace 绑定/lease 时，**When** workspace 有自定义 skills（specDir），**Then** daemon 同步到 worktree `.claude/skills/`，claude 可调。

### FR-05 MCP 配置注入
- **Given** workspace 配了 `.mcp.json`（specDir）+ 平台默认 MCP，**When** daemon spawn claude，**Then** 合并平台+workspace MCP 配置，注入 claude `--mcp-config`（或写 worktree `.mcp.json`），claude MCP servers 可用。

### FR-06 server-local 模式 skills 可用
- **Given** server-local workspace（claude 在 backend 容器跑），**When** 容器构建，**Then** `COPY .claude/skills/` 进镜像，stage_meta 同样 prompt+env 传，claude 可调 sillyspec skills。

## 非功能需求

- **NFR-01** stage 投递可靠：claude 必调指定 skill（三层保障：明确指令 + 不限 skill + 兜底检测报错），不静默跳过。
- **NFR-02** skills 同步不影响 daemon 启动性能（bundle 拉取 < 5s，版本比对避免重复拉）。
- **NFR-03** MCP 配置安全：MCP server 白名单（admin 控制），防恶意 MCP。
- **NFR-04** 零回归：host-fs-delegate git_apply 链路、server-local stage、现有 complete_lease 不受影响。

## 决策覆盖

- FR-01 ← D-001（混合投递）、D-006（方案 C 一次性）
- FR-02 ← D-005（CLAUDE.md 保留不覆盖）
- FR-03 ← D-002（skill 同步机制）
- FR-04 ← D-002、D-004（复用 spec sync）
- FR-05 ← D-003（MCP 配置模型）
- FR-06 ← server-local 兼容
- NFR-01 ← D-001 强制保障
- NFR-03 ← D-003 白名单
