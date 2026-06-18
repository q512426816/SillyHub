---
author: qinyi
created_at: 2026-06-18T22:41:08
change: 2026-06-18-daemon-interactive-session
id: task-09
title: "审批暂停/退出收敛 + GLM 错误透传验证（SDK canUseTool 收敛 + tool_result(is_error) 透传）"
wave: W4
priority: P1
estimated_hours: 10
depends_on: [task-08]
blocks: []
requirement_ids: [FR-07, FR-08b]
decision_ids: [D-007@v1, D-008@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/claude-sdk-driver.ts
  - sillyhub-daemon/src/interactive/session-manager.ts
  - sillyhub-daemon/src/interactive/types.ts
  - sillyhub-daemon/tests/interactive/claude-sdk-driver-permission.test.ts
  - sillyhub-daemon/tests/interactive/claude-sdk-driver-glm-passthrough.test.ts
  - sillyhub-daemon/tests/interactive/session-manager-pending-cleanup.test.ts
  - backend/app/modules/agent/service.py
  - backend/app/modules/agent/schemas.py
  - backend/tests/modules/agent/test_tool_failure_monitor.py
---

# task-09：审批暂停/退出收敛 + GLM 错误透传验证（v3 重做）

> v3 重做。依据 `design.md` §5（Wave2/§7.6 turn 时序）、§7.1 ClaudeSdkDriver `canUseTool`、§9 D-008 兼容策略、§10 R-GLM、`requirements.md` FR-07 / FR-08b、`decisions.md` D-007@v1 / D-008@v1、`spike-02-architecture-validation.md` §3.7 D2（canUseTool await 远程）+ D2 caveat（GLM Write 失败）、`plan.md` task-09（Wave4 P1，depends_on=[task-08]）。
>
> **v2→v3 关键差异**：v2（task-09 旧版）在 stream-json/json-rpc adapter 层做 `control_request` 审批收敛 + 跨 turn pending responder 清理；**v3 不改 adapter**（TaskRunner batch 路径零改动），审批收敛完全在新增的 `ClaudeSdkDriver.canUseTool` 回调 + `SessionManager` 内存 pending registry 层完成；GLM 错误透传是 v3 新增主题（spike D2 caveat 落地，D-008 错误透传不预禁工具）。
>
> **SDK 事实基础（spike §3.7 D2）**：`canUseTool` 是 async 回调，带 `AbortSignal`，`await` 任意延迟 claude 全程等待不超时（实测 3 次 6s 各 6003ms）；GLM 中转后端 Write 工具调用 3 次均 permission error、文件未创建，**非 SDK 路线阻塞**（D-008 错误透传）。

## 1. 目标与硬约束

依据 `plan.md` task-09、全局验收第 7/8 条、`requirements.md` FR-07 / FR-08b、`decisions.md` D-007@v1 / D-008@v1、`design.md` §10 R-GLM：

1. **deny 收敛**：task-08 的 `canUseTool` 回调返回 `{behavior:'deny', message}` 后，SDK 会把 `message` 回喂给 claude；claude 的收敛行为（停止本轮 / 换方法重试 / 告知用户）由模型自决定，daemon **不拦截、不二次决策、不强制结束 turn**。driver/sessionManager 只负责正确构造 deny message 并经 SDK 透传。
2. **pending 审批退出清理**：审批在途（canUseTool 回调 await 中）时，session 被 `interrupt` / `end` / driver onError / SDK query 自然结束 → 必须 reject 该 turn 所有 pending canUseTool Promise（让 SDK 收到 deny 后退出 await），不得让 callback 永久挂起导致 query 不结束或 zombie promise。
3. **GLM 错误透传不阻断（D-008，FR-08b）**：ClaudeSdkDriver **不预禁工具**（不传 `allowedTools` 黑名单 / 不在 canUseTool 内对 GLM 特定工具返回 deny）；工具执行失败时 SDK 自身已把 `tool_result(is_error=true)` 经 SDK 返给模型，driver 只需 `consume` 正常遍历（不拦截、不转换、不重写 is_error），让 claude 自处理（重试 / 换方法 / 告知用户）。
4. **失败率监控（R-GLM）**：backend 落库的 AgentRunLog 已含 tool_use / tool_result；新增按 session 维度统计 tool_result(is_error=true) 占比，超阈值（默认 50%，可配 `glm_tool_failure_rate_threshold`）记结构化 warn 日志（不阻断、不自动降级、不发告警通道，仅可观察）。
5. 仅限 interactive ClaudeSdkDriver 路径；batch（TaskRunner + adapter）零改动；不修改 protocol.ts 常量（task-03 / task-08 已定义 PERMISSION_*）；不实现前端审批 UI（task-11 / task-12）。

## 覆盖来源

| 来源 | 要求 / 决策 | 本任务落实 |
|---|---|---|
| `plan.md` task-09 / Wave 4 | depends_on=[task-08]，blocks=[]，P1；覆盖 FR-07 / FR-08b / D-007@v1 / D-008@v1 | deny 收敛 + pending 清理 + GLM 透传 + 失败率监控 |
| `plan.md` 全局验收第 7/8 条 | canUseTool 触发→前端 allow/deny→driver 继续/中止（第 7）；GLM 工具失败错误透传 session 不崩（第 8） | deny message 经 SDK 回喂；tool_result(is_error) 透传 |
| `requirements.md` FR-07 | canUseTool 不本地自动批准，发 permission_request → 前端 allow/deny → resolve；5min 超时 deny | deny 收敛逻辑（透传 deny.message，不二次决策） |
| `requirements.md` FR-08b | GLM 工具失败 tool_result(is_error=true) 原样返模型，不阻断 session、不预禁工具 | driver consume 不拦截 is_error；backend 监控失败率 |
| `decisions.md` D-007@v1 | canUseTool 回调 await 远程人审（非本地自动放行），5min 超时 deny | pending registry + 退出 reject；deny message 透传 |
| `decisions.md` D-008@v1 | driver 不做工具预过滤；失败 tool_result 原样（is_error）经 SDK 返模型；不针对 GLM 特殊降级 | 不传 allowedTools 黑名单；consume 不拦截 is_error |
| `design.md` §10 R-GLM | P1；D-008 错误透传；driver 不假设工具成功；监控 tool 失败率；结论对官方 Anthropic 后端需另证 | backend 失败率统计 + 结构化 warn |
| `design.md` §7.6 turn 时序 | result 是 AgentRun 干净边界（spike D4）；interrupt result(is_error) → AgentRun=failed（spike D1） | pending 清理挂在 session 终态路径（end/interrupt/onError/result） |
| `spike-02 §3.7` D2 + caveat | canUseTool await 任意延迟不超时；GLM Write 3 次均 permission error 非阻塞 | deny 透传 + GLM tool 失败监控验证 |
| task-04 / task-08 接口 | `ClaudeSdkDriver.canUseTool` / `consume` / `SessionManager.{interrupt,end,fail}` / permission WS payload | 本任务消费，不重定义 |

## 2. 修改文件

| 操作 | 文件 | 责任 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/interactive/claude-sdk-driver.ts` | `canUseTool` 包装器：登记 pending + 退出时 reject 全部 pending；deny message 构造；consume 不拦截 is_error |
| 修改 | `sillyhub-daemon/src/interactive/session-manager.ts` | interrupt / end / fail / onResult 收尾时调用 driver 的 `cancelAllPending(reason)`，reject 本 session 所有 pending |
| 修改 | `sillyhub-daemon/src/interactive/types.ts` | `PermissionRegistryHandle`（driver 内部）、`cancelPendingPermissionsResult` 类型 |
| 新增 | `sillyhub-daemon/tests/interactive/claude-sdk-driver-permission.test.ts` | deny 收敛 + pending 清理矩阵（mock SDK canUseTool） |
| 新增 | `sillyhub-daemon/tests/interactive/claude-sdk-driver-glm-passthrough.test.ts` | tool_result(is_error=true) 透传不拦截；不预禁工具 |
| 新增 | `sillyhub-daemon/tests/interactive/session-manager-pending-cleanup.test.ts` | interrupt / end / onError 路径 reject 全部 pending |
| 修改 | `backend/app/modules/agent/service.py` | `stream_session_logs` 聚合时统计 tool_result(is_error=true) 占比，超阈值记 warn |
| 修改 | `backend/app/modules/agent/schemas.py` | session 聚合统计 DTO（tool_total / tool_failed / failure_rate） |
| 新增 | `backend/tests/modules/agent/test_tool_failure_monitor.py` | 失败率统计 + 阈值 warn 单测 |

不得修改：`task-runner.ts`、`adapters/*.ts`（batch adapter 零改动）、`protocol.ts`（task-03 已定 PERMISSION_*）、frontend（task-11/12）、`agent_sessions` / `agent_runs` model（task-02 已定）、WS permission 通道与 5min 超时 deny 的真正实现（task-08 负责，本任务只消费其 `resolvePermission` 结果并做收敛/清理）。

## 3. 前置依赖

| 依赖 | 本任务消费的稳定接口 | 未满足时处理 |
|---|---|---|
| task-08 | `ClaudeSdkDriver` 已能注入 `canUseTool`；`SessionManager.respondPermission` / WS PERMISSION_RESPONSE 路由已通；5min 超时 deny 已实现 | 阻塞，不在本任务重复实现 permission 通道 |
| task-04 | `ClaudeSdkDriver.{start,consume,interrupt}` / `SessionManager.{interrupt,end,fail,onResult}` / `SessionState` | 阻塞，driver/sessionManager 不存在则无从收敛 |
| task-03 | `PERMISSION_REQUEST` / `PERMISSION_RESPONSE` 常量 + payload 类型 | 只 import，不重定义 |
| task-02 / task-05 | `agent_sessions` / `agent_runs` / AgentRunLog 落库；`stream_session_logs` 入口 | 失败率监控挂在 SSE 聚合路径，无落库则无监控输入 |

实现前用 `rg` 确认 task-08 的 `resolvePermission` / `canUseTool` 包装器真实签名，再按已落地签名接入；禁止同时保留两套 permission 路径。

## 4. 实现要求（精确）

### 4.1 deny 收敛（FR-07 / D-007@v1）

`canUseTool` 回调返回值经 SDK 直接回喂 claude（spike D2 已证），driver 不二次决策：

```typescript
// claude-sdk-driver.ts 内 canUseTool 包装（task-08 注入；本任务补 deny 收敛语义）
type CanUseToolDecision =
  | { behavior: 'allow' }
  | { behavior: 'deny'; message?: string };

async function wrapCanUseTool(
  toolName: string,
  input: Record<string, unknown>,
  ctx: {
    sessionId: string;
    runId: string;
    requestId: string;
    registry: PermissionRegistryHandle;
    resolve: (decision: CanUseToolDecision) => void;
  },
  signal: AbortSignal,
): Promise<CanUseToolDecision> {
  // 1. 登记 pending（requestId 由 task-08 已生成）
  ctx.registry.addPending(ctx.requestId, { resolve, reject: () => {} });
  // 2. await 远程人审（task-08 经 WS permission_response / 5min 超时）
  const decision = await waitForRemoteDecision(ctx.requestId, signal);
  // 3. deny 时构造 message（若远程未给则默认），SDK 回喂 claude
  if (decision.behavior === 'deny') {
    return {
      behavior: 'deny',
      message: decision.message
        ?? `Tool "${toolName}" denied by reviewer (session=${ctx.sessionId}, run=${ctx.runId})`,
    };
  }
  return decision; // allow 原样返回，不篡改 updatedInput
}
```

收敛规则（硬约束）：

1. **deny.message 必须存在且非空字符串**：远程 deny 未带 message 时用默认模板（含 toolName / sessionId / runId），让 claude 拿到可读原因决定下一步；禁止返回空 message 或 `{behavior:'deny'}` 无 message（claude 在无 message 时行为不可控）。
2. **driver 不强制结束 turn / 不调 q.interrupt**：deny 后是否停止本轮由 claude 自决定（可能换方法重试 / 告知用户 / 结束）；driver 只在 SDK 自然产 `result` 时才收尾 AgentRun。
3. **allow 不篡改 input**：返回 `{behavior:'allow'}` 时**不**附加 `updatedInput`（task-04 蓝图已约束）；input 原样经 SDK 传给工具。
4. **5min 超时 deny 已由 task-08 实现**：本任务不重复超时计时器；超时返回的 deny 走同一收敛路径（默认 message 标注 `timeout`）。

### 4.2 pending 审批退出清理（FR-07 收敛 / D-007@v1）

pending canUseTool Promise 的生命周期严格 ≤ 当前 session 活跃期；任何 session 终态路径都必须 reject 本 session 全部 pending，让 SDK 退出 await 收到 deny 后正常结束 query。

```typescript
// claude-sdk-driver.ts
export interface PermissionRegistryHandle {
  /** 登记当前 session 一个 pending canUseTool。 */
  addPending(requestId: string, p: { resolve: (d: CanUseToolDecision) => void; reject: (e: unknown) => void }): void;
  /** session 终态时调用：reject 全部 pending，返回被取消的 requestId 列表。 */
  cancelAllPending(reason: 'interrupted' | 'ended' | 'failed' | 'query_exited'): string[];
  /** 测试观察用（不暴露生产可变 Map）。 */
  pendingCount(): number;
}
```

SessionManager 在以下路径调用 `driver.cancelAllPending`（driver 内部按 session 隔离 registry）：

| 路径 | reason | 后续 |
|---|---|---|
| `interrupt(sessionId)` | `'interrupted'` | SDK 收到 deny → 当前 turn 产 result subtype=error_during_execution（spike D1）→ onResult 收尾 run=failed(interrupted)，session 回 active |
| `end(sessionId)` | `'ended'` | InputQueue.close + status=ended；SDK 退出 await 后 query 自然结束 |
| `fail(sessionId)` / driver onError | `'failed'` | status=failed；onSessionEnd(failed) |
| `consume` for-await 正常结束 / query 异常退出 | `'query_exited'` | 兜底，registry 应已空（防御性 cancel） |

约束：

1. **cancel 幂等**：同一 requestId 被 reject 两次不抛；cancelAllPending 后 `pendingCount()===0`。
2. **reject 必须让 SDK 退出 await**：reject 的值由 canUseTool 包装器 catch 后转 `{behavior:'deny', message:'<reason>: session ...'}` 返回（不向上抛，避免 SDK 把异常当 query 失败），SDK 收到 deny 后正常产 result。
3. **registry 按 session 隔离**：不同 session 并发（task-04 spike H2）互不干扰；cancelAllPending 只清本 session 的 pending。
4. **不在 SessionState 持久化 pending**：registry 是 driver 内部内存态，daemon 重启即丢（D-003 Wave1/2 不恢复）；SessionState 不新增 pendingPermissions 字段（避免跨 turn 残留，对齐 task-08 §5.5 约束）。

### 4.3 GLM 错误透传不阻断（D-008 / FR-08b）

ClaudeSdkDriver `consume` 不拦截 `tool_result(is_error=true)`：

```typescript
// claude-sdk-driver.ts consume（task-04 已实现骨架；本任务明确 is_error 透传约束）
async consume(q: Query, cb: ConsumeCallbacks): Promise<void> {
  for await (const msg of q) {
    // 不对 msg 做 is_error 转换 / 重写 / 拦截
    // tool_result(is_error=true) 由 SDK 内部回喂模型，driver 只做回调转发
    if (isResultMessage(msg)) {
      await cb.onResult(msg);   // backend 据 is_error / subtype 标 completed/failed
    } else if (cb.onMessage) {
      await cb.onMessage(msg);  // 中间消息 → AgentRunLog
    }
  }
}
```

透传规则（硬约束，对齐 D-008 normalized_requirement）：

1. **不传 allowedTools 黑名单**：`ClaudeSdkDriverOptions.allowedTools` 在 GLM 路径下缺省（不传），让 SDK 走全工具集；**禁止**为 GLM 预禁 Write/Edit/Bash 等特定工具。
2. **canUseTool 不针对 GLM 工具 deny**：canUseTool 只按远程人审决定（allow/deny），不因 `provider===glm` 或 `toolName==='Write'` 自动 deny；spike D2 caveat 的 GLM Write permission error 是工具执行层失败（在 tool_result 阶段，非 canUseTool 阶段），不进人审逻辑。
3. **不重写 is_error**：consume 收到的 `tool_result` 内容（含 `is_error` / `content`）原样经 `onMessage` 转 AgentRunLog，backend 落库后供失败率统计；driver 不把 is_error=true 转成 is_error=false、不裁剪 content、不补伪造的成功 result。
4. **不阻断 session**：工具失败后 claude 收到 is_error，由模型自决定下一步（重试 / 换方法 / 告知用户 / 结束 turn）；session 状态不因工具失败而自动 failed（只有 SDK query 抛错 / spawn 失败才 fail session）。
5. **result.is_error 与 AgentRun 终态**：turn 结束的 `result` 若 `is_error=true` 或 `subtype` 属 error_*，按 task-04 §4.3 `_onResult` 标 AgentRun=failed；但**这不代表工具失败**（工具失败的 tool_result 在 turn 中间，不是 turn result），driver 按 result 自身字段判断 turn 终态，不混淆工具失败与 turn 失败。

### 4.4 失败率监控（R-GLM / backend）

backend 在 `stream_session_logs` 聚合路径（task-06）补统计：

```python
# backend/app/modules/agent/service.py（task-06 stream_session_logs 内）
from dataclasses import dataclass

@dataclass
class ToolFailureStats:
    tool_total: int
    tool_failed: int
    failure_rate: float  # tool_failed / tool_total（tool_total=0 时为 0.0）

def _aggregate_tool_failure(logs: list[AgentRunLog]) -> ToolFailureStats:
    tool_results = [l for l in logs if l.entry_type == 'tool_result']
    failed = sum(1 for l in tool_results if getattr(l.payload, 'is_error', False))
    total = len(tool_results)
    return ToolFailureStats(
        tool_total=total,
        tool_failed=failed,
        failure_rate=(failed / total) if total else 0.0,
    )

# 在 stream_session_logs 消费日志时调用；超阈值记 warn
threshold = float(os.getenv('GLM_TOOL_FAILURE_RATE_THRESHOLD', '0.5'))
stats = _aggregate_tool_failure(session_logs)
if stats.tool_total >= 4 and stats.failure_rate >= threshold:  # 样本≥4 避免小样本抖动
    logger.warning(
        'glm_tool_failure_rate_exceeded',
        extra={'session_id': session_id, 'tool_total': stats.tool_total,
               'tool_failed': stats.tool_failed, 'failure_rate': stats.failure_rate,
               'threshold': threshold},
    )
```

监控约束：

1. **不阻断 / 不告警通道**：只 `logger.warning` 结构化日志（便于后续接告警系统），不发 WS / 不改 session status / 不自动切换 provider。
2. **不针对 GLM 特殊降级**：统计对所有 provider 生效（glm / 官方 anthropic），阈值可配；不为 GLM 写独立分支（D-008 normalized_requirement）。
3. **样本下限**：tool_total < 4 不告警（小样本失真）；阈值默认 0.5（spike D2 实测 GLM Write 3/3 失败，>50% 是合理告警线）。
4. **可观察性**：DTO `ToolFailureStats` 可经 session 详情 API 暴露（task-11/12 前端消费），本任务只落库 + warn。

## 5. 边界处理（≥5，全部上单测）

| # | 场景 | 必须行为 |
|---|---|---|
| 1 | **deny 后 claude 继续 turn**（换方法重试 / 告知用户） | driver 不调 q.interrupt、不强制结束 turn；deny.message 经 SDK 回喂；turn 继续，后续 tool_use / tool_result 正常经 onMessage 转发；最终 result 由 claude 决定 success/failed |
| 2 | **deny 后 claude 主动结束 turn** | SDK 自然产 result（subtype 由 claude 决定）；onResult 收尾 AgentRun（按 result 字段标 completed/failed）；session 回 active；driver 无特殊处理（与正常 result 路径一致） |
| 3 | **pending 审批时 session interrupted** | `interrupt(sessionId)` → `driver.cancelAllPending('interrupted')` → reject 本 session 全部 pending → canUseTool 包装器 catch 后返回 deny → 当前 turn 产 result subtype=error_during_execution（spike D1）→ onResult 标 run=failed(interrupted)，session 回 active；pendingCount 归零 |
| 4 | **pending 审批时 session ended** | `end(sessionId)` → cancelAllPending('ended') → reject 全部 → deny 返回 → InputQueue.close → query 自然结束 → status=ended；迟到的 permission_response 返回 `session_not_active`（task-08 已校验），不二次 resolve |
| 5 | **pending 审批时 driver onError / query 异常退出** | SessionManager.fail / consume catch → cancelAllPending('failed') → reject 全部；query 已异常退出时 reject 可能已无 consumer（防御性 cancel，幂等）；status=failed，onSessionEnd(failed) |
| 6 | **连续工具失败（GLM Write 3 次均 permission error）** | 每次失败的 tool_result(is_error=true) 经 onMessage 落 AgentRunLog；driver 不拦截、不重试、不预禁 Write；claude 收到 3 次 is_error 后自决定（spike D2 实测 result=success，claude 放弃后正常结束 turn）；session 不崩；backend 失败率统计 tool_total=3 failed=3 rate=1.0（< 阈值样本下限 4 不告警，但 DTO 暴露数据） |
| 7 | **GLM 后端 vs 官方 Anthropic 后端差异** | driver 对两类后端行为一致（不 provider 分支）；失败率统计对所有 provider 生效；spike D2 caveat 明确"结论对官方 Anthropic 后端需另证"——本任务不假设官方后端无失败，监控对两类后端均生效 |
| 8 | **pending + allow/deny 乱序到达** | 同 turn 多个 pending canUseTool（多个工具并发请求审批）各自独立 resolve；permission_response 按 requestId 匹配，乱序到达各自正确 resolve；cancelAllPending 一次性 reject 全部 |
| 9 | **deny.message 含特殊字符 / 超长** | message 原样经 SDK 回喂（SDK 负责 message 协议编码）；driver 不转义 / 不截断；超长 message（>4KB）原样透传，claude 行为由 SDK 保证（非 driver 责任） |
| 10 | **失败率监控阈值边界** | tool_total=4 rate=0.5（=阈值）告警；tool_total=3 rate=1.0（<样本下限）不告警；tool_total=0 rate=0.0 不告警；provider=glm / anthropic 均统计 |
| 11 | **result.is_error=true（turn 级失败，非工具失败）** | onResult 按 result 字段标 AgentRun=failed；不与 tool_result(is_error) 混淆；失败率统计只计 tool_result，不计 result.is_error |
| 12 | **canUseTool 包装器自身异常**（registry.addPending 抛 / waitForRemoteDecision 抛） | catch 后返回 deny（带原因 message），不让 SDK 把包装器异常当 query 失败；registry 清理对应 requestId |

## 6. 非目标（本任务不做的事）

- **不实现 canUseTool 远程人审通道 / WS permission_request-response / 5min 超时 deny**：这些属 task-08；本任务只消费 `resolvePermission` 结果做 deny 收敛 + pending 清理。
- **不预禁工具 / 不做 per-provider 工具黑白名单**：D-008 normalized_requirement 明令；allowedTools 在 GLM 路径缺省；不为 GLM 预禁 Write/Edit/Bash。
- **不针对 GLM 特殊降级**（自动重试 / 自动换工具 / 自动告知用户）：D-008 normalized_requirement；工具失败由 claude 自处理。
- **不实现崩溃恢复 / pending 持久化**：D-003 Wave1/2 不恢复；registry 内存态；daemon 重启即清。
- **不修改 adapter / task-runner.ts**：batch 路径零改动（D-002@v3）；adapter 层审批收敛属 v2 旧蓝图，v3 已转移至 SDK canUseTool。
- **不实现前端审批 UI / 会话面板**：task-11 / task-12。
- **不实现告警通道 / 自动 provider 切换**：失败率监控只 logger.warning 结构化日志，可观察但不阻断；接告警系统 / 自动降级属后续运维任务。
- **不重写 tool_result content / is_error**：driver 只转发，不转换。

## 7. 参考

- `design.md` §5（Wave2/§7.6 turn 时序）、§7.1 ClaudeSdkDriver canUseTool、§9 D-008 兼容策略、§10 R-GLM（P1，监控 tool 失败率）。
- `requirements.md` FR-07（canUseTool 远程人审，5min 超时 deny）、FR-08b（GLM 工具失败错误透传，不阻断不预禁）。
- `decisions.md` D-007@v1（canUseTool await 远程人审）、D-008@v1（错误透传，不预禁工具，不针对 GLM 特殊降级）。
- `spike-02-architecture-validation.md` §3.7 D2（canUseTool await 任意延迟不超时）+ D2 caveat（GLM Write 3 次均 permission error，非 SDK 路线阻塞）+ D1（interrupt turn 级，result subtype=error_during_execution 可续轮）+ D4（result 干净边界）。
- `plan.md` task-09 / Wave 4（depends_on=[task-08]）+ 全局验收第 7/8 条 + 覆盖矩阵（D-007 / D-008）。
- task-04 蓝图 §4.2 ClaudeSdkDriver（canUseTool / consume 骨架）、§4.3 SessionManager（interrupt / end / fail / _onResult）。
- task-08 蓝图 §5.2 deny 构造（behavior:'deny'，不携带伪造 updatedInput）、§5.5 SessionStore.respondPermission 路由。
- sandbox 脚本（仓库外）`%TEMP%\claude-sdk-spike\d2.mjs`（canUseTool await 6s×3，GLM Write 失败实测）。

## 8. TDD 实施顺序

严格"红测试 → 最小实现 → 重构 → 全量回归"。SDK 调用一律 mock（不连真实 bigmodel，避免 CI 依赖网络/鉴权）。

### Step 1：deny 收敛单测（红）

mock SDK canUseTool + permission resolve：

- 远程返回 allow：driver 返回 `{behavior:'allow'}`，不附加 updatedInput；turn 继续。
- 远程返回 deny（带 message）：driver 返回原 message；claude（mock）继续 turn，后续 tool_use/tool_result 正常转发。
- 远程返回 deny（无 message）：driver 返回默认 message（含 toolName/sessionId/runId）。
- 5min 超时 deny（task-08 mock 触发）：默认 message 含 `timeout`，走同一收敛路径。
- 红后实现 `wrapCanUseTool` deny message 构造。

### Step 2：pending 清理矩阵（红）

注入 mock ClaudeSdkDriver + mock registry：

- pending 时 `interrupt`：cancelAllPending('interrupted') 调用一次，reject 全部 pending；pendingCount 归零；mock SDK 产 result subtype=error_during_execution；onResult 标 run=failed(interrupted)，session 回 active。
- pending 时 `end`：cancelAllPending('ended')；status=ended；InputQueue.close；query 自然结束。
- pending 时 `fail`/onError：cancelAllPending('failed')；status=failed；onSessionEnd(failed)。
- pending 时 consume for-await 自然结束：cancelAllPending('query_exited') 兜底（registry 应已空，幂等）。
- cancel 幂等：同一 requestId reject 两次不抛；cancelAllPending 后 pendingCount=0。
- 多 pending（同 turn 多工具并发审批）：cancelAllPending 一次性 reject 全部，乱序到达各自正确。
- 红后实现 `PermissionRegistryHandle` + SessionManager 各路径调用。

### Step 3：GLM 错误透传单测（红）

mock SDK consume 产 tool_result(is_error=true) × N + result：

- 工具失败 tool_result 经 onMessage 原样转发（payload.is_error 不被改写、content 不裁剪）。
- driver 不调 q.interrupt / 不强制结束 turn；后续 tool_use / assistant text 正常转发。
- Claude（mock）连续收到 3 次 is_error 后产 result（success）；onResult 按 result 字段标 completed（不因工具失败自动 failed）。
- options.allowedTools 缺省（不传黑名单）；canUseTool 不因 provider=glm / toolName=Write 自动 deny。
- 红后确认 consume 无 is_error 拦截分支（删除任何 v2 遗留的预禁逻辑）。

### Step 4：backend 失败率监控单测（红）

mock AgentRunLog 列表：

- tool_total=4 failed=2 rate=0.5（=阈值）→ logger.warning 调用一次，extra 含 session_id / stats / threshold。
- tool_total=3 failed=3 rate=1.0（<样本下限 4）→ 不告警。
- tool_total=0 rate=0.0 → 不告警。
- tool_result 含 is_error=true 计入 failed；is_error=false / 缺失计入 total 不计 failed。
- 阈值可配（env `GLM_TOOL_FAILURE_RATE_THRESHOLD`）。
- provider=anthropic 同样统计（不 provider 分支）。
- 红后实现 `_aggregate_tool_failure` + 阈值判断。

### Step 5：回归

```bash
cd sillyhub-daemon
pnpm test -- claude-sdk-driver-permission claude-sdk-driver-glm-passthrough session-manager-pending-cleanup
pnpm typecheck
pnpm test        # 全量回归，batch / task-04~08 测试零失败

cd ../backend
uv run pytest tests/modules/agent/test_tool_failure_monitor.py
uv run pytest    # 全量回归
```

## 9. 验收表

| AC | 验收条件 | 证据 |
|---|---|---|
| AC-09.1 | deny.message 经 SDK 回喂 claude；driver 不二次决策、不强制结束 turn；allow 不篡改 input | `claude-sdk-driver-permission.test.ts`（allow/deny/带 message/无 message/超时） |
| AC-09.2 | deny 后 claude 继续 turn 与主动结束 turn 两路径 driver 行为正确（不干预 + 正常 result 收尾） | permission 单测 + consume 集成断言 |
| AC-09.3 | pending 审批时 interrupt → cancelAllPending('interrupted')，reject 全部，pendingCount=0，run=failed(interrupted)，session 回 active | `session-manager-pending-cleanup.test.ts` |
| AC-09.4 | pending 时 end → cancelAllPending('ended')，status=ended，query 自然结束，迟到 response 不二次 resolve | 同上 |
| AC-09.5 | pending 时 fail/onError/query 退出 → cancelAllPending，status=failed/ended，无 zombie promise | 同上 |
| AC-09.6 | cancelAllPending 幂等；多 pending（乱序）一次性 reject；registry 按 session 隔离 | pending-cleanup 矩阵参数化测试 |
| AC-09.7 | tool_result(is_error=true) 经 consume/onMessage 原样转发，不拦截不重写不裁剪；session 不因工具失败自动 failed | `claude-sdk-driver-glm-passthrough.test.ts` |
| AC-09.8 | driver 不传 allowedTools 黑名单；canUseTool 不因 provider/toolName 自动 deny（D-008 不预禁） | GLM 透传单测断言 options + canUseTool 分支 |
| AC-09.9 | 连续工具失败（GLM Write 3 次）claude 自处理后 turn 正常结束，session 不崩（spike D2 caveat 复现） | GLM 透传单测 mock 3 次 is_error + result |
| AC-09.10 | backend 按 session 维度统计 tool_result 失败率，超阈值（默认 0.5，样本≥4）记结构化 warn；不阻断不发告警 | `test_tool_failure_monitor.py` |
| AC-09.11 | 失败率监控对 glm / anthropic 均统计（不 provider 分支）；阈值可配；样本下限生效 | 监控单测参数化 |
| AC-09.12 | result.is_error 与 tool_result(is_error) 不混淆：失败率只计 tool_result；turn 终态按 result 字段 | 监控单测 + driver onResult 断言 |
| AC-09.13 | adapter / task-runner.ts / protocol.ts / model 零改动（batch 回归全绿）；diff 只在 allowed_paths | `pnpm test` 全量 + code review |
| AC-09.14 | daemon `pnpm typecheck && pnpm test` + backend `uv run pytest` 退出码 0 | CI / 本地跑通 |

## 10. 实现检查清单

- [ ] 开工前重读 `.claude/CLAUDE.md` + daemon CONVENTIONS/ARCHITECTURE，用 `rg` 确认 task-08 `resolvePermission` / `canUseTool` 包装器与 task-04 `SessionManager` 最终签名。
- [ ] 测试先行，保留至少一次预期红测试证据。
- [ ] deny.message 收敛逻辑正确（带/无 message / 超时），driver 不二次决策不强制结束 turn。
- [ ] pending registry 按 session 隔离，所有终态路径（interrupt/end/fail/onError/query 退出）调用 cancelAllPending，幂等。
- [ ] consume 不拦截 tool_result(is_error)；不传 allowedTools 黑名单；canUseTool 不 provider/toolName 分支。
- [ ] backend 失败率统计 + 阈值 warn，不阻断不告警通道，对两类 provider 均生效。
- [ ] adapter / task-runner / protocol / model 零改动（batch 回归全绿）。
- [ ] 对照 AC-09.1~AC-09.14 逐项验收。
