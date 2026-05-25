# 多智能体协作管理平台 — SillySpec Native 搭建文档包 v2

这是一套按 **SillySpec 真实变更包结构** 组织的平台搭建文档，不再使用理想化的 `/requirements、/plans、/tasks` 目录。

核心定位：

> 平台不是重新定义 SillySpec，而是把 `.sillyspec` 的真实目录、变更包、项目组组件、运行态、知识库和 Git 执行边界，产品化成多人、多项目、多 Agent 的全生命周期执行管理系统。

## 入口

```text
2026-05-25-multi-agent-platform-bootstrap-v2/
  MASTER.md
  proposal.md
  requirements.md
  design.md
  plan.md
  tasks.md
  verification.md
  tasks/
  references/
```

## 本版重点修正

1. `.sillyspec/projects/*.yaml` 不是项目列表，而是 **项目组成员 / 关联项目组件配置**。
2. 一个 `.sillyspec` 根目录是一个 **Workspace**。
3. `changes/change` 和 `changes/archive` 是 **Workspace 级变更管理**，一个变更可以影响多个组件。
4. `docs/{component}/scan` 是 **组件级扫描认知**。
5. `.runtime` 是本地运行态，不是长期事实源。
6. 新增 **Git Identity、Credential、Worktree Lease、Git Tool Gateway**，解决单服务器部署下多人只能控制自己的 Git 的问题。

## 推荐阅读顺序

1. `MASTER.md`
2. `proposal.md`
3. `requirements.md`
4. `design.md`
5. `references/02-lifecycle-from-requirement-to-deployment.md`
6. `references/04-git-identity-and-worktree-isolation.md`
7. `plan.md`
8. `tasks.md`
