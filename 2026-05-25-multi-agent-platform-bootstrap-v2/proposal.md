# proposal — 多智能体协作管理平台搭建提案

## 1. 问题陈述

团队希望开发一个平台来管理多项目、多成员、多 Agent 的协同交付过程。该平台同时又要用于管理自身的开发，因此需要支持自举式开发。

现有 SillySpec 已经形成了完整的变更包结构，但还缺少多人协作、可视化、权限控制、Git 身份隔离、Agent 执行管理、审批审计和部署闭环。

## 2. 关键问题

### 2.1 多人协作问题

多人在同一台服务器部署的平台上操作，如果没有隔离，会产生：

- A 用户使用 B 用户 Git 凭据。
- A Agent 修改 B 项目代码。
- 所有人共用一个服务器级 `~/.ssh`。
- 平台使用一个全局 Token 访问所有仓库。
- 任务、分支、工作目录互相覆盖。
- 审计无法判断真正的发起人。

### 2.2 多项目组问题

SillySpec 的 `projects` 不是普通项目列表，而是项目组中的相关组件配置。一个变更可能同时影响后端、前端、文档和测试工程。

因此平台模型不能是：

```text
Project → Change → Task
```

而应是：

```text
Workspace
  ├─ ProjectComponent[]
  └─ Change[]
       └─ affected_components[]
```

### 2.3 Agent 可控性问题

Claude Code、Codex、Cursor 等工具可以执行代码任务，但不能直接获得无限 Git、Shell、文件、部署权限。所有执行必须通过 Adapter、Runtime、Tool Gateway 和审批机制。

## 3. 提案目标

建立一个 SillySpec Native 平台，第一阶段先实现：

1. 识别 `.sillyspec` Workspace。
2. 解析项目组组件配置。
3. 解析 Scan Docs。
4. 展示 active / archived changes。
5. 展示 task 看板。
6. 展示 runtime 状态。
7. 引入 Git Identity 和 Worktree 隔离设计。
8. 为后续 Agent 执行奠定权限和审计边界。

## 4. 设计取向

平台第一阶段不是“AI 自动开发平台”，而是：

```text
SillySpec Native Viewer + Change Lifecycle Manager + Git Safety Runtime
```

后续再演进到：

```text
Controlled Multi-Agent Execution Platform
```

## 5. 预期收益

- 团队能以 Change 为中心管理需求到部署全生命周期。
- SillySpec 真实结构被完整可视化。
- 多项目组组件的影响范围更清晰。
- 多人 Git 权限不互相污染。
- Agent 可以接入，但被严格关在权限边界内。
- 平台自身可以被平台逐步管理。
