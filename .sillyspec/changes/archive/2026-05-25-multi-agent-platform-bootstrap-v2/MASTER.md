# MASTER — 多智能体协作管理平台搭建总控文档 v2

## 1. 变更标识

```yaml
id: 2026-05-25-multi-agent-platform-bootstrap-v2
title: 多智能体协作管理平台搭建
status: draft
change_type: platform-bootstrap
workspace: multi-agent-platform
owner: qinyi
affected_components:
  - platform-web
  - platform-api
  - agent-runtime
  - sillyspec-adapter
  - git-runtime
  - docs
```

## 2. 背景

目标是开发一个平台，让团队成员可以在同一个系统中完成多个相关项目的全生命周期执行：需求输入、提案、需求澄清、设计、计划、任务拆解、开发执行、测试验证、Review、审批、合并、部署、归档、复盘。

平台必须原生兼容 SillySpec 工具生成的真实结构：

```text
.sillyspec/
  projects/
  docs/
  knowledge/
  changes/
    change/
    archive/
  quicklog/
  .runtime/
  local.yaml
```

其中 `.sillyspec/projects/*.yaml` 不是普通意义上的项目列表，而是当前 SillySpec Workspace 下的项目组成员 / 关联项目组件配置。

## 3. 核心目标

1. 读取并展示 SillySpec Native Layout。
2. 管理 Workspace、项目组组件、Change、Task、Runtime、Knowledge。
3. 支持一个 Change 影响多个项目组件。
4. 支持多人协作，但每个人只能控制自己有 Git 权限的仓库、分支和任务。
5. 支持 Claude Code、Codex、Cursor 等执行器作为可插拔 Agent Adapter。
6. 所有 Agent 工具调用必须经过 Tool Gateway。
7. 所有 Git 操作必须经过 Git Tool Gateway。
8. 所有关键节点必须可审计、可审批、可追溯。

## 4. 非目标

V1 不做：

- 不做完整多租户 SaaS。
- 不做生产级自动部署。
- 不做 Agent 自动合并主分支。
- 不做 Agent 自动修改权限和密钥。
- 不做平台自定义文档协议替代 SillySpec。
- 不做复杂微服务拆分。

## 5. 核心原则

```text
1. SillySpec 是项目事实源，平台是可视化和执行运行时。
2. Change 是生命周期主线，不是 Task。
3. projects 是项目组组件配置，不是顶层项目列表。
4. Agent 是受控执行者，不是系统中心。
5. 人是责任主体，Agent 只能辅助执行。
6. 平台可以单服务器部署，但 Git 身份、凭据、Worktree、执行环境必须隔离。
7. 不能使用全局超级 Git Token 操作所有仓库。
8. 所有 Git 操作都必须记录 user_id、git_identity_id、workspace_id、component_id、change_id、task_id、run_id。
```

## 6. 生命周期总览

```text
需求输入
  ↓
创建 Change
  ↓
proposal.md
  ↓
requirements.md
  ↓
加载 affected_components 上下文
  ↓
design.md / prototype
  ↓
plan.md
  ↓
tasks.md + tasks/task-xx.md
  ↓
Spec Guardian 门禁
  ↓
人 / Agent 执行任务
  ↓
Git Identity + Worktree 隔离
  ↓
Tool Gateway 控制工具
  ↓
测试验证
  ↓
verification.md
  ↓
Review / 审批
  ↓
PR / 合并
  ↓
部署
  ↓
归档到 changes/archive
  ↓
知识沉淀到 knowledge / quicklog
```

## 7. 文档清单

- `proposal.md`：平台搭建提案
- `requirements.md`：完整需求规格
- `design.md`：系统设计
- `plan.md`：实施计划
- `tasks.md`：任务总表
- `verification.md`：验收验证方案
- `tasks/`：可执行任务拆解
- `references/`：架构、权限、Git 隔离、API、部署等补充设计
