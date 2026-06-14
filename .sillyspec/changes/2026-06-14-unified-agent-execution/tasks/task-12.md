---
author: qinyi
created_at: 2026-06-14T17:56:00
change: 2026-06-14-unified-agent-execution
stage: plan
id: task-12
title: daemon 测试（execution-context fetch + CLAUDE.md 写入 + stats + 截断 + token + 超时 + 重试）
priority: P0
depends_on: [task-05, task-06, task-07, task-09, task-10]
blocks: [task-13]
allowed_paths:
  - sillyhub-daemon/tests/execution-context.test.ts
  - sillyhub-daemon/tests/daemon-parity.test.ts
  - sillyhub-daemon/tests/spawn-env.test.ts
  - sillyhub-daemon/tests/task-runner-retry-timeout.test.ts
---

# task-12: daemon 测试（execution-context fetch + CLAUDE.md 写入 + stats + 截断 + token + 超时 + 重试）

> 对应 plan §Wave 5（48-52）、任务总表 task-12（69）；全局验收 6 / 7 / 8 / 9 / 10；风险 R-07（stats 断点）/ R-09（token 泄漏）/ R-10（重试 side-effect）/ R-12（Phase 4.5 改动面）。
> 对应 design §Phase 5（213-216）、§Phase 4.5 A1-A4 + B1-B3（137-211）、§6 文件清单（232/239/240）。

## 前置依赖核实（execute 时不可省）

1. **task-05 已 merge**：`daemon.ts:_runLeaseStateMachine` claim 后新增 execution-context fetch 步骤；`HubClient.getExecutionContext` 方法已存在；`LeaseCtx` 新增 `claudeMd/repoUrl/branch/allowedPaths/toolConfig` 字段；task-runner 写 CLAUDE.md 生效；`prepareWorkspace` 真实 clone。
2. **task-06 已 merge**：`stream-json.ts:extractResultStats` 拆 usage 为 input/output_tokens 并累加；`task-runner._finish` 透传 stats；`daemon.ts:completeLease` payload 补 stats。
3. **task-07 已 merge**：`workspace.ts:collectDiff` 增加 50KB 截断 + stat_summary 生成。
4. **task-09 已 merge**：`spawn-env.ts`（新文件）注入 token + tool_config.env 到 claude 子进程 env。
5. **task-10 已 merge**：`task-runner.ts` 超时从 lease.metadata/config 读（优先级链）+ spawn 级失败自动重试 N 次。

> **测试目录纠正**：design/plan 写的路径 `sillyhub-daemon/src/__tests__/` **不正确**。vitest 配置（`sillyhub-daemon/vitest.config.ts:6`）`include: ['tests/**/*.test.ts']`，既有测试全部在 `sillyhub-daemon/tests/`（非 `src/__tests__/`）。本任务测试文件落在 `sillyhub-daemon/tests/`，与既有 task-runner.test.ts / workspace.test.ts / hub-client.test.ts 同目录。

## 修改文件

- `sillyhub-daemon/tests/execution-context.test.ts` — **新建**（task-05 覆盖：fetch + CLAUDE.md 写入 + 真实 clone）
- `sillyhub-daemon/tests/daemon-parity.test.ts` — **新建**（task-06/07 覆盖：A2 stats 写回 + A4 截断）
- `sillyhub-daemon/tests/spawn-env.test.ts` — **新建**（task-09 覆盖：B1 token 注入）
- `sillyhub-daemon/tests/task-runner-retry-timeout.test.ts` — **新建**（task-10 覆盖：B2 超时 + B3 重试）

> **A1 实时流验证**：plan 验收 6（daemon submit_messages publish `agent_run:{id}` channel）的验证涉及后端 Redis publish，属后端集成测试范畴。A1 链路在 design A1 已核实「等价」（daemon/service.py:612-615 已 publish），本任务在 `daemon-parity.test.ts` 用单元测试断言 `submitMessages` 被调用（mock HubClient），后端 Redis publish 行为由 task-11 或既有 daemon 后端测试覆盖，不在本任务重复。

## 测试框架核实（生效路径，非臆断）

- **命令**：`cd sillyhub-daemon && pnpm test`（package.json:16 = `vitest run --passWithNoTests`；**不是 jest**）。`.sillyspec/.runtime/local.yaml` **无** `daemon_test` 命令（仅 backend_test/frontend_test），daemon 测试走子项目 npm script。
- **目录**：`sillyhub-daemon/tests/`（vitest.config.ts:6 include `tests/**/*.test.ts`）；既有 20 个测试文件 + `tests/helpers/fake-child.ts`。
- **mock 模式**：`vi.mock('node:child_process')` 提升 + `createFakeChild` 驱动 stdout 行（task-runner.test.ts:18-26）；`vi.stubGlobal('fetch')` mock REST（hub-client.test.ts:30-50）；`vi.fn` mock 依赖。
- **既有测试参考**：`tests/task-runner.test.ts`（35 it，TaskRunner 编排全链路）、`tests/workspace.test.ts`（collectDiff + prepareWorkspace clone，含 `makeOriginRepo` helper）、`tests/hub-client.test.ts`（REST mock 模式 + HubHttpError）、`tests/stream-json.test.ts`（adapter parse）。
- **类型**：`LeaseCtx` / `AgentEvent` / `ExecutionContextPayload`（task-05 新增）/ `TaskRunnerResult` 从 `src/types.ts` import。

## 实现要求

### 测试文件 1：`execution-context.test.ts`（task-05 覆盖）

#### `describe('daemon.ts execution-context fetch')`

- `test_claim_then_fetch_execution_context`：mock HubClient.claimLease 返回 lease + mock getExecutionContext 返回 bundle → 触发 `_runLeaseStateMachine` → 断言 getExecutionContext 被调用且参数为 agentRunId；断言 LeaseCtx.claudeMd/repoUrl/branch/allowedPaths/toolConfig 非空（原 daemon.ts:629-649 这些字段恒 undefined，task-05 补齐）。
- `test_fetch_failure_propagates`：mock getExecutionContext 抛 HubHttpError → `_runLeaseStateMachine` 不执行 task，complete_lease 上报失败（exit_code 非零 + error 含 fetch 失败信息）。
- `test_fetch_timeout`：mock getExecutionContext 长时间挂起 → 超时后走失败路径（设计 Phase 4 R-03 应对：fetch 超时重试/失败，具体行为以 task-05 实现为准）。

#### `describe('task-runner CLAUDE.md 写入')`

- `test_claude_md_written_to_workdir`：构造 LeaseCtx.claudeMd="<markdown>" → 触发 task-runner runLease → 断言 `${workDir}/.claude/CLAUDE.md` 文件存在且内容等于 LeaseCtx.claudeMd（task-runner.ts:262 原本条件写入，claudeMd 为 undefined 时不写；task-05 后 claudeMd 非空则必写）。用真实临时目录 + fs 断言（参考 workspace.test.ts 的 mkdtemp 模式）。
- `test_no_claude_md_when_empty`：LeaseCtx.claudeMd 为空/undefined → CLAUDE.md 文件不创建（保留旧行为，避免误覆盖）。

#### `describe('prepareWorkspace real clone')`

- `test_clone_with_real_repo_url`：LeaseCtx.repoUrl + branch 非空 → prepareWorkspace 调用 git clone（mock execFileSync 或用 makeOriginRepo 临时仓库）；断言 clone 命令含 repoUrl + branch，**不**走 `repoUrl ?? undefined` / `branch ?? 'main'` 兜底（task-05 退役兜底）。
- `test_clone_fallback_removed`：静态断言 —— `grep -n "repoUrl ?? undefined\|branch ?? 'main'" sillyhub-daemon/src/task-runner.ts` 无命中（兜底退役）。
- `test_allowed_paths_enforced`：LeaseCtx.allowedPaths 非空 → spawn claude 时 `--allowed-paths`（或对应机制）传入 allowedPaths（若 claude CLI 无原生支持，验证 tool_config 层面的路径限制）。

> **对齐 plan 验收 2（daemon 侧）**：daemon 拿到完整 bundle 上下文。

### 测试文件 2：`daemon-parity.test.ts`（task-06/07 覆盖，A2 + A4）

#### `describe('A2 stats passthrough')`

- `test_extract_result_stats_splits_usage`：adapter `extractResultStats` 接收含多 message 的 usage 对象（如 `[{input_tokens:10,output_tokens:5}, {input_tokens:20,output_tokens:8}]`）→ 返回 input_tokens=30 + output_tokens=13（跨 message 累加，对齐 SERVER `_extract_result_metadata`，R-07 应对）。
- `test_finish_passes_stats_to_complete_lease`：task-runner `_finish` 触发 → mock HubClient.completeLease 捕获调用参数 → 断言 `result.stats` 非空且含 total_cost_usd/duration_ms/input_tokens/output_tokens/session_id（task-06 补全：原 daemon.ts:662 只传 durationMs）。
- `test_complete_lease_payload_has_stats`：daemon.ts completeLease 调用的 payload 含 stats 字段（含 tokens）；断言 stats.tokens.input/output 与 adapter 累加结果一致。
- `test_result_message_cost_non_empty`：模拟 claude result 消息（stream-json.ts:144 result event）→ 最终 completeLease 上报的 stats 对齐 result 消息的 cost/duration。

> **对齐 plan 验收 7**：daemon 执行后 total_cost_usd/duration_ms/input_tokens/output_tokens/num_turns/session_id/exit_code 非空且对齐 claude result 消息（R-07 补全验证）。

#### `describe('A4 diff truncation + stat_summary')`

- `test_collect_diff_truncates_at_50kb`：构造 >50KB 的 git diff（workspace.test.ts 的 makeOriginRepo + 大量修改）→ collectDiff 返回的 patch 长度 ≤ 51200（50*1024）；task-07 截断逻辑生效。
- `test_collect_diff_generates_stat_summary`：collectDiff 返回含 stat_summary 字段（人可读串，如 "3 files changed, 10 insertions(+), 2 deletions(-)"），对齐 SERVER diff_collector 的 stat_summary。
- `test_large_diff_100kb_truncated`：构造 >100KB diff → patch ≤ 51200（验收 8「大 diff 不撑爆 complete_lease payload」）。
- `test_redact_not_in_daemon`：静态断言 —— daemon 侧**不**做 redact（redact 单一真相源在后端 complete_lease，design A4 方案 b）；`grep -n "redact" sillyhub-daemon/src/workspace.ts` 无命中（或仅注释说明 redact 由后端做）。

> **对齐 plan 验收 8（daemon 侧）**：daemon 上报 diff 经 50KB 截断（patch 长度 ≤ 51200）。redact 在后端（task-11 覆盖）。

### 测试文件 3：`spawn-env.test.ts`（task-09 覆盖，B1）

#### `describe('B1 token injection')`

- `test_build_spawn_env_includes_anthropic_key`：构造 credentials.json 含 ANTHROPIC_API_KEY + tool_config.env → spawn-env.buildSpawnEnv 返回的 env 对象含 `ANTHROPIC_API_KEY`（claude 子进程能鉴权）。
- `test_oauth_token_injected`：credentials.json 含 OAuth token → env 注入对应变量（如 `CLAUDE_OAUTH_TOKEN`，具体变量名以 task-09 实现为准）。
- `test_tool_config_env_merged`：tool_config.env 段（如 `{"FOO":"bar"}`）→ merge 进 spawn env。
- `test_token_not_in_logs`：spawn 后 daemon 日志（mock logger）**不**含 token 值；断言 logger 调用参数中无 token 字符串（R-09 应对）。
- `test_token_not_in_redis_publish`：submitMessages publish 的 payload（mock HubClient.submitMessages 捕获）**不**含 token。
- `test_token_not_returned_to_frontend`：completeLease 上报的 result（mock 捕获）**不**含 token 字段。
- `test_env_dump_redacted`：若 spawn-env 有 env dump 功能（调试用），dump 输出经 redact（token 替换为 `[REDACTED]`）。

> **对齐 plan 验收 9**：token 注入 claude 子进程 env 生效；token 不入日志 / 不入 Redis publish / 不回传前端 / env dump 经 redact。

### 测试文件 4：`task-runner-retry-timeout.test.ts`（task-10 覆盖，B2 + B3）

#### `describe('B2 configurable timeout')`

- `test_timeout_from_lease_metadata`：LeaseCtx.metadata.timeout_seconds=5 → task-runner 看门狗超时 = 5s（mock setTimeout 捕获 delay 值，或用 fake timers）。
- `test_timeout_priority_chain`：lease.metadata.timeout_seconds > daemon config > 默认。构造三种来源 → 断言优先级：metadata 值覆盖 config，config 覆盖默认。
- `test_timeout_triggers_failure`：超时触发 → claude 子进程被 SIGTERM（或对应终止）+ completeLease 上报 failed + exit_code 反映超时。

#### `describe('B3 spawn-level retry')`

- `test_retry_on_non_zero_exit`：mock spawn 第一次 exit code=1（非零，非用户 cancel，非业务 is_error）→ 自动重试 1 次；第二次成功 → 最终 completeLease 上报 success；metadata 含 retry_count=1。
- `test_retry_on_timeout`：超时触发重试（同上，第二次成功）。
- `test_no_retry_on_user_cancel`：用户 cancel（SIGINT/调用 kill）→ **不**重试，直接 failed/killed。
- `test_no_retry_on_business_is_error`：claude result 消息 `is_error: true`（业务报错）→ **不**重试，直接 failed（design B3 边界）。
- `test_retry_clears_workspace`：重试前 workspace 残留被清理（mock workspace.clean 或断言 prepareWorkspace 重新 clone）。
- `test_retry_no_resume_session_id`：重试时 spawn claude **不**传 resume_session_id（避免重复 side-effect，R-10 应对）；断言第二次 spawn 的参数无 `--resume`。
- `test_retry_count_in_metadata`：重试次数写入 lease.metadata 或 completeLease payload（供排查）。
- `test_retry_exhausted_then_failed`：重试 N 次（默认 1）后仍失败 → 标 failed（不无限重试）。

> **对齐 plan 验收 10**：spawn 级失败自动重试 1 次后仍失败才标 failed；重试不传 resume_session_id、重试次数记 metadata；业务 is_error 不重试。

### 共用 helper / mock 模式

```typescript
// 复用 tests/helpers/fake-child.ts 的 createFakeChild（驱动 stdout 行 + exit）
// 复用 workspace.test.ts 的 makeOriginRepo（构造本地 git 仓库）
// 复用 hub-client.test.ts 的 mockFetchOk / mockFetchStatus（REST mock）
// 新增 helper（若需）：
//   - makeExecutionContextPayload(overrides): ExecutionContextPayload（task-05 类型）
//   - makeStatsWithUsage(messages): 模拟多 message usage 累加输入
//   - makeLargeDiff(sizeKb): 构造指定大小的 diff 字符串
```

### 现有测试不破坏

- task-runner.test.ts（35 it）、workspace.test.ts、hub-client.test.ts、stream-json.test.ts 等既有测试**不改**（除非 task-05~10 改了既有接口签名导致既有测试 RED，此时按 task-05~10 的接口变更同步修既有测试，本任务负责验收新行为）。
- **execute 时核实**：`cd sillyhub-daemon && pnpm test` 全绿（既有 20 测试文件 + 本任务 4 新文件）；若既有测试因 task-05~10 改签名失败，本任务需补修（与 task-05~10 协作，测试对齐新签名）。

## 边界处理

1. **（测试目录纠正）** 本任务测试落在 `sillyhub-daemon/tests/`（非 design 写的 `src/__tests__/`），对齐 vitest.config.ts include。execute 时若发现 task-05~10 把测试写到了 `src/__tests__/`，需统一迁到 `tests/`（vitest include 只认 `tests/**/*.test.ts`，`src/__tests__/` 不会被收集）。
2. **（A1 实时流验证范围）** 本任务只单测 `submitMessages` 被调用（mock HubClient）；后端 Redis publish `agent_run:{id}` channel 的行为属后端范畴，不在 daemon 测试覆盖。验收 6 的完整验证需后端 + daemon 联调（task-13 全量回归或手动）。
3. **（A3 conversation log 不测）** plan 已将 A3 降级为「保持 AgentRunLog 形态 + 记录决策」，本任务**不**测 conversation log 汇总文本生成（design A3 降级决策）。
4. **（redact 不在 daemon 测）** redact 单一真相源在后端（design A4 方案 b），本任务只静态断言 daemon 侧不做 redact；redact 行为测试在 task-11（后端）。
5. **（fake timers）** B2 超时测试用 vitest fake timers（`vi.useFakeTimers`）避免真实等待；B3 重试测试同理。
6. **（spawn mock 边界）** task-runner 测试 mock `node:child_process.spawn`（既有模式）；B3 重试需 mock spawn 多次调用（第一次失败、第二次成功），用 `mockImplementation` 按调用序号返回不同 FakeChild。
7. **（token 敏感性）** spawn-env.test.ts 的 token 断言用**固定测试字符串**（如 `"test-token-xxxxx"`），断言日志/payload/前端返回**不含**该字符串；**不**用真实 token。
8. **（coverage 无门槛）** daemon 测试命令 `vitest run --passWithNoTests` 无 coverage 门槛（与后端 `--cov-fail-under=60` 不同）；本任务关注用例覆盖而非覆盖率数字。

## 非目标

- **不**改 daemon 源码（src/）—— 那是 task-05~10 的范围；本任务只写测试。
- **不**测后端 execution-context 端点（task-11）。
- **不**测后端 NoOnlineDaemon / 状态映射 / redact（task-11）。
- **不**测 conversation log 汇总（A3 已降级）。
- **不**测后端 Redis publish（A1 后端侧，验收 6 联调属 task-13）。
- **不**跑全量回归（task-13）。
- **不**测 P2 增强（B4 workspace 缓存 / B5 stderr 日志 / B6 heartbeat 分档 / B7 资源限制 / B8 流式合并）——已拆 follow-up change。

## TDD 步骤

1. **核实前置**：`grep -n "getExecutionContext" sillyhub-daemon/src/hub-client.ts`（task-05）；`grep -n "extractResultStats" sillyhub-daemon/src/adapters/stream-json.ts` 含拆 usage 逻辑（task-06）；`grep -n "spawn-env" sillyhub-daemon/src/task-runner.ts`（task-09 接入）；`test -f sillyhub-daemon/src/spawn-env.ts`（task-09 新建）。全绿才继续。
2. **写测试**：按 4 个测试文件逐个写（execution-context → daemon-parity → spawn-env → task-runner-retry-timeout）。
3. **确认失败**（若实现就绪则跳过 RED）：针对尚未实现的部分跑 RED。
4. **确认通过**：`cd sillyhub-daemon && pnpm test` → 全绿（既有 + 新增）。
5. **回归**：`cd sillyhub-daemon && pnpm test`（plan 风险 R-12 应对：Phase 4.5 改动面大，daemon 全量测试）；若既有测试因 task-05~10 改签名失败，按「现有测试不破坏」章节修。
6. **静态断言**：`grep -n "repoUrl ?? undefined\|branch ?? 'main'" sillyhub-daemon/src/task-runner.ts` 无命中（task-05 兜底退役）。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `ls sillyhub-daemon/tests/execution-context.test.ts sillyhub-daemon/tests/daemon-parity.test.ts sillyhub-daemon/tests/spawn-env.test.ts sillyhub-daemon/tests/task-runner-retry-timeout.test.ts` | 4 文件均存在 |
| AC-02 | `cd sillyhub-daemon && pnpm test` | 全绿（既有 20 + 新增 4 文件，约 30+ 新 it） |
| AC-03 | 单测（execution-context）：`test_claim_then_fetch_execution_context` + `test_claude_md_written_to_workdir` + `test_clone_with_real_repo_url` | daemon claim 后 fetch execution-context 填充 LeaseCtx + CLAUDE.md 写入 workdir + 真实 clone 生效（对齐验收 2 daemon 侧） |
| AC-04 | 单测（daemon-parity A2）：`test_extract_result_stats_splits_usage` + `test_finish_passes_stats_to_complete_lease` | adapter 拆 usage 累加 input/output_tokens + _finish 透传 stats 到 completeLease（对齐验收 7 / R-07） |
| AC-05 | 单测（daemon-parity A4）：`test_collect_diff_truncates_at_50kb` + `test_large_diff_100kb_truncated` | patch 长度 ≤ 51200（50KB），大 diff 不撑爆 payload（对齐验收 8 daemon 侧） |
| AC-06 | 单测（spawn-env B1）：`test_build_spawn_env_includes_anthropic_key` + `test_token_not_in_logs` + `test_token_not_in_redis_publish` + `test_token_not_returned_to_frontend` | token 注入 spawn env 生效 + 不入日志/Redis/前端（对齐验收 9 / R-09） |
| AC-07 | 单测（task-runner B2）：`test_timeout_from_lease_metadata` + `test_timeout_priority_chain` | 超时从 lease.metadata 读 + 优先级链 metadata > config > 默认（对齐 B2） |
| AC-08 | 单测（task-runner B3）：`test_retry_on_non_zero_exit` + `test_no_retry_on_user_cancel` + `test_no_retry_on_business_is_error` + `test_retry_no_resume_session_id` | spawn 级失败重试 + 用户 cancel/业务 is_error 不重试 + 重试不传 resume_session_id（对齐验收 10 / R-10） |
| AC-09 | 静态：`grep -n "repoUrl ?? undefined\|branch ?? 'main'" sillyhub-daemon/src/task-runner.ts` | 无命中（task-05 兜底退役） |
| AC-10 | 静态：`grep -rn "redact" sillyhub-daemon/src/workspace.ts` | 无命中或仅注释（redact 单一真相源在后端，design A4 方案 b） |
| AC-11 | `cd sillyhub-daemon && pnpm test`（既有测试回归） | 既有 20 测试文件无因 task-05~10 改签名而红（R-12 应对） |
