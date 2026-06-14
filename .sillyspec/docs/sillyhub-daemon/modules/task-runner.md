---
schema_version: 1
doc_type: module-card
module_id: task-runner
author: qinyi
created_at: 2026-06-10T16:55:00
---

# task-runner

## 定位
任务执行引擎（方案 B 核心：子进程执行在此唯一一处）。接收已 claim 的 lease 和执行 payload，编排完整任务生命周期：准备 workspace → 写 CLAUDE.md → 渲染凭据 → 选择 adapter → spawn agent 子进程 → 实时 parse 输出 → 收集 diff → 返回结构化结果。adapter 不再负责执行，只负责解析。

## 契约摘要
- `TaskStatus` — 任务状态字面量联合类型
- `RunnerHubClient` — TaskRunner 依赖的 HubClient 最小接口（便于注入 mock）
- `RunnerWorkspaceManager` — TaskRunner 依赖的 WorkspaceManager 最小接口
- `RunnerCredentialManager` — TaskRunner 依赖的 CredentialManager 最小接口
- `TaskRunnerResult` — 执行结果类型：success, exitCode, patch, filesChanged, insertions, deletions, output, error, durationMs, metadata
- `TaskRunner(client, workspaceManager, credentialManager)` — 初始化
- `executeTask(leaseId, claimToken, payload): Promise<TaskRunnerResult>` — 核心入口，完整执行流程
- `track(taskId, task)` / `untrack(taskId)` / `cancelTask(taskId)` — 后台任务追踪
- `activeTaskCount` — 当前运行中的任务数（getter）

## 关键逻辑
```
executeTask(leaseId, claimToken, payload)
  1. workspaceManager.prepareWorkspace(name, repoUrl, branch)
  2. write CLAUDE.md to workDir/.claude/CLAUDE.md
  3. credentialManager.buildEnv(toolConfig) → extraEnv
  4. adapter = getBackend(provider)            // 返回 adapter 实例（仅解析器）
  5. spawnChild(provider, cmdPath, prompt, workDir, env)
       for each stdout line: adapter.parse(line) → AgentEvent[]
         onEvent: AgentEvent → client.submitMessages
  6. await child exit
  7. workspaceManager.collectDiff(workDir) → { patch, filesChanged, ... }
  8. return TaskRunnerResult(...)

eventToMessage(event)
  AgentEvent → DaemonMessage (过滤空字段)
```

## 注意事项
- output 截断限制 10000 字符，error 限制 5000 字符
- diff 收集失败不标记整个任务失败（non-fatal）
- onEvent 回调在 agent 执行过程中实时向 server 推送消息，网络异常只 warn 不中断
- adapter 的子进程 spawn 已下沉到本模块（方案 B 深化点），各 `adapters/*.ts` 只实现 `parse(line) → AgentEvent[]`
- 依赖：backends(adapter 工厂)、client(REST)、credential(渲染)、workspace(git)
- 被 cli 和 daemon 使用

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
