# Ref 01：Harness Runtime 不是 Prompt 模板，而是 Agent 受控运行底座

## 文章核心观点

这类 Harness Engineering 文章的核心观点是：生产级 Agent 系统不能只是“模型 + Prompt + 工具”。真正关键的是 Harness 运行时，它负责把 AI 的能力约束在可控工程流程里。

它强调的重点包括：

- Agent 负责局部智能，Harness 负责全局控制。
- 工具不是普通函数，而是生产资源授权点。
- 状态、记忆、工具、权限、预算、审计都应该由平台统一管理。
- MCP 只是工具接入协议，不等于生产级治理。
- 多 Agent 不应自由调用工具，而要被平台状态机调度。

## 对 SillyHub 的价值

这篇文章对 SillyHub 的价值很高，因为它明确了平台不能只做“AI 调用入口”。SillyHub 需要成为受控运行时。

SillyHub 应该具备：

- Task Orchestrator：任务状态机和阶段流转。
- Policy Engine：权限、阶段、风险等级校验。
- Tool Gateway：所有文件、Shell、Git、MCP、数据库操作统一经过网关。
- Workspace Sandbox：每个任务在隔离工作区执行。
- Git Gateway：生成 diff / PR，而不是让 Agent 直接 push。
- Audit Log：记录输入、输出、工具调用、文件变更、测试结果、审批记录。
- Budget Manager：控制 Token、时间、重试次数和并发资源。

## 需要谨慎的地方

文章讲的是架构原则，但不是完整落地方案。它通常不会深入讲：

- 多用户 Git 权限如何继承发起人。
- 本地 Runner 与服务端 Runner 如何协作。
- 多项目、多租户、客户隔离怎么做。
- 工具权限如何落到文件路径、Shell 白名单、Git 分支保护。
- 知识库如何进行权限过滤和生命周期管理。

所以它适合作为方向参考，不适合直接照搬。

## SillyHub 应采纳的设计原则

```text
Agent 不直接拥有生产权限。
Agent 只能向平台申请工具调用。
平台根据用户、项目、任务阶段、Agent 角色、工具风险等级进行校验。
通过后才由 Tool Gateway 在 Workspace Sandbox 中执行。
```

推荐写入设计文档的表述：

```text
SillyHub 的核心不是让 Agent 自由执行，而是把 Agent 的执行能力纳入工程化 Harness 中。
平台通过 Workflow Engine 控制任务阶段，通过 Policy Engine 控制权限，通过 Tool Gateway 控制工具调用，通过 Workspace Sandbox 控制执行边界，通过 Audit Log 记录全过程。
```

## 与其他 ref 的关系

- 与 `ref-02-knowledge-moat.md` 互补：Harness 解决可控执行，知识库解决长期复利。
- 与 `ref-03-anti-virtual-company-agent.md` 互补：Harness 主控流程，避免 Agent 之间线性接力导致上下文断裂。
- 与 `ref-04-take-root-harness.md` 互补：take-root 是机制化 Harness 的具体样板。
- 与 `ref-05-cloud-claude-code-runner.md` 互补：云端 Claude Code 只能作为 Runner，不应成为平台权限中心。
