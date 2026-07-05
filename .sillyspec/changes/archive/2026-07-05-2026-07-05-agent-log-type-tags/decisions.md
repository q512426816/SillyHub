---
author: qinyi
created_at: 2026-07-05 00:57:00
change: 2026-07-05-agent-log-type-tags
---

# decisions.md · 2026-07-05-agent-log-type-tags

本次变更的决策台账（不是长期术语表）。只记录有实现/验收影响的决策。

## D-001@v1: SillySpec 识别策略

- **type**: boundary
- **status**: accepted
- **source**: code（archive 实证 + daemon task-runner.ts:1710 `ev.metadata.tool_name`）
- **question**: agent 通过 Bash 工具跑 `sillyspec run xxx`，daemon 把它当普通 `tool_use`（tool_name=Bash）；复合命令（`sillyspec run && git commit`）、wrapper（`npx sillyspec`）下怎么稳定识别为 SillySpec 调用？要不要再细分子命令（brainstorm/plan/execute/verify/...）？
- **answer**: `tool_name==="Bash"` 且 `args.command` 含 `sillyspec` 子串 → `tool_kind="sillyspec"`；**不**分子命令，所有 sillyspec 调用统一一个标签。
- **normalized_requirement**: 用户在 Step 6 明确选择「各自一个标签就够」（SillySpec 与技能都不再分子级）。
- **impacts**:
  - `classify_tool_kind` / `classifyToolKind`（Python + TS）实现 Bash 分支的子串匹配逻辑。
  - 前端 `toolKindMeta` 只需一个 `sillyspec` 项，不需子命令映射。
  - 第二层筛选按钮只有一个「SillySpec」。
- **evidence**:
  - `.sillyspec/changes/archive/*/progress.json` 大量 `sillyspec run brainstorm/plan/execute/verify/scan/quick/commit` 实证。
  - daemon `task-runner.ts:1710` 从 `ev.metadata.tool_name` 取工具名。
  - 复合命令实证：记忆 [[pre-commit-ci-check-hook]] 提到 `git add && git commit` 复合命令模式。
- **priority**: P1（影响识别准确率与筛选体验）

## D-002@v1: MCP 工具统一一类

- **type**: boundary
- **status**: accepted
- **source**: user（Step 8 方案讨论后内联确认）+ code（daemon 源码 grep `mcp__` 无匹配，MCP 工具是 SDK 层透传）
- **question**: MCP 工具名格式 `mcp__<server>__<tool>`，数量不定（一个 workspace 可能装几十个 MCP 工具）。要不要每个 MCP 工具各自标签？还是按 server 分？还是统一一类？
- **answer**: 所有 `mcp__` 前缀工具统一 `tool_kind="mcp"`，不细分到 server/tool。理由：与「所有工具各自有标签」诉求有张力，但细分会让第二层按钮爆炸（潜在几十个）；统一一类在筛选体验和按钮数量间取平衡。
- **normalized_requirement**: Step 6 用户选「所有工具各自有标签」，但 MCP 是开放集合，需在 design 阶段权衡（Grill D-002 标 pending → 此处定 accepted）。
- **impacts**:
  - `classify_tool_kind` 实现简单 `name.startswith("mcp__") → "mcp"` 分支。
  - 前端第二层筛选只有一个「MCP」按钮。
  - design §5 Phase 2 / §7 / R-04 引用此决策。
- **evidence**:
  - daemon 源码 grep `mcp__` 无匹配（SDK 透传，daemon 不特殊化）。
  - 记忆 [[agent-run-pipeline-fix-status]]：tool_call JSON 已含 `{tool, args, ...}`，MCP 工具的 tool 名格式由 Claude Code SDK 决定。
- **priority**: P1（影响筛选 UI 数量与识别实现）

## D-003@v1: 技术方案 = 加 tool_kind 结构化列（方案 B）

- **type**: architecture
- **status**: accepted
- **source**: user（Step 8 用户选方案 B）
- **question**: 标签数据存哪里？方案 A（复用 tool_call JSON 加字段，零迁移）/ 方案 B（AgentRunLog 加 tool_kind 列，需迁移）/ 方案 C（加 metadata JSON 列，最灵活）。
- **answer**: 选方案 B。`AgentRunLog` 加 `tool_kind: str | None`（String(32)，nullable，加索引），参照 `AgentArtifact.kind`（model.py:550）先例。daemon 打标 → backend 落库填列 → 前端读结构化字段 → API 支持 `?tool_kind=` 筛选。
- **normalized_requirement**: 用户要「能筛选展示」，方案 B 提供结构化列让筛选最稳，且后端未来能按标签查询/统计。
- **impacts**:
  - 新增 alembic 迁移（R-01 迁移链风险）。
  - 三端协议都动：model + migration + schema + run_sync service + daemon protocol + frontend types + API。
  - 顺手消化 agent-run-pipeline-fix 留下的「AgentRunLog 缺结构化分类列」旧账（记忆 [[agent-run-pipeline-fix-status]]）。
  - design §5 / §6 / §8 全章基于此方案。
- **evidence**:
  - `AgentArtifact.kind`（model.py:550-583）是项目内已落地的「kind 枚举 + 列」模式。
  - 方案 A 被否：标签埋 content_redacted 文本里 DB 无法 query/聚合。
  - 方案 C 被否：对当前需求 over-engineering（YAGNI），JSON 列 SQLite/PG 方言处理成本高。
- **priority**: P0（架构取舍，影响全部实现）
