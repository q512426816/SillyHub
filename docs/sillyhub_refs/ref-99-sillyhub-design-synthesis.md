# Ref 99：SillyHub 平台设计综合结论

## 1. 平台定位

SillyHub 不应定位为普通多 Agent 平台，也不应定位为 AI 虚拟公司。

更准确的定位是：

```text
SillyHub = 受控 AI 工程交付 Harness + 团队知识沉淀系统 + 本地/云端混合 Runner
```

一句话：

> 用工程化 Harness 管住 AI，用知识库沉淀团队资产，用 Runner 适配本地与云端执行环境。

## 2. 总体架构

```text
Web / API / IDE / CLI
        ↓
SillyHub Server
  - 用户 / 团队 / 项目
  - 权限 / 策略 / 审批
  - 任务状态机
  - 知识库
  - 审计日志
  - Web 控制台
        ↓
Runner Control Plane
        ↓
┌───────────────────────┬────────────────────────┐
│ Local CLI Runner       │ Server Sandbox Runner   │
│ 用户本地执行器          │ 平台托管执行器            │
└───────────────────────┴────────────────────────┘
        ↓
Agent Adapter
  - Claude Code
  - Codex
  - Gemini
  - Qwen Code
  - Custom Agent
```

## 3. 核心原则

```text
Prompt 管认知
Policy 管权限
Workflow 管流程
Sandbox 管执行
Knowledge 管复利
Audit 管追责
```

展开为：

- Prompt 只负责角色、目标、输出格式、思考方式。
- Policy 决定 Agent 能不能调用某个工具。
- Workflow 决定任务能不能进入下一阶段。
- Sandbox 限制文件、命令、网络、Git 操作边界。
- Knowledge 负责把每次交付沉淀为可复用资产。
- Audit 负责记录全过程，支持追责和复盘。

## 4. 多 Agent 模型

SillyHub 支持多 Agent，但不采用虚拟公司式接力。

错误模式：

```text
产品经理 Agent → 架构师 Agent → 开发 Agent → 测试 Agent
```

推荐模式：

```text
Task Orchestrator 持有完整任务主线
  ↓
按需委派给不同执行单元
  ↓
子 Agent 返回证据、风险、建议、代码、测试结果
  ↓
所有结果回流主线
  ↓
平台统一合并、判断、推进
```

核心原则：

> 多 Agent 不是虚拟公司，不是流水线接力，而是主任务下的分支探索、职责委派和结果回流。

## 5. Agent 与工具权限

Agent 不直接拥有生产权限。

```text
Agent
  ↓ 申请工具调用
Tool Gateway
  ↓ 权限校验
Policy Engine
  ↓ 允许后执行
Workspace Sandbox
  ↓ 生成产物
Audit Log
```

角色示例：

```text
Planner：只读项目、写方案
Critic：只读方案、写风险评审
Implementer：读写任务 workspace、运行有限测试
Reviewer：读 diff、写审查意见、不能改代码
Tester：运行白名单测试命令
Git Executor：生成 patch / PR，不能直推主分支
Archiver：提取候选知识，不能直接发布正式知识
```

## 6. 本地 CLI Runner

必须有 CLI，因为大量真实项目环境在用户本地：

- 本地代码。
- 本地依赖。
- 本地 Git 凭证。
- 内网资源。
- 私有配置。
- IDE 工作流。

CLI 不是简单命令行，而是本地受控执行器。

典型命令：

```bash
silly login
silly project link
silly doctor
silly task pull
silly task run
silly task resume
silly task submit
```

CLI 负责：

```text
绑定本地目录
检查环境
调用本地 Agent CLI
执行测试
采集 diff
记录日志
回传服务端
执行本地 Policy
```

## 7. Server Sandbox Runner

Server Runner 适合：

- 后台长任务。
- Web 远程触发。
- 统一环境验证。
- 文档分析。
- 知识库任务。
- 云端 Agent 托管。

推荐：

```text
tenant_id + user_id + project_id + task_id → sandbox workspace
```

不要只做 `user_id → sandbox`。

云端 Claude Code / Codex 可以被封装成 HTTP/SSE 内部服务，但不能直接暴露全部权限给用户。

## 8. 知识库设计

知识库不应只是一堆文档，也不应只是一套向量数据库。

推荐三层：

```text
Git / Markdown：知识正文和版本历史
Metadata DB：权限、类型、成熟度、引用、生命周期
Vector Index：语义检索索引
```

知识类型：

```text
model：实体、字段、关系
process：流程、状态机
decision：架构决策
guideline：推荐 / 禁止做法
pitfall：坑点、风险、排查方式
```

知识状态：

```text
candidate → confirmed → verified → promoted → deprecated
```

关键原则：

> AI 可以发现候选知识，但不能自动确权正式知识。

## 9. 工作流闭环

每个任务都应该产生工程交付闭环和知识沉淀闭环。

```text
需求输入
  ↓
知识注入
  ↓
方案生成
  ↓
对抗评审
  ↓
代码实现
  ↓
测试验证
  ↓
代码 Review
  ↓
生成 PR
  ↓
归档知识
```

每个阶段应有：

```text
输入
输出
允许工具
禁止工具
收敛条件
失败处理
审计记录
```

## 10. MVP 建议

第一阶段不要一次性做成完整平台。

推荐 MVP：

### Server MVP

```text
用户 / 项目 / 任务
任务状态机
知识库基础管理
产物上传
审计记录
Web 查看
```

### CLI MVP

```text
login
project link
doctor
run
resume
submit
```

### Runner MVP

```text
优先 Local CLI Runner
支持 Claude Code 或 Codex 一个后端
预留 Agent Adapter
采集 diff / test / logs / artifacts
```

### 知识 MVP

```text
Markdown + Git
Metadata DB
标签 / 类型 / 阶段检索
先不强依赖向量库，但预留索引接口
```

## 11. 最终设计结论

```text
SillyHub 不是 AI 虚拟公司。
SillyHub 是受控 AI 工程交付平台。

它通过任务主线保持目标连续，
通过外部状态保持上下文连续，
通过 Policy 和 Tool Gateway 保持权限连续，
通过 Sandbox 和 Git Gateway 保持执行安全，
通过知识库保持团队经验连续。
```
