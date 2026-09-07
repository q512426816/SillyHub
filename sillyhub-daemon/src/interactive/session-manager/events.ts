/**
 * interactive/session-manager/events.ts —— driver.consume 回调消费簇（result /
 * message 分发 + 事件 → 上报 dict 转换）。
 *
 * task-02（2026-09-07-arch-large-file-split）：原 SessionManager 的 _onResult /
 * _onMessage / _dispatchStatusEvent / _registerAgentToolUseMeta /
 * _maybeRegisterAsyncReceipt / _eventToReportDict / _nextEventSeq /
 * _emitSessionEvent 方法体原样下沉（仅 ``this`` → ``mgr`` 改显式传参，行为零变化）。
 *
 * task-04 轻重构②（同变更）：eventToReportDict 的字段平铺核心收敛至
 * src/event-wire.ts（与 task-runner _eventToMessages 共用 AgentEvent→wire dict
 * 转换单一实现），本模块保留 seq 补号 + 委托，输出逐字节不变。
 *
 * @module interactive/session-manager/events
 */

import type { AgentEvent } from '../../types.js';
import type { SessionEventForBackend, SessionState } from '../types.js';
import type {
  InteractiveDriverResult,
  TurnMessageEnvelope,
} from '../driver.js';
// task-04（FR-01 / D-005@v1）：turn 收尾把模型调用失败归类为结构化 ModelError，
// 挂到 result.modelError 透传给 daemon 桥接 → notifyRunResult → backend error_detail。
// 与 stream-json.ts:954 批量路径同源（近源归类，D-005 方案 C 三端标准协议）。
import { classifyModelError } from '../../model-error/classifier.js';
import type { ModelError } from '../../model-error/types.js';
import { eventToReportWireDict } from '../../event-wire.js';
import { eventMetaOf, numOf, strOf } from './helpers.js';
import type { SessionManagerCore } from './types.js';

/**
 * onResult（spike D4：result 是干净 turn 边界）。
 *   - result.subtype=success → onTurnResult(sessionId, currentRunId, result)
 *   - is_error / subtype=error_* → onTurnResult（backend 据 is_error 标 failed/interrupted）
 *   - status: running → active（currentRunId 清空，待下个 inject 下发新 runId）
 *   - ended 时不重复调（边界 8：END 与 turn 完成竞态，幂等）
 *   - lastActiveAt 更新
 */
export async function onResult(
  mgr: SessionManagerCore,
  state: SessionState,
  result: InteractiveDriverResult,
): Promise<void> {
  if (state.status === 'ended' || state.status === 'failed') {
    // 迟到的 result，session 已收口：不重复发终态，避免双 onTurnResult。
    return;
  }
  // 先切换 status→active + 清空 currentRunId（turn 边界已落，spike D4），
  // 再 await onTurnResult。这样即便调用方同步触发 onResult（fire-and-forget），
  // 也能在 onTurnResult 回调内读到稳定的 active 状态；且避免 onTurnResult 抛错时
  // status 残留 running（虽然 onTurnResult 应不抛，但先收敛更鲁棒）。
  const runId = state.currentRunId;
  state.status = 'active';
  state.currentRunId = undefined;
  state.lastActiveAt = Date.now();
  // task-07（R-conv 边界 8）：每收一个 result 表示消费了一条 turn（含排队 inject）。
  // pendingInjectCount 递减（min 0，不下溢）；表示一条排队 turn 被消费。
  const cur = mgr._pendingInjectCount.get(state.sessionId) ?? 0;
  if (cur > 0) {
    mgr._pendingInjectCount.set(state.sessionId, cur - 1);
  } else {
    // 确保 map 中存在该 sessionId 条目（即便为 0），便于 getPendingInjectCount 稳定返回。
    if (!mgr._pendingInjectCount.has(state.sessionId)) {
      mgr._pendingInjectCount.set(state.sessionId, 0);
    }
  }
  if (runId) {
    // task-08（AC-08.8）：turn result 完成时 abort 当前 turn 的 pending resolver。
    // spike D4：result 后无孤儿 canUseTool，但防御性 fail-closed——本 turn 的
    // pending 审批（若 canUseTool 回调还没 settle）立即 deny。resolver 实例
    // 不删（session 仍 active，下个 inject 还要用同一 resolver）。
    mgr._resolversBySession
      .get(state.sessionId)
      ?.abortAll('turn_completed');
    // task-04（FR-01 / D-005@v1）：turn 失败时近源归类模型错误，挂到 result.modelError
    // 透传给 daemon.onTurnResult → notifyRunResult payload.error → backend error_detail。
    // - interactive 路径不经 stream-json adapter（claude-sdk-driver 直接消费 SDK），
    //   故在此归类（与批量 stream-json.ts:954 同源逻辑，输入用 result.result 文本）。
    // - 仅 is_error=true 调 classifier（成功路径不产出 ModelError，D-008 不回归）；
    //   classifier 对 is_error=true 恒返回非空 ModelError（claude 按规则，codex 兜底 unknown）。
    // - 挂载用 duck-type（对齐 _onMessage 挂 msg.depth 模式），daemon 侧 resultMeta 读取。
    const resultRecord = result as Record<string, unknown>;
    if (resultRecord['is_error'] === true) {
      const rawResult = resultRecord['result'];
      const resultText =
        typeof rawResult === 'string'
          ? rawResult
          : rawResult === undefined
            ? ''
            : JSON.stringify(rawResult);
      const subtype =
        typeof resultRecord['subtype'] === 'string'
          ? (resultRecord['subtype'] as string)
          : undefined;
      const modelError: ModelError | null = classifyModelError({
        agent: state.provider,
        isError: true,
        subtype,
        resultText,
      });
      if (modelError) {
        resultRecord['modelError'] = modelError;
      }
    }
    // ql-20260831-002（task-08 改造注）：轮末补发未 flush pendingUsage 的职责
    // 已随 partial 链下沉归一化器——ClaudeEventNormalizer 在 message_stop 消息
    // 边界 flush 残留缓冲（含最终 message_delta usage），driver 在 onTurnEnd 前
    // 已把整轮最后一次 usage 以事件送达（claude-events.ts _flushBucket 的
    // usage-only 分支），消息→result 顺序天然保持。daemon 侧不再补发。
    // ql-20260825-f6#4：onTurnResult 入 per-session 终态通知链——同会话后续的
    // onSessionEnd（end/fail 收口）必 await 在本通知之后，backend 侧顺序恒
    // result → end。settle 语义（含 rejection 向上抛）与直调一致。
    await mgr._runNotifyChain(state.sessionId, () =>
      mgr.deps.onTurnResult(state.sessionId, runId, result),
    );
  }
  // task-10：turn result 收尾后排队 flush（currentRunId 已清空）。
  mgr._scheduleFlush();
  // task-11（边界 7）注：completedSegments 跨 turn 重置已随 partial 链下沉归一化器
  //（driver 在 result 前调 normalizer.onTurnEnd，session-manager 不再持有桶）。
  // task-08（D-006 / D-009）：turn 收尾 budget 软切断检查点。放在 _onResult 主路径
  // 完成后（聚合 usage = base + 本轮各 parent 值，含子代理）。runId 用本 turn
  // 刚结束的（currentRunId 已清空，但 runId 局部变量仍持有）。
  if (runId) {
    mgr._checkBudgetCutoff(state, runId);
  }
  // task-08：turn 收尾折算 usage 台账（在 _checkBudgetCutoff **之后**——对齐旧
  // _shrinkSubagentBuffers 时序：预算聚合先看到本轮各 parent 值再合入 base，
  // 先折算会丢子代理 token 造成漏计）+ seq 补号计数器归零（替代旧 subagentDepth/
  // 子代理桶收缩——子代理 parent 条目随本轮表整体清空，无跨轮膨胀）。
  mgr._foldTurnUsage(state);
  // task-07（provider-switch-live-session / D-002@v1）：turn 边界检测 pendingSwitch。
  // 生成中 turn 收到切换时 markPendingSwitch 仅覆盖写 state.pendingSwitch 不中断；
  // 此处 turn 已收尾（status→active / currentRunId 清空），安全触发受控 reload。
  // 先取后清（幂等，防 _onResult 重入或 WS 重放叠加致双 reload）；fire-and-forget
  // reload（task-08 实现方法体：close 旧 query → 新 env → driver.start resume），
  // .catch 兜底吞错防 unhandled rejection（reload 失败保留旧 query 不破坏会话，R-01）。
  const pendingSwitch = state.pendingSwitch;
  if (pendingSwitch) {
    state.pendingSwitch = undefined;
    void mgr.reloadWithProvider(state.sessionId, pendingSwitch.providerConfig).catch(
      (err) => {
        // reload 失败保留旧 query 不破坏会话（R-01）；不阻塞 _onResult 收尾路径。
        // ql-20260825-f3#2：补 error 日志（原静默吞错，reload 失败无从排查）。
        // eslint-disable-next-line no-console
        console.error(
          '[session-manager] turn-boundary provider switch reload failed',
          state.sessionId,
          err,
        );
      },
    );
  }
  // task-08（2026-08-14-sessions-portal / D-012@v1）：turn 边界检测 pendingConfigSwitch。
  // 生成中 turn 收到 SESSION_SWITCH_CONFIG 时 markPendingConfigSwitch 仅覆盖写
  // state.pendingConfigSwitch 不中断；此处 turn 已收尾（status→active / currentRunId
  // 清空），安全触发受控 reload + 喂切换轮 prompt。先取后清（幂等，防 _onResult 重入
  // 或 WS 重放叠加致双 reload）；fire-and-forget（reloadWithConfig 内部调 _reloadSession
  // 失败回滚保留旧句柄，R-01），.catch 兜底吞错防 unhandled rejection。
  // 与 pendingSwitch 顺序：provider 级全局切换先收敛，再消费会话级配置切换（后者
  // reloadWithConfig 会按 state.providerConfig 现值重建 env，天然吸收前者结果）。
  const pendingConfigSwitch = state.pendingConfigSwitch;
  if (pendingConfigSwitch) {
    state.pendingConfigSwitch = undefined;
    void mgr.reloadWithConfig(
      state.sessionId,
      pendingConfigSwitch.payload,
    ).catch((err) => {
      // reload 失败保留旧句柄不破坏会话（R-01）。
      console.error(
        '[session-manager] turn-boundary config switch reload failed',
        state.sessionId,
        err,
      );
    });
  }
}

/**
 * task-08（2026-09-03-agent-provider-abstraction / FR-02 / D-002@v1）：onTurnMessage
 * 消费侧收口——输入 ``TurnMessageEnvelope{events}``（driver 归一化后的 AgentEvent
 * 批次，一帧 provider 消息可产 0..N 条），逐事件分发；SessionManager 不再解析
 * provider raw 消息形状（raw 依赖清零，envelope.raw 仅调试通道禁止依赖）。
 *
 * ── 对账表（R-02：旧 _onMessage 每类消费 → 新分发项一一映射）────────────
 * | # | 旧 _onMessage 消费（raw SDK 形状解析） | 新分发项（事件字段消费） |
 * |---|---|---|
 * | 1 | depth 计算 + assistant tool_use 预登记 subagentDepth + 挂 msg.depth | 下沉 ClaudeEventNormalizer（depth 状态机）；事件一等字段 depth 随 dict 透传（_eventToReportDict） |
 * | 2 | assistant tool_use=Bash → _runningBashCommands 注册 + emit bash_status(running) | status/bash_status 事件 → _emitSessionEvent（Bash 追踪/elapsed 归一化器内配对） |
 * | 3 | assistant tool_use=Enter/ExitPlanMode → emit plan_mode_entered | status/plan_mode 事件 → _emitSessionEvent（kind plan_mode_entered，summary 自 metadata） |
 * | 4 | assistant tool_use=Task/Agent → emit agent_task_status(running) + _agentToolUseMeta 登记 | status/agent_task_status → _emitSessionEvent；meta 登记改由 tool_use 事件（call_id 键 + args JSON 解析，_registerAgentToolUseMeta） |
 * | 5 | system/init → agentSessionId 提取（fork/子代理守卫）+ _scheduleFlush + 透传 | status/session_started → 同守卫提取 + 透传（backend resume 指针 pin，design §7.5） |
 * | 6 | codex flat thread_started → agentSessionId（resume key，只写一次） | codex driver 映射表 #1 已产 status/session_started → 与 #5 同分支统一消费 |
 * | 7 | stream_event / system:thinking_tokens partial 缓冲节流（500ms flush [THINKING]/[ASSISTANT]/[SYSTEM:thinking_tokens]） | 下沉归一化器（_bufferPartial/_flushBucket 节流 flush）；partial 以 is_partial+segment_id 事件直达本方法透传 |
 * | 8 | system/task_* 拦截 → _onBackgroundTaskSystemMessage（注册表/节流/唤醒/[TASK_*] 行） | status/agent_task_status + status/task_notification → _handleAgentTaskStatusEvent / _handleTaskNotificationEvent（语义不变，输入改事件 metadata） |
 * | 9 | 完整 assistant → 清 partial buffer + emit [*_OVERRIDE] 撤回信号 + 透传 | 下沉归一化器（override:true + segment_id 事件原位替换，D-004@v1）；SessionManager 仅透传 |
 * |10 | user tool_result 配对 Bash 终态 → bash_chunk(终块) + bash_status(completed/failed) | 归一化器（runningBash 配对）→ status/bash_chunk + status/bash_status 事件 → _emitSessionEvent |
 * |11 | user tool_result 异步回执（"Async agent launched successfully"）→ _registerAsyncReceiptTask 兜底 | tool_result 事件 content 扫描 + call_id 关联 → _maybeRegisterAsyncReceipt |
 * |12 | 尾部默认 onTurnMessage 透传（currentRunId 守卫） | 内容事件逐条 _eventToReportDict 透传（seq 补号 + v2 一等字段平铺，task-09 直接可用） |
 * |13 | usage：partial flush attachUsage（轮级累计注入 flat 消息顶层） | usage lift：事件 usage 一等字段平铺进 dict（daemon lift → backend 实时聚合）+ 会话级台账 _liftSessionUsage（budget 数据源） |
 *
 * status subtype 路由两路（design §5.1 Grill 复核）：bash_chunk/bash_status/
 * plan_mode/agent_task_status/task_notification 属瞬时会话 UI 信号 → 现
 * onSessionEvent 独立通道（WS/REST 既有链路，不落 AgentRunLog、不经
 * submitMessages）；session_started 随 submitMessages 上报（backend resume
 * 指针 pin）；thinking_tokens（D-005@v1 补遗）经 submitMessages 透传（backend
 * _persist_agent_event 对 status 不产文本行，仅事件 JSON 落 metadata_.agent_event）。
 */
export async function onMessage(
  mgr: SessionManagerCore,
  state: SessionState,
  envelope: TurnMessageEnvelope,
): Promise<void> {
  const events = Array.isArray(envelope?.events) ? envelope.events : [];
  // 对账表 #4 前置判定：本 envelope 是否含 Task/Agent tool_use 事件——归一化器把
  // 同一 assistant message 的 tool_use 派生会话信号（agent_task_status running）
  // 与 tool_use 内容事件放在**同一 envelope**（statusEvents 先行 + contentEvents
  // 随后）。该派生信号只 emit（旧 _onMessage toolUse 分支口径：不注册后台任务
  // 表、不落 [TASK_STARTED] 行——注册/落行由 system/task_started 帧承载），经
  // 此标志与 system 帧事件（独立 envelope 到达）区分。
  const envelopeHasTaskToolUse = events.some(
    (ev) =>
      ev.type === 'tool_use' &&
      (ev.tool_name === 'Task' || ev.tool_name === 'Agent'),
  );
  for (const ev of events) {
    // usage lift 先行（D-003@v1：任意型事件可携带；台账只收轮级累计来源，
    // 见 _liftSessionUsage 守卫注释）。
    mgr._liftSessionUsage(state, ev);
    if (ev.type === 'status') {
      await dispatchStatusEvent(mgr, state, ev, envelopeHasTaskToolUse);
      continue;
    }
    // 内容事件（text/thinking/tool_use/tool_result/error/turn_result/complete）：
    // - tool_use(Task/Agent) → _agentToolUseMeta 登记（对账表 #4，异步回执兜底关联键）；
    // - tool_result → 异步回执兜底（对账表 #11）；
    // - 全部经 _eventToReportDict 透传（对账表 #12/#13）。
    if (ev.type === 'tool_use') {
      registerAgentToolUseMeta(mgr, state, ev);
    } else if (ev.type === 'tool_result') {
      await maybeRegisterAsyncReceipt(mgr, state, ev);
    }
    const runId = state.currentRunId;
    if (!runId) continue; // 无 active turn → 丢弃（对齐旧尾部守卫）
    await mgr.deps.onTurnMessage(
      state.sessionId,
      runId,
      eventToReportDict(mgr, state, ev),
    );
  }
}

/**
 * task-08：status 事件按 subtype 分发（D-002@v1 会话级信号事件化）。输入从
 * raw SDK 形状改为事件一等字段（session_id）+ metadata 开放容器（command/
 * channel/status/exit_code/elapsed_ms/summary/task_*），会话级语义零变化。
 *
 * @param envelopeHasTaskToolUse 本 envelope 含 Task/Agent tool_use 事件（见
 *   _onMessage 前置判定）——agent_task_status 据此走 tool_use 派生口径（仅 emit，
 *   不注册/不落行）。
 */
export async function dispatchStatusEvent(
  mgr: SessionManagerCore,
  state: SessionState,
  ev: AgentEvent,
  envelopeHasTaskToolUse: boolean,
): Promise<void> {
  switch (ev.subtype) {
    case 'session_started': {
      const sid =
        typeof ev.session_id === 'string' && ev.session_id
          ? ev.session_id
          : undefined;
      // 守卫等价迁移（旧 _onMessage system/init 分支，2026-06-28-daemon-
      // subagent-transcript task-04 / D-003@v1）：
      // - 子代理 init（parent_tool_use_id 非空）不得覆盖主 session 的
      //   agentSessionId（resume key）——归一化器对 Claude 子代理 init 已守卫
      //   丢弃，此处对事件字段再防御（codex 无该形态）；
      // - forkedInitPending（reloadWithConfig 置位）：fork 后 init 带新
      //   session_id 允许覆盖（消费清除）。
      const isSubagentInit =
        typeof ev.parent_tool_use_id === 'string' &&
        ev.parent_tool_use_id !== '';
      if (
        sid &&
        !isSubagentInit &&
        (state.agentSessionId === undefined ||
          (state.forkedInitPending === true && sid !== state.agentSessionId))
      ) {
        state.agentSessionId = sid;
        state.forkedInitPending = false;
        // task-10：拿到 agentSessionId 后才可恢复 → 排队 flush。
        mgr._scheduleFlush();
      }
      // design §7.5：session_started 随 submitMessages 上报（backend resume
      // 指针 pin；旧轨 init 消息透传后 backend _extract_sdk_messages 对 system
      // 类静默丢弃，新轨由 _persist_agent_event 提取 session_id 更新指针）。
      const startedRunId = state.currentRunId;
      if (startedRunId) {
        await mgr.deps.onTurnMessage(
          state.sessionId,
          startedRunId,
          eventToReportDict(mgr, state, ev),
        );
      }
      return;
    }
    case 'bash_chunk': {
      const runId = state.currentRunId;
      if (!runId) return; // 信号门控对齐旧 toolUse 分支（runId 存在才 emit）
      const meta = eventMetaOf(ev);
      emitSessionEvent(mgr, state.sessionId, runId, {
        kind: 'bash_chunk',
        command: strOf(meta?.['command']),
        channel: meta?.['channel'] === 'stderr' ? 'stderr' : 'stdout',
        content: ev.content,
        is_final: meta?.['is_final'] === true,
      });
      return;
    }
    case 'bash_status': {
      const runId = state.currentRunId;
      if (!runId) return;
      const meta = eventMetaOf(ev);
      const rawStatus = strOf(meta?.['status']);
      const status =
        rawStatus === 'failed'
          ? 'failed'
          : rawStatus === 'completed'
            ? 'completed'
            : 'running';
      const exitCode = numOf(meta?.['exit_code']);
      const elapsedMs = numOf(meta?.['elapsed_ms']);
      emitSessionEvent(mgr, state.sessionId, runId, {
        kind: 'bash_status',
        command: strOf(meta?.['command']),
        status,
        ...(exitCode !== undefined ? { exit_code: exitCode } : {}),
        ...(elapsedMs !== undefined ? { elapsed_ms: elapsedMs } : {}),
      });
      return;
    }
    case 'plan_mode': {
      const runId = state.currentRunId;
      if (!runId) return;
      const meta = eventMetaOf(ev);
      const summary = meta?.['summary'] as
        | { objective?: unknown; tasks?: unknown; design_snippet?: unknown }
        | undefined;
      const objective =
        typeof summary?.objective === 'string' ? summary.objective : '';
      const tasks = Array.isArray(summary?.tasks)
        ? summary.tasks.filter((t): t is string => typeof t === 'string')
        : [];
      const designSnippet = strOf(summary?.['design_snippet']);
      emitSessionEvent(mgr, state.sessionId, runId, {
        kind: 'plan_mode_entered',
        summary: {
          objective,
          tasks,
          ...(designSnippet ? { design_snippet: designSnippet } : {}),
        },
      });
      return;
    }
    case 'agent_task_status':
      if (envelopeHasTaskToolUse) {
        // tool_use 派生信号（对账表 #4 的 emit 半边，旧 _onMessage toolUse 分支
        // 口径）：仅 emit running（不注册后台任务表、不落行——[TASK_*] 行由
        // system/task_started 帧或异步回执路径承载，防双行）。
        const deriveRunId = state.currentRunId;
        if (!deriveRunId) return;
        const deriveMeta = eventMetaOf(ev);
        emitSessionEvent(mgr, state.sessionId, deriveRunId, {
          kind: 'agent_task_status',
          task_id: strOf(deriveMeta?.['task_id']),
          task_name: strOf(deriveMeta?.['task_name']),
          status: 'running',
        });
        return;
      }
      await mgr._handleAgentTaskStatusEvent(state, ev);
      return;
    case 'task_notification':
      await mgr._handleTaskNotificationEvent(state, ev);
      return;
    case 'thinking_tokens': {
      // D-005@v1：thinking token 计数信号（旧轨 [SYSTEM:thinking_tokens] 行的
      // 事件等价——该行前端默认隐藏 ql-20260709-003，非渲染依赖）。经
      // submitMessages 透传（backend 对 status 不产文本行，仅事件 JSON 落
      // metadata_.agent_event，task-13 双路径等价覆盖该信号）。
      const runId = state.currentRunId;
      if (!runId) return; // 旧轨 flush 无 runId 时丢弃残留，口径一致
      await mgr.deps.onTurnMessage(
        state.sessionId,
        runId,
        eventToReportDict(mgr, state, ev),
      );
      return;
    }
    default:
      // 未知 subtype 防御丢弃（schema 闭合枚举外的运行时漂移）。
      return;
  }
}

/**
 * task-08：Task/Agent tool_use 事件的元数据登记（对账表 #4 的 meta 半边）。
 *
 * 旧实现从 assistant message 的 tool_use block 原生 input 对象读
 * description/subagent_type；事件轨 tool_use 事件 content = 入参 JSON
 *（归一化器 service.py:3581 json.dumps 口径），此处解析回对象（失败退化空
 * 对象，对齐旧 toolInput 非对象守卫）。关联键 = call_id（= 旧 tool_use.id）。
 * agent_task_status(running) 的 emit 由归一化器产事件、_dispatchStatusEvent
 * 转发，此处不再 emit（防双发）。
 */
export function registerAgentToolUseMeta(
  mgr: SessionManagerCore,
  state: SessionState,
  ev: AgentEvent,
): void {
  if (ev.tool_name !== 'Task' && ev.tool_name !== 'Agent') return;
  const callId = ev.call_id;
  if (typeof callId !== 'string' || !callId) return;
  let input: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(ev.content || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      input = parsed as Record<string, unknown>;
    }
  } catch {
    // 非法 JSON 退化空对象（对齐旧 toolInput 非对象守卫）。
  }
  const taskName = strOf(input['description'] ?? input['name']) || ev.tool_name;
  const rawSubagentType = input['subagent_type'];
  const subagentType =
    typeof rawSubagentType === 'string' && rawSubagentType
      ? rawSubagentType
      : undefined;
  mgr._agentToolUseMeta.set(callId, {
    sessionId: state.sessionId,
    taskName,
    ...(subagentType ? { subagentType } : {}),
  });
}

/**
 * task-03（design §5 P1.2，FR-01）+ task-08 迁移：异步 Agent 启动回执兜底——
 * tool_result 事件正文含 "Async agent launched successfully" 且正则提取到
 * agentId 时调 _registerAsyncReceiptTask（CLI 不发 task_* 的旧版/异常场景，
 * secondary 路径）。call_id = 旧 tool_use_id 关联键。
 */
export async function maybeRegisterAsyncReceipt(
  mgr: SessionManagerCore,
  state: SessionState,
  ev: AgentEvent,
): Promise<void> {
  const text = ev.content;
  if (
    typeof text !== 'string' ||
    !text.includes('Async agent launched successfully')
  ) {
    return;
  }
  const agentIdMatch = /agentId:\s*([0-9a-f]+)/i.exec(text);
  const agentId = agentIdMatch?.[1];
  if (!agentId) return;
  const callId = typeof ev.call_id === 'string' ? ev.call_id : '';
  if (!callId) return;
  await mgr._registerAsyncReceiptTask(
    state,
    state.currentRunId,
    agentId,
    callId,
  );
}

/**
 * task-08：AgentEvent → 上报消息 dict（对账表 #12/#13）。
 *
 * v2 一等字段（parent 三列 / segment_id / edit_patch / usage / session_id /
 * is_partial / override / tool_name / call_id / subtype / depth / seq / metadata）
 * 蛇形命名平铺 dict 顶层，task-09 接线时直接包 ``{"kind":"agent_event",
 * "event": {...}}``；legacy 兼容键 ``event_type``（= type 别名）保留给
 * daemon dedupKeyFor / 旧消费轨（对齐 codex driver toAgentEvent 的双键形态）。
 * seq 缺号由 SessionManager 补（design §7：turn 内单调递增，_foldTurnUsage
 * turn 边界重置；事件自带 seq（provider 自产）则透传不覆盖）。
 */
export function eventToReportDict(
  mgr: SessionManagerCore,
  state: SessionState,
  ev: AgentEvent,
): Record<string, unknown> {
  const seq =
    typeof ev.seq === 'number' ? ev.seq : nextEventSeq(mgr, state.sessionId);
  // task-04 轻重构②：字段平铺核心收敛至 src/event-wire.ts（与 task-runner
  // _eventToMessages 同源单一实现；本方法保留 seq 补号职责，输出逐字节不变）。
  return eventToReportWireDict(ev, seq);
}

/** task-08：turn 内事件 seq 补号（1 起单调递增；turn 边界 _foldTurnUsage 重置）。 */
export function nextEventSeq(
  mgr: SessionManagerCore,
  sessionId: string,
): number {
  const next = (mgr._turnEventSeq.get(sessionId) ?? 0) + 1;
  mgr._turnEventSeq.set(sessionId, next);
  return next;
}

// ── ql-20260621-partial：streaming delta 缓冲节流 ──────────────────────────

/**
 * task-04（FR-01~03）：fire-and-forget 上报会话反馈事件。
 *
 * 异常吞掉不阻塞 turn 主流程与 onTurnMessage 转发；仅 console.error 记日志。
 */
export function emitSessionEvent(
  mgr: SessionManagerCore,
  sessionId: string,
  runId: string,
  event: SessionEventForBackend,
): void {
  const cb = mgr.deps.onSessionEvent;
  if (!cb) return;
  void (async () => { await cb(sessionId, runId, event); })().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[session-manager] onSessionEvent failed', {
      sessionId,
      runId,
      kind: event.kind,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}
