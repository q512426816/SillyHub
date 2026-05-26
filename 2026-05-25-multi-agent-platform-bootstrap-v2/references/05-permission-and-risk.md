# 05 — 权限与风险控制

## 1. 权限层级

```text
Platform
Workspace
ProjectComponent
Change
Task
Tool
Git
Deployment
```

## 2. Actor

```text
User
Agent
Bot
System
```

Agent 也是 Actor，必须有权限边界。

## 3. 关键规则

- 人是责任主体。
- Agent 不能拥有超过任务 Owner 的权限。
- Agent 不能读取未授权组件路径。
- Agent 不能直接访问生产环境。
- Agent 不能自动合并 protected branch。
- 所有高危操作进入 Approval。

## 4. 风险清单

| 风险 | 控制 |
|---|---|
| 人机责任不清 | owner/reviewer/approver |
| 项目组上下文串线 | affected_components |
| Git 凭据串用 | GitIdentity + 临时注入 |
| Worktree 冲突 | WorktreeLease |
| Agent 误操作 | Tool Gateway |
| 生产发布失控 | 审批 + 发布窗口 |
| 文档代码脱节 | Spec Guardian |
| 状态不可信 | 状态机 + 审计 |
| 成本失控 | Run 限额 |
| 平台过重 | 角色化视图 |
