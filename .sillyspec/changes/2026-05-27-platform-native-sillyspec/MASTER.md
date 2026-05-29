---
author: qinyi
created_at: 2026-05-27 09:58:31
---

# 平台内置 SillySpec 能力

- **Status**: draft
- **Scope**: multi-agent-platform 主平台，集成 `C:\Users\qinyi\IdeaProjects\sillyspec` 作为 Agent 规范契约来源和参考实现

## Summary

multi-agent-platform 是项目、Agent、人员的管理平台。平台不能要求被管理项目预先是 SillySpec 项目；SillySpec 的本质是给 Agent 使用的规范契约，用于组织 Agent 上下文、阶段文档、任务输入和验收依据。平台应托管和治理这些规范，而不是把 SillySpec CLI 当成业务运行引擎；CLI/仓库 `.sillyspec` 只是参考实现、导入导出和可选同步目标。

## 拆分判断

该需求需要拆分。原因：

- 至少 5 个可独立交付模块：Agent 规范契约适配、平台侧规范存储、工作区接入策略、阶段/文档策略协调、Agent/权限/审计集成。
- 涉及多角色：平台管理员、项目维护者、Agent 执行者、普通成员。
- 涉及跨阶段状态流转：scan/brainstorm/propose/plan/execute/verify/archive 与平台 change/task/workflow 状态需要对齐。
- 不是批量模式；核心不是模板乘以大量数据，而是跨系统能力建模。

## 子阶段规划

### Stage 1: SillySpec 规范契约与 Profile 适配层

- 抽象 `AgentSpecProfile` / `SillySpecProfileProvider`，表达 Agent 需要消费的规范契约：阶段、文档、输入上下文、验收门禁、元数据。
- `C:\Users\qinyi\IdeaProjects\sillyspec` 是 profile 来源和参考实现；CLI 可用于导入、导出、校验或兼容执行，但不是平台业务流程的唯一运行时。
- 读取 SillySpec 阶段定义、文档要求、校验规则，形成版本化 `SpecProfileManifest`。
- 禁止将阶段名、文件名、校验项散落硬编码在业务模块；业务模块只能依赖 profile manifest 和 policy 决策结果。

### Stage 2: 平台侧规范存储与项目映射

- 允许普通代码目录创建 workspace。
- 引入平台托管 spec workspace：每个被管理项目有独立 spec root。
- 定义三种同步策略：platform-managed、repo-mirrored、repo-native。
- 目标项目没有 `.sillyspec` 时默认 platform-managed，不阻断管理。

### Stage 3: 阶段与 Agent 文档策略协调

- 建立 `StagePolicy` / `DocumentPolicy`，将 Agent 规范契约映射到平台 change/task/workflow。
- 当 Agent 规范契约与平台管理要求不一致时，不忽略、不写死；使用策略决策：
  - required-by-either: 任一侧硬门禁则保留为硬门禁。
  - stricter-validation-wins: 同类校验取更严格规则。
  - platform-extension: 平台额外要求作为 extension metadata、审计记录或平台状态，不污染 Agent 面向的 SillySpec 原始 schema。
  - adapter-transform: 名称或结构不一致时通过 manifest 映射和转换处理。
  - conflict-blocking: 无法自动合并时进入人工审批队列，并记录原因。

### Stage 4: Agent、人员、权限和审计集成

- Agent 执行前从 spec store 构造上下文，而不是直接依赖目标 repo `.sillyspec`。
- Agent 消费的是规范契约视图：任务说明、设计约束、允许路径、验收标准、历史决策和当前阶段门禁。
- Agent 接入采用 adapter registry：`claude_code`、未来 `codex`、`cursor` 等都是实现 `AgentAdapter` 的运行时适配器。
- 扫描完成后的执行链路是：scan 生成/刷新平台托管 spec -> proposal/design/tasks/plan 确认 -> 为任务获取 worktree lease -> 构造 `AgentSpecBundle` -> adapter 写入 Agent 专属入口文件（如 `CLAUDE.md`）和命令 prompt -> 运行 Agent -> 采集日志、diff、退出码 -> 写入审计和任务状态。
- Claude Code 适配器不应该只执行任务标题；它需要接收完整规范 bundle，包括 proposal、requirements、design、plan、task、allowed_paths、deny rules、验收标准和当前阶段门禁。
- Agent run 应作为平台后台任务执行，支持排队、取消、超时、重试和并发限制；HTTP 请求只负责创建 run，不应长时间阻塞等待 CLI 完成。
- 权限按 workspace/change/task/stage 维度约束。
- 所有 spec 生成、同步、校验、冲突解决写入审计日志。

### Stage 5: UI 与迁移兼容

- 工作区创建页区分“代码目录扫描”和“SillySpec 状态”。
- 现有 repo-native `.sillyspec` 项目可无损接入。
- 非 SillySpec 项目可一键生成平台托管规范空间，并可稍后选择同步回仓库。

## 决策原则

- SillySpec 首先是 Agent 使用的规范契约，不是平台执行引擎，也不是被管理项目准入门槛。
- 平台管理要求与 Agent/SillySpec 规范要求通过策略层协调，不允许简单忽略或写死。
- 被管理项目的源代码目录、平台托管 spec root、可选 repo `.sillyspec` 必须明确分离。
