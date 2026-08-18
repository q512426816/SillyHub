---
schema_version: 1
doc_type: module-card
module_id: task-runner
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 任务执行引擎（task-runner）

## 定位
任务执行引擎（`src/task-runner.ts`，~3150 行，方案 B 核心：agent 子进程执行在此
唯一一处，adapter 仅解析不执行）。接收 LeaseCtx 编排 batch lease 完整生命周期：
准备 workspace → spec 拉取（版本保鲜）→ skills 接线 → spawn env → adapter →
spawn + 流式 parse → git diff → 汇总 TaskResult。附带两个不启 agent 的轻量分支：
init lease（_runInitLease 委托 spec-sync.handleInitLease）与 change 文件写入
（runChangeWrite）。承载 R-03（stdin 控制不挂起）、R-04（stdout 背压/编码）、
R-06（LEASE_CANCEL 即时杀）。

## 契约摘要
- `TaskStatus` 6 态：`pending | running | completed | failed | cancelled | timeout`。
- `TaskRunner(client, workspace, credential, config?, resilience?, policyCache?,
  policyEngine?, detectedAgents?)`——8 参构造全依赖注入；client/workspace/credential
  用本地鸭子接口 `RunnerHubClient` / `RunnerWorkspaceManager` /
  `RunnerCredentialManager`（不 import 具体类，便于 mock）。
- 追踪与取消：`track(leaseId): AbortController`（幂等）、`untrack`、
  `cancel(leaseId): Promise<boolean>`（abort 信号 + 置 cancelled；不在追踪集返
  false）、`getState`、`activeTaskCount`。
- `runLease(ctx: LeaseCtx): Promise<TaskRunnerResult>`——主入口；init lease 分支
  探测 mode/purpose/init_mode === 'init' 时转 `_runInitLease`（不 spawn）。
- `runChangeWrite(ctx: ChangeWriteCtx): Promise<ChangeWriteResult>`——平台下发
  change 文件写入，kind：`create`/`edit`（写 `changes/<changeKey>/` + sync 回灌）
  / `spec-sync`（仅整树回灌不写文件）；`validateChangeWritePath` 四类 traversal
  校验（绝对路径 / Win 盘符 / `..`·`.` 段 / changes 前缀必须匹配 changeKey）。
- 纯函数导出：`SILLYSPEC_VALID_TOOLS`（claude/cursor/openclaw/codex/gemini/opencode
  6 值）、`mapDetectedToSillyspecTools`（探测结果同名交集）、`resolveTimeout` /
  `resolveMaxRetries` / `isSpawnLevelFailure`、`buildSkillPrompt` /
  `detectSkillInvoked`、`mergeAdapterUsage`、`extractBudgetUsageTokens`、
  `renderAgentEvent` / `renderTaskBoundary` / `echoTaskBoundary`。
- `TaskRunnerResult`：TaskResult + status + sessionId + stats（cost/tokens/turns
  透传）+ metadata.retry_count。
- 依赖：adapters、adapter-json-rpc、spawn-env、claude-settings、cmd-shim、
  skill-manager、config、resilience、policy、spec-sync、terminal-observer、
  tool-kind、types；被 cli / daemon 使用。

## 关键逻辑
```
runLease(ctx):
  init lease → _runInitLease（不启 agent）并 return
  workDir = prepareWorkspace(rootPath 优先, 失败回落 mirror)
  spec 保鲜: lease.latest_spec_version == 本地 .runtime/spec-version.json
    → 跳过 pull；否则 pullSpecBundle + bumpLocalSpecVersion（失败仅 warn 不致命）
  linkSkillsToWorkdir + skill_refs 子集裁剪；spawnEnv = buildSpawnEnv
  allowed_roots 冻结快照（D-003）: PolicyCache.get(runtimeId) ∩ effective_allowed_roots
  重试循环: _spawnAndStream（readline 逐行 adapter.parse → _eventToMessage
    → resilience.submitWithRetry；control_request 经 adapter.onControl 写回 stdin）
    isSpawnLevelFailure && attempt < maxRetries → 清 resumeSessionId 重试（R-10）
  budget 软切断（task-08）: input+output 累计 ≥ budget_tokens → 发事件一次,
    不硬杀当前 attempt, 仅拦下一 attempt（D-006）
  collectDiff（失败仅 warn）→ specRoot 非空则 postSpecSync 回灌（失败仅 warn）
  → _finish 汇总（stage lease 检测 detectSkillInvoked 兜底 failed）
cancel(leaseId): daemon 收 MSG.LEASE_CANCEL → ac.abort()
  → _spawnAndStream 监听 signal → _killChild(SIGTERM) → 2s killTimer SIGKILL
```

## 注意事项
- **LEASE_CANCEL 即时杀**：daemon `_handleWsMessage` 收到即调 taskRunner.cancel
  （非阻塞），复用 AbortController → _killChild 即时杀 batch 子进程不等心跳周期；
  与心跳轮询双触发幂等由 cancel 内部保证（design R-06）。
- 重试判定（isSpawnLevelFailure）：可重试 timeout / spawn ENOENT / OOM / segfault /
  killed；不重试 cancelled / businessError（claude is_error）/ completed / 业务
  非零退出；重试清 resumeSessionId（防 --resume 重复 side-effect）。
- budget 口径严格 = input_tokens + output_tokens（**不含** cache_read /
  cache_creation），per-lease 跨 attempt 累加；budget_tokens undefined → 整段
  检查点短路（零回归）。
- allowed_roots 冻结语义（D-003）：spawn 那刻取 PolicyCache 快照，跑 batch 期间
  不随 WS POLICY_UPDATE 热更新变；新起 batch 才再读。effective_allowed_roots
  （backend 算好的 daemon ∩ overlay 交集）与物理沙箱再 ∩ 防御性收紧（D-013）。
- batch Codex 带内审批（task-17 / R-06）：approval server request 对每个写路径调
  policyEngine.canWrite，全 allow → stdin 写 accept，任一 deny → decline；未注入
  policyEngine → fail-closed decline。
- 截断常量：MAX_OUTPUT=50000、MAX_ERROR=5000、TOOL_RESULT_PREVIEW_MAX=100000、
  MAX_STDERR_FORWARD=50（stderr 实时转发防风暴）、KILL_GRACE_MS=2000、
  patch ≤ MAX_PATCH_CHARS=50000（workspace 模块，避后端双截断）。
- spec pull 失败不致命（FR-05 按需）：agent 仍按 workDir 自身 .sillyspec 执行；
  sync 失败不改写 agent 结果、不把 success 改 failed（R-03）。
- renderAgentEvent / echoTaskBoundary 走 process.stdout.write 不走 logger（debug
  级默认被过滤，违背「随时能看到」），单条截断 ECHO_MAX_LEN=2000 防刷屏。
- prompt 提交记 user_input 日志条目（claude 秒退时 agent 日志可见派发内容）；
  stage_dispatch 且 prompt 空 → buildSkillPrompt(stageMeta) 替代。

## 人工备注

<!-- MANUAL_NOTES_START -->
- ql-20260816-002：`runChangeWrite` 的 `kind=spec-sync` 分支读 `files[0].root_path`（backend 透传宿主仓库根）——命中且 `<root>/.sillyspec` 存在则打包主仓整树（与 get_spec_bundle RPC 同源，platform-managed 下 daemon 缓存是旧 pull 快照推不出新 change）；目录缺失/未透传（旧 backend）降级回 `resolveSpecDir` 缓存目录，向后兼容。`ChangeWriteFile` 加可选 `root_path` 字段（daemon.ts claim 映射保留元信息）。守护测试 3 个（分流/降级/兼容）。
<!-- MANUAL_NOTES_END -->
