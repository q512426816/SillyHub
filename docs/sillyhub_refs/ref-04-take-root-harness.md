# Ref 04：take-root：把工程纪律编码进 Harness

## 文章核心观点

take-root 文章讲的是一个 CLI Harness Agent 框架。它用多个 persona 模拟评审、实现、测试等流程，但真正有价值的不是 persona 名称，而是它把工程纪律机制化：

- 不靠 Prompt 说教，而靠权限隔离。
- 不靠 Agent 自己宣布完成，而靠收敛指标。
- 不让同一个模型自我审查，而引入对抗评审。
- 不依赖会话记忆，而把状态和产物写入文件。
- 不怕中断，因为可以从磁盘 artifact 恢复。

## 最值得吸收的点

### 1. 机制约束代替 Prompt 约束

文章中最重要的观点：

```text
把角色合约、权限隔离、收敛指标编码进框架，而不是写进 prompt 里靠道德说教约束 AI。
```

对应 SillyHub：

```text
Prompt：告诉 Agent 应该怎么做
Policy：决定 Agent 能不能做
Tool Gateway：决定工具能不能调用
Workspace：限制它能改哪里
Git：记录和回滚每一步
Workflow：决定能不能进入下一阶段
```

### 2. Review-only 权限隔离

文章中 review persona 只能：

- 读文件。
- 搜索文件。
- 写自己的评审 artifact。
- 不能改业务代码。

并通过三层保证：

```text
工具权限限制
上下文注入扫描
工作区快照 + 越权回滚
```

SillyHub 可升级为：

```text
Planner Agent：只读项目 + 写方案
Reviewer Agent：只读方案 / diff + 写评审意见
Coder Agent：只能在任务 workspace 写代码
Tester Agent：只能执行白名单测试命令
Git Agent：只能生成 diff / PR，不能直推主分支
```

### 3. 对抗评审机制

文章中 Jeff 提方案，Robin 综合评审，Neo 对抗性挑刺。

SillyHub 可抽象为：

```text
Plan Step：生成方案
Critic Step：专门找漏洞
Review Step：综合判断
Orchestrator：合并分歧，决定是否进入编码
```

这比“一个 Agent 自己写、自己审”更稳。

### 4. 收敛指标

文章用 frontmatter `status: converged` 判断方案是否收敛。

SillyHub 也应该有各阶段 Done Definition：

```text
需求阶段：需求边界是否明确？
方案阶段：影响范围是否列清？
编码阶段：是否只改了计划内文件？
测试阶段：是否通过 AC？
Review 阶段：是否无 blocker？
交付阶段：是否生成 PR？
```

### 5. 状态落盘与断点恢复

文章通过 state.json、artifact 文件、frontmatter、git commit 实现恢复。

SillyHub 应做到：

```text
任务可以暂停
任务可以恢复
每一步有产物
每一步有状态
每一步有 diff
每一步有审计
失败后能回滚
```

## 不建议直接照搬的地方

### 1. 不建议照搬拟人化 persona

文章使用：

```text
Jeff、Robin、Neo、Lucy、Peter、Amy
```

SillyHub 更适合使用职责类型：

```text
Planner、Critic、Implementer、Reviewer、Tester、Archiver
```

甚至进一步抽象成：

```text
Task Step Executor
```

### 2. 不建议固定 Plan → Code → Test

CLI 工具可以固定流程，但平台应支持可配置 Workflow Template。

不同任务可能是：

```text
需求分析 → 文档更新 → 代码实现 → 测试补充 → PR
数据库变更 → Migration 检查 → 测试 → 审批
报表配置 → 数据验证 → 用户验收
知识整理 → 审核 → 发布
```

### 3. Git 自动 commit 要谨慎

平台里更推荐：

```text
任务 workspace 自动保存 patch
每阶段生成 diff snapshot
最终由平台创建 PR
commit / push / merge 由 Git Gateway 控制
```

### 4. “无人值守”不能一概而论

低风险任务可以自动推进；中高风险任务必须审批：

```text
低风险：文档更新、局部测试、静态检查
中风险：代码修改、依赖升级、接口调整
高风险：数据库变更、权限模型、生产配置、跨模块重构
```

## 对 SillyHub 的抽象设计

```yaml
step: plan_review
executor: critic_agent
input:
  - requirement_spec
  - implementation_plan
tools:
  allow:
    - read_file
    - search_code
    - write_artifact
  deny:
    - write_file
    - run_shell
    - git_push
output:
  - review_report
convergence:
  required_status:
    - no_blocker
```

## 推荐写入设计文档的表述

```text
SillyHub 采用“主线任务驱动 + 委派式 Agent + 机制化约束”的架构。
平台不依赖提示词约束 Agent 行为，也不采用虚拟公司式的多 Agent 接力模式。所有 Agent 都作为任务状态机中的受控执行单元，通过统一 Tool Gateway、Policy Engine、Workspace Sandbox、Git Gateway 和 Audit Log 执行任务。
平台在关键阶段引入对抗评审和收敛指标，通过方案评审、代码审查、测试验证、风险检查等机制，避免单 Agent 在复杂项目中出现上下文漂移、越权修改和局部正确整体错误的问题。
```
