---
schema_version: 1
doc_type: module-card
module_id: task-runner
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:10:13
---
# task-runner

## 定位
任务执行引擎（方案 B 核心：子进程执行在此唯一一处）。接收 LeaseCtx，编排完整任务生命周期：准备 workspace → 写 CLAUDE.md → 构造 spawn env → 选 adapter → spawn agent 子进程 → 实时 parse 输出 → 收集 diff → 返回结构化结果。adapter 只解析不执行。Python `task_runner.py` + `backends/*` spawn 逻辑收敛到本类。承载 R-03（stdin 控制不挂起）、R-04（stdout 背压/编码）。

## 契约摘要
- `TaskStatus`：`pending|running|completed|failed|cancelled|timeout`。
- `LeaseCtx`（来自 types）：leaseId、claimToken、agentRunId、provider、repoUrl、branch、claudeMd、toolConfig、prompt、cmdPath、sessionId、resumeSessionId 等。
- 依赖接口（鸭子类型，便于 mock）：`RunnerHubClient`、`RunnerWorkspaceManager`、`RunnerCredentialManager`。
- `TaskRunner(client, workspaceManager, credentialManager, config)`：3 位置参数 + config。
- `runLease(ctx: LeaseCtx): Promise<TaskRunnerResult>`：核心入口（注意是 runLease 非 executeTask）。
- `track(leaseId): AbortController`、`untrack(leaseId)`、`cancel(leaseId): Promise<boolean>`、`getState(leaseId)`。
- 辅助：`resolveTimeout`、`resolveMaxRetries`、`isSpawnLevelFailure`、`renderAgentEvent`/`echoAgentEvent`/`renderTaskBoundary`/`echoTaskBoundary`。

## 关键逻辑
```
runLease(ctx):
  1. workDir = workspace.prepareWorkspace(name, repoUrl, branch, {rootPath})  # 失败→finally failed
  2. claudeMd 非空 → 写 workDir/.claude/CLAUDE.md
  3. spawnEnv = buildSpawnEnv(ctx, {credential})     # task-09 三层合并
  4. adapter = getBackend(provider)                   # 默认 claude
  5. client.startLease(leaseId, claimToken)           # 失败仅 warn
     + 启动 leaseHeartbeat 循环（检测 backend cancel → this.cancel）
  6. 重试循环（maxRetries）：cmdPath 空→failed；否则
       adapter.resetAccumulator?.()                   # 重试清累加器
       result = _spawnAndStream({cmdPath, args, opts, adapter, signal})
         spawn → for await line of stdout: adapter.parse → AgentEvent[]
                  → _eventToMessage → client.submitMessages
                  adapter 累加 usage；complete 事件提 sessionId/stats
       if isSpawnLevelFailure(result) && attempt<maxRetries → 清 resumeSessionId 重试
  7. collectDiff(workDir) → patch(≤50000 截断)/stats  # 失败仅 warn
  8. _finish: success = (status==='completed' && exitCode===0) → 返回 TaskRunnerResult
```

## 注意事项
- 入口名 `runLease(ctx)`，不是 executeTask；daemon 在状态机 step3 构造 LeaseCtx 传入。
- **超时优先级**（resolveTimeout）：`lease.metadata.timeout_seconds > daemon config > 默认`。
- **spawn 重试**（isSpawnLevelFailure）：可重试 timeout/ENOENT/OOM/segfault/killed；不重试 cancelled/businessError(is_error)/业务非零退出。重试清 resumeSessionId（R-10，避免 --resume 重复 side-effect）+ retryCount 入 metadata。
- **env 铁律（R-09）**：token 不入日志/submitMessages/complete_lease payload/前端；env 日志必先经 redactEnv。
- output 截断 10000 字符，error 截断 5000 字符；patch 截断 MAX_PATCH_CHARS=50000（≤51200 避后端双截断）。
- collectDiff / startLease / submitMessages 失败均 non-fatal（仅 warn），不中断任务。
- stats（costUsd/inputTokens/outputTokens/numTurns/sessionId/durationMs）从 adapter 累加 usage + complete 事件 metadata 提取。
- 依赖：adapters、client、credential、spawn-env、workspace、spec-sync、cmd-shim、terminal-observer。被 cli、daemon 使用。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
