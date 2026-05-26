# 06 — Agent Adapter 设计

## 1. 目标

支持 Claude Code、Codex、Cursor 等工具，但不绑定任何一个工具。

## 2. 接口

```typescript
interface AgentAdapter {
  name: string
  capabilities: string[]
  prepare(context: AgentContext): Promise<PreparedSession>
  run(input: AgentTaskInput): AsyncIterable<AgentEvent>
  cancel(runId: string): Promise<void>
  collectArtifacts(runId: string): Promise<Artifact[]>
}
```

## 3. 实现

```text
ClaudeCodeAdapter
CodexAdapter
CursorAdapter
ShellAdapter
RemoteAgentAdapter
```

## 4. 上下文

AgentContext 包含：

```text
workspace
change
task
affected_components
scan_docs
requirements
design
plan
allowed_paths
denied_paths
git_identity_policy
tool_permissions
cost_limit
timeout
```

## 5. 执行规则

- Agent 不直接读全仓库。
- Agent 不直接拿 Git 凭据。
- Agent 只看到任务允许的上下文。
- Agent 所有工具调用经过 Tool Gateway。
- Agent 输出必须落到 Artifact 和 Audit。
