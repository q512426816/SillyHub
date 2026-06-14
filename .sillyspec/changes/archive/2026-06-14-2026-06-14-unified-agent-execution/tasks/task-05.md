---
author: qinyi
created_at: 2026-06-14T17:52:18
change: 2026-06-14-unified-agent-execution
stage: plan
id: task-05
title: daemon fetch execution-context + CLAUDE.md / clone 生效
priority: P0
depends_on: [task-02, task-03]
blocks: [task-06, task-07, task-08, task-09, task-10, task-12]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/src/task-runner.ts
  - sillyhub-daemon/src/types.ts
  - sillyhub-daemon/tests/execution-context.test.ts
  - sillyhub-daemon/tests/task-runner.test.ts
---

# task-05: daemon fetch execution-context + CLAUDE.md / clone 生效

## 修改文件

- `sillyhub-daemon/src/hub-client.ts` — 新增 `getExecutionContext(agentRunId)` 方法（GET，沿用既有 `_request` + Bearer 鉴权前缀）。
- `sillyhub-daemon/src/types.ts` — 新增 `ExecutionContextPayload` 接口（design §7.3，字段全部 snake_case 与后端 Pydantic 响应对齐）。
- `sillyhub-daemon/src/daemon.ts` — `_runLeaseStateMachine`（592-672）在 claim(step1, 600)成功后、execute(step3, 649)前插入 fetch step2.5，用 `HubClient.getExecutionContext(ctx.agentRunId)` 覆盖填充 `ctx.claudeMd/repoUrl/branch/toolConfig`（当前 629-647 这些字段恒 undefined）。
- `sillyhub-daemon/src/task-runner.ts` — `runLease`（254-373）退役兜底：`const repoUrl = ctx.repoUrl ?? undefined;`（257）→ `ctx.repoUrl`；`const branch = ctx.branch ?? 'main';`（258）→ `ctx.branch`；保留 `ctx.workspaceName ?? 'default'`（256 不变）。**CLAUDE.md 写入逻辑(262-271)无需改动**——填了 ctx.claudeMd 即自动生效。
- `sillyhub-daemon/tests/execution-context.test.ts`（新增）— fetch 注入 + CLAUDE.md 写入 + clone 生效单测。

## 实现要求

1. `hub-client.ts` 新增方法（紧邻 `getPendingLeases`(351-358) 之前或之后）：
   ```typescript
   async getExecutionContext(agentRunId: string): Promise<ExecutionContextPayload> {
     return this._request<ExecutionContextPayload>(
       'GET',
       `/api/agent-runs/${encodeURIComponent(agentRunId)}/execution-context`,
     );
   }
   ```
   - **端点路径前缀**：design §7.1 端点 `GET /agent-runs/{run_id}/execution-context` 挂在 agent router，即完整路径 `/api/agent-runs/{id}/execution-context`（**不用 `REST_PREFIX`**——REST_PREFIX 是 daemon module 专用前缀，agent 端点走 `/api`）。
   - **鉴权**：沿用 `_headers()`（152-158）的 Bearer token；无 token 不带 Authorization（与既有方法一致）。
   - **超时**：复用 `DEFAULT_TIMEOUT_MS=30_000`（112）；fetch 失败按既有 `_request` 语义抛 `HubHttpError` 或透传网络错误（不包装）。
2. `types.ts` 新增接口（紧邻 `LeaseCtx`(205-244) 之后）：
   ```typescript
   /**
    * GET /api/agent-runs/{id}/execution-context 响应（daemon 拉取的完整 bundle 上下文）。
    * 字段名 snake_case 与后端 Pydantic response 一一对齐（design §7.3）。
    */
   export interface ExecutionContextPayload {
     agent_run_id: string;
     claude_md: string;
     prompt?: string;
     provider?: string;
     resume_session_id?: string;
     repo_url?: string;
     branch?: string;
     allowed_paths?: string[];
     tool_config?: Record<string, string>;
     session_id?: string;
   }
   ```
3. `daemon.ts` `_runLeaseStateMachine` 在 step1 claim(600-609) 拿到 claimToken 之后、step2 startLease(612-617) **之前**插入 fetch step（命名为 step1.5）：
   ```typescript
   // 1.5 FETCH execution-context：claim 成功后从 server 拉完整 bundle
   // 当前 ctx 构造（629-647）字段恒 undefined → 必须先 fetch 再构造 ctx
   let execCtx: ExecutionContextPayload | null = null;
   if (execPayload.agentRunId) {
     try {
       execCtx = await this._client.getExecutionContext(execPayload.agentRunId);
     } catch (e) {
       // R-03：fetch 失败不致命，继续用 payload 兜底（裸 prompt 也能跑），
       // 但记 error 供排查（CLAUDE.md/repo/branch 缺失属降级执行）
       this._logger.error('execution_context_fetch_failed', {
         lease_id: leaseId, agent_run_id: execPayload.agentRunId, error: e,
       });
     }
   }
   ```
   然后在 629-647 构造 `ctx` 时，优先用 execCtx 覆盖（fetch 优先，payload 兜底）：
   ```typescript
   const ctx: LeaseCtx = {
     leaseId,
     runtimeId,
     claimToken,
     agentRunId: execPayload.agentRunId,
     workspaceName: execPayload.workspaceName,
     // fetch 覆盖（fetch 失败 execCtx=null 时回落 payload，payload 仍可能 undefined）
     repoUrl: execCtx?.repo_url ?? execPayload.repoUrl,
     branch: execCtx?.branch ?? execPayload.branch,
     claudeMd: execCtx?.claude_md ?? execPayload.claudeMd,
     provider: execCtx?.provider ?? execPayload.provider,
     // toolConfig：fetch.tool_config 是 snake_case Record，payload.toolConfig 是 camelCase
     toolConfig: execCtx?.tool_config ?? execPayload.toolConfig,
     // resumeSessionId 优先用 fetch（端点是最新源）；session_id 兜底
     resumeSessionId: execCtx?.resume_session_id ?? execPayload.resumeSessionId,
     sessionId: execCtx?.session_id ?? execPayload.sessionId,
     cmdPath: execPayload.cmdPath,
     cmd: execPayload.cmd,
     prompt: execPayload.prompt,  // prompt 不覆盖：payload.prompt 已是 dispatch 时传的最终 prompt
     model: execPayload.model,
     timeout: execPayload.timeout,
   };
   ```
   - **fetch 失败语义**（R-03）：execCtx=null → 字段回落 payload（仍可能 undefined）→ task-runner 走裸 prompt 降级，不中断 lease（claim 已扣 token，中断会留 dangling lease）。
   - **必须放在 startLease(612) 之前**：startLease 触发 server 把 lease 标 claimed、AgentRun → running；若 startLease 后 fetch，running 期间再拉 bundle 增加窗口期延迟；放 startLease 前让 fetch 属于 claim-claimed 的过渡态。
4. `task-runner.ts` 退役兜底（257-258）：
   ```typescript
   // 改前
   const repoUrl = ctx.repoUrl ?? undefined;
   const branch = ctx.branch ?? 'main';
   // 改后（退役兜底，让 undefined 透传到 prepareWorkspace 走真实分支）
   const repoUrl = ctx.repoUrl;
   const branch = ctx.branch;
   ```
   - `prepareWorkspace(wsName, repoUrl, branch)`（259）的既有三分支逻辑（138-146）能接受 undefined：repoUrl undefined → 走分支3（创建空目录，`workspace.ts:140-143`）。退役兜底后 `repoUrl ?? undefined` 与 `repoUrl`（已是 undefined）等价，`branch ?? 'main'` 改为直接传 branch 让 prepareWorkspace 内部按需处理（**prepareWorkspace 现有签名接受 `branch?: string`**，内部 `git clone --branch` 在 branch 为 undefined 时 clone 默认分支——需 execute 时确认 workspace.ts prepareWorkspace 的 branch 处理）。
   - **CLAUDE.md 写入（262-271）零改动**：`if (ctx.claudeMd && ctx.claudeMd.length > 0)` 在 ctx.claudeMd 被 fetch 填充后自动进入分支写 `.claude/CLAUDE.md`。
5. 新增测试文件 `tests/execution-context.test.ts`（项目实际惯例是 `tests/`，非 `src/__tests__/`，对齐 vitest.config 的 `include: ['tests/**/*.test.ts']`）：
   - case1：mock HubClient.getExecutionContext 返回 `{ claude_md: '# Hi', repo_url: 'https://github.com/x/y', branch: 'dev', tool_config: { K: 'V' } }` → 断言 ctx.claudeMd/repoUrl/branch/toolConfig 被覆盖；mock TaskRunner.runLease 收到的 ctx 含这些字段。
   - case2：fetch 抛 HubHttpError(500) → 仍调 runLease，ctx 字段回落 undefined，lease 不中断（completeLease 被调用）。
   - case3：mock TaskRunner.runLease → 断言 `fs.writeFile` 被调用且内容含 `# Hi`（CLAUDE.md 写入生效）—— 用 vitest spy on `fs/promises.writeFile`。
   - case4：ctx.claudeMd 为空字符串 → writeFile **不**被调用。

## 接口定义

```typescript
// hub-client.ts 新增方法
class HubClient {
  async getExecutionContext(agentRunId: string): Promise<ExecutionContextPayload>;
}

// types.ts 新增接口（snake_case 与后端响应对齐）
interface ExecutionContextPayload {
  agent_run_id: string;
  claude_md: string;
  prompt?: string;
  provider?: string;
  resume_session_id?: string;
  repo_url?: string;
  branch?: string;
  allowed_paths?: string[];
  tool_config?: Record<string, string>;
  session_id?: string;
}

// daemon.ts _runLeaseStateMachine 插入位置：claim(600-609) 之后、startLease(612) 之前
// ctx 构造（629-647）字段覆盖：execCtx?.snake_field ?? execPayload.camelField

// task-runner.ts runLease（257-258）：
// 改前 const repoUrl = ctx.repoUrl ?? undefined;
// 改后 const repoUrl = ctx.repoUrl;
// 改前 const branch = ctx.branch ?? 'main';
// 改后 const branch = ctx.branch;
```

## 边界处理

1. **null/空值**：`execCtx=null`（fetch 失败）时所有覆盖字段回落 payload 原值；payload 字段也 undefined 时透传 undefined 给 task-runner，task-runner 既有三分支 workspace.prepareWorkspace 能处理 undefined repoUrl（走空目录分支）。
2. **brownfield 兼容**：design §9 授权破坏性切换，无 SERVER 路径残留；claim payload 形态不变（task-03 在 payload 内补字段但仍是 LeasePayload 结构）；ctx 字段映射兼容既有运行（payload 优先级低于 fetch）。
3. **异常不静默吞**：fetch 失败走 `this._logger.error('execution_context_fetch_failed', ...)`（非 warn），保证可观测；不抛出（claim 已扣 token，中断留 dangling lease）。
4. **参数不可变**：execPayload 来自 claimResp，不直接 mutate（用新 ctx 对象构造）；execCtx 是 read-only response。
5. **歧义/冲突**：fetch.tool_config（snake_case）vs payload.toolConfig（camelCase）—— fetch 优先（端点是 task-03 之后的最新源）；prompt 字段**不**从 fetch 覆盖（dispatch 时已写入 lease.metadata 的 prompt 是最终意图，避免端点重建 prompt 时的潜在差异）。
6. **路径前缀歧义**：daemon REST 端点用 `REST_PREFIX=/api/daemon`，agent 端点用 `/api`；fetch 用 `/api/agent-runs/...`（agent 路由前缀），**禁止**用 REST_PREFIX 拼接（会导致 `/api/daemon/agent-runs/...` 404）。
7. **run 类型分发**：execution-context 端点（task-02）内部按 run 类型分发（task/stage/scan），daemon 不关心类型——所有类型都返回 ExecutionContextPayload 同结构，daemon 无分支。

## 非目标

- 不改 task-runner 步骤 3-9（credential.buildEnv / getBackend / spawn / collectDiff）——这些在 task-06/07/10 改。
- 不实现 token 注入 spawn env（task-09）。
- 不改 `_spawnAndStream` 内部逻辑。
- 不在后端 `dispatch_to_daemon` 改 payload 字段（task-03 负责 `_build_claim_payload` 透传 repo_url/branch/allowed_paths/tool_config）。
- 不实现 execution-context 端点本身（task-02）。

## TDD 步骤

1. **写测试** → 新增 `__tests__/execution-context.test.ts` 4 个 case（见实现要求 5）。
2. **确认失败** → `cd sillyhub-daemon && pnpm vitest run execution-context`（HubClient.getExecutionContext 不存在，编译错或方法 undefined）。
3. **写实现** → types.ts + hub-client.ts + daemon.ts + task-runner.ts 顺序改。
4. **确认通过** → `cd sillyhub-daemon && pnpm vitest run execution-context` 全绿。
5. **回归** → `cd sillyhub-daemon && pnpm test`（task-12 的 daemon-parity 后续补，本任务只跑 execution-context + 既有 daemon/task-runner 套件不退化）。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `grep -n "getExecutionContext" sillyhub-daemon/src/hub-client.ts` | 命中方法定义，签名 `async getExecutionContext(agentRunId: string): Promise<ExecutionContextPayload>` |
| AC-02 | `grep -n "ExecutionContextPayload" sillyhub-daemon/src/types.ts` | 命中 interface 定义，含 `claude_md / repo_url / branch / tool_config / allowed_paths / session_id` 字段 |
| AC-03 | `grep -n "getExecutionContext" sillyhub-daemon/src/daemon.ts` | 命中 `_runLeaseStateMachine` 内调用，位于 `claimLease`(600) 之后、`startLease`(612) 之前 |
| AC-04 | `grep -n "ctx.repoUrl ?? undefined\|ctx.branch ?? 'main'" sillyhub-daemon/src/task-runner.ts` | **无命中**（兜底退役） |
| AC-05 | `cd sillyhub-daemon && pnpm vitest run execution-context` | 4 case 全绿，含 fetch 失败降级、CLAUDE.md 写入生效、空 claudeMd 不写 |
| AC-06 | `cd sillyhub-daemon && pnpm test`（不含 task-12 新增 daemon-parity） | 既有套件无退化（执行前 baseline 全绿） |
| AC-07 | 端到端冒烟（需 task-02 端点就绪）：启动 daemon + 触发一个 task run | daemon 日志出现 `task_completed` 且 AgentRun.output_redacted 非 `裸 prompt`（证明 CLAUDE.md 生效，claude 拿到了 bundle 上下文）—— 本任务冒烟依赖 task-02，独立单元验收用 AC-05 |
