---
author: qinyi
created_at: 2026-05-27 10:13:27
---

# Proposal

## 动机

multi-agent-platform 是管理项目、Agent、人员和协作流程的平台。当前实现把被管理项目是否存在 `.sillyspec` 当作 workspace 创建前置条件，这会阻断普通项目接入，也把 SillySpec 错误地从“Agent 使用的规范契约”变成了“目标项目准入格式”。

本变更将 SillySpec 重新定位为 Agent-facing spec contract：平台托管规范，Agent 消费规范，目标仓库 `.sillyspec` 只作为可选同步目标。

## 关键问题

1. 普通项目无法被管理  
   当前 `WorkspaceService.create` 在 `scan.is_sillyspec=False` 时直接抛出 `WorkspaceNotSillyspec`，前端也禁用创建按钮。这与管理平台定位冲突。

2. Agent 上下文不足  
   当前 `ClaudeCodeAdapter` 主要以 task title 启动 `claude --print`，虽然会写 `CLAUDE.md`，但上下文仍没有形成完整的 Agent 规范契约视图。

3. 规则散落且容易写死  
   平台需要处理 SillySpec 文档要求、平台审批要求、Agent 执行要求之间的冲突。简单忽略或把阶段/文件名写死都会导致后续升级和多 Agent 接入困难。

4. 规范文件与代码混放  
   已实现的 spec root 仍为相对路径 `.platform-specs/{workspace_id}`，放在代码目录内。规范文件属于平台，不应污染用户代码仓库。所有工作空间的规范文件必须存储在独立的平台数据目录中。

5. Agent 不知道规范文件格式  
   当前设计依赖 Agent 自己生成 `.sillyspec` 文件，但没有提供格式指导。SillySpec CLI 本身就是格式专家（包含完整的步骤 prompt 和模板）。Agent 应调用 SillySpec CLI 作为工具来生成规范文件，而不是自己猜格式。

6. 生成后缺少程序验证  
   当前设计信任 Agent 的"已生成完毕"反馈。规范文件必须经过确定性的程序化验证（YAML schema、引用完整性、目录结构），不依赖 Agent 自评。

## 变更范围

- 允许非 `.sillyspec` 普通项目创建 workspace。
- 新增平台托管 spec root，存储在独立平台数据目录（`spec_data_root`），与代码仓库完全分离。
- 新增 Agent spec profile 概念，以 `C:\Users\qinyi\IdeaProjects\sillyspec` 作为规范 profile 来源和参考实现。
- 新增策略层处理平台治理要求与 Agent/SillySpec 规范契约不一致。
- 改造 Agent run 上下文构建，生成完整 `AgentSpecBundle`（含 `available_tools` 字段）。
- 改造 Claude Code adapter，使其消费完整规范 bundle，Agent 通过调用 SillySpec CLI 生成规范文件。
- 新增 `SpecValidator` 对生成的规范文件进行程序化验证（YAML schema、引用完整性、目录结构）。
- 新增 `/spec-bootstrap` 端点，触发 Agent 使用 CLI 初始化规范空间。
- 改造 UI：工作区创建区分代码目录扫描、规范空间初始化、同步策略选择。

## 不在范围内（显式清单）

- 不重写 SillySpec CLI（但 CLI 可能需要新增 `--dir` 参数支持）。
- 不要求所有被管理项目写入仓库 `.sillyspec`。
- 不在本阶段实现完整 Agent 调度集群，只定义后台任务接口和最小可用队列边界。
- 不实现 Codex/Cursor 等其他 Agent adapter，只保留 registry 扩展点。
- 不改变现有 Git identity / worktree 的安全模型，只在其上接入规范 bundle。
- 不实现"每个组件 = 工作空间"的架构重设计（留作后续变更）。
- 不实现跨工作空间组件引用与同步机制。

## 成功标准（可验证）

- 普通代码目录可以创建 workspace，状态为 active。
- 默认 `spec_strategy` 为 `platform-managed`。
- 规范文件存储在 `spec_data_root` 独立目录中，不与代码仓库混放。
- Agent 通过调用 SillySpec CLI 命令生成规范文件（`sillyspec init`、`sillyspec run scan` 等），不自己猜格式。
- 规范文件生成后由 `SpecValidator` 进行程序化验证，验证失败产生 conflict record。
- 已有 repo-native `.sillyspec` 项目可以导入，不丢失现有文档。
- `claude_code` Agent run 可以从平台托管规范空间生成 `CLAUDE.md` 和 prompt。
- 前后端使用统一 agent type key：`claude_code`。
- 平台要求与 SillySpec 规范冲突时产生 conflict record，不静默跳过。
- Agent run 审计记录包含 actor、workspace、task、agent_type、spec_profile_version、spec_strategy、exit_code。
