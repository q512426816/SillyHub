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
- `TaskRunnerResult` — 执行结果类型：success, exitCode, patch, filesChanged, insertions, deletions, output, error, durationMs, metadata, **stats**（task-06 新增：costUsd/inputTokens/outputTokens/numTurns/sessionId/durationMs，跨 message 累加 usage）
- `TaskRunner(client, workspaceManager, credentialManager)` — 初始化
- `executeTask(leaseId, claimToken, payload): Promise<TaskRunnerResult>` — 核心入口，完整执行流程
- `track(taskId, task)` / `untrack(taskId)` / `cancelTask(taskId)` — 后台任务追踪
- `activeTaskCount` — 当前运行中的任务数（getter）

## 关键逻辑
```
executeTask(leaseId, claimToken, payload)
  1. ctx = client.getExecutionContext(agentRunId)        # task-05：fetch bundle（替代裸 prompt）
  2. workspaceManager.prepareWorkspace(name, ctx.repoUrl, ctx.branch)  # 真实 clone 生效，退役 ?? undefined 兜底
  3. write ctx.claudeMd → workDir/.claude/CLAUDE.md
  4. env = buildSpawnEnv({ toolConfig: ctx.toolConfig, credentials }, opts)  # task-09：spawn-env 模块（三层合并）
  5. adapter = getBackend(provider)            # 仅解析器
  6. spawnChildWithRetry(...)                   # task-10：超时(lease.metadata.timeout_seconds > config > 默认) + spawn 级失败重试
       for each stdout line: adapter.parse(line) → AgentEvent[]
         adapter 累加 usage(input_tokens/output_tokens)            # task-06：stats 累加
         onEvent: AgentEvent → client.submitMessages
  7. await child exit
  8. workspaceManager.collectDiff(workDir) → { patch(≤50000 截断), stat_summary, ... }  # task-07
  9. return TaskRunnerResult({ ..., stats: adapter.extractResultStats() })  # task-06

spawnChildWithRetry（task-10 B2/B3）
  超时来源优先级：lease.metadata.timeout_seconds > daemon config > 默认
  可重试：timeout / ENOENT / OOM / segfault / killed（isSpawnLevelFailure）
  不重试：cancelled / businessError(is_error=true) / 业务非零退出
  重试防护：清 resumeSessionId（避免 --resume 重复 side-effect）+ retryCount 入 metadata + adapter 累加器重置

eventToMessage(event)
  AgentEvent → DaemonMessage (过滤空字段)
```

## 注意事项
- output 截断限制 10000 字符，error 限制 5000 字符
- diff patch 截断 `MAX_PATCH_CHARS=50000`（≤51200 避后端双截断），超限加 `\n...[truncated]` 尾标，附带 `stat_summary`（task-07）
- diff 收集失败不标记整个任务失败（non-fatal）
- onEvent 回调在 agent 执行过程中实时向 server 推送消息，网络异常只 warn 不中断
- adapter 的子进程 spawn 已下沉到本模块（方案 B 深化点），各 `adapters/*.ts` 只实现 `parse(line) → AgentEvent[]`
- **env 注入**（task-09）：经 `spawn-env.buildSpawnEnv` 三层合并，token **不入**日志 / submitMessages / complete_lease payload / 前端；env 相关日志必先经 `redactEnv`
- **超时可配**（task-10 B2）：`lease.metadata.timeout_seconds > daemon config > 默认` 优先级链
- **spawn 重试**（task-10 B3）：仅 spawn 级失败重试 1 次，重试清 `resumeSessionId` + `retryCount` 入 metadata；业务 `is_error` 不重试（side-effect 优先）
- 依赖：backends(adapter 工厂)、client(REST + execution-context)、credential(渲染)、spawn-env(env 构造)、workspace(git)
- 被 cli 和 daemon 使用

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
