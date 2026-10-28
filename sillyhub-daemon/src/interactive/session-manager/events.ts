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
// 2026-10-26-turn-phase-prod-fix task-02：上报链路观测（FR-03）。
import { notePhaseEmit, warnOncePhaseFailure } from '../../turn-phase-observability.js';
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
// 2026-10-13-daemon-turn-anchor-snapshot FR-01：轮锚点快照——轮边界对会话 cwd 的
// git 工作区打内容锚（add -A 覆盖 untracked，tree sha 去重），JSONL 落 daemon
// .runtime/turn-anchors/。fire-and-forget：模块内部永不抛错，观测面不阻塞轮结果链路。
import { recordTurnAnchor } from '../turn-anchor.js';
import { eventMetaOf, numOf, strOf } from './helpers.js';
import type { SessionManagerCore } from './types.js';

/**
 * 2026-10-23-watchdog-steering-guard FR-03：登记「已经产生过轮事件」的 run。
 *
 * 有界 Set（256 上限 FIFO 驱逐，单会话约 9KB）：看门狗只服务「新 run 从未
 * 启动」形态，已观测 run 再被 inject 时不得布防。仅内存态，不参与持久化。
 */
const OBSERVED_RUN_IDS_MAX = 256;

function rememberObservedRun(state: SessionState, runId: string): void {
  const set = state.observedRunIds ?? new Set<string>();
  state.observedRunIds = set;
  if (set.has(runId)) return;
  set.add(runId);
  if (set.size > OBSERVED_RUN_IDS_MAX) {
    const oldest = set.values().next().value;
    if (oldest !== undefined) set.delete(oldest);
  }
}

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
  // 2026-10-21-daemon-zombie-turn FR-01：result 到达 = 轮确实启动过，撤防看门狗。
  mgr._disarmTurnStartWatchdog(state.sessionId);
  // 先切换 status→active + 清空 currentRunId（turn 边界已落，spike D4），
  // 再 await onTurnResult。这样即便调用方同步触发 onResult（fire-and-forget），
  // 也能在 onTurnResult 回调内读到稳定的 active 状态；且避免 onTurnResult 抛错时
  // status 残留 running（虽然 onTurnResult 应不抛，但先收敛更鲁棒）。
  const runId = state.currentRunId;
  // 2026-10-23-watchdog-steering-guard FR-03：result 到达同样证明该 run 启动过。
  if (runId) rememberObservedRun(state, runId);
  state.status = 'active';
  // 2026-09-15-background-task-permission-lockout（FR-01 / 坑 subagent-write-channel）：
  // 主轮收尾时若该会话后台任务注册表非空，保留 currentRunId 作「后台锚点」——后台
  // Task 子代理在主轮结束后仍在运行，其工具调用仍进会话级 canUseTool，锚点让
  // writeChannelGuardDeny 的 hasBackgroundTaskGrace 放行条件可判定「后台工作确定
  // 存活」。锚点语义仅代表「后台任务群的派发轮次仍需通道」，是「仅通道存在性」——
  // 写策略（allowed_roots/policyEngine）与人审链路全程生效，不代表轮次仍在跑。
  // 注册表为空（无后台任务）行为与现状完全一致：清 currentRunId。
  if (!mgr._backgroundTasks.get(state.sessionId)?.size) {
    state.currentRunId = undefined;
  }
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
  // 2026-10-13-daemon-turn-anchor-snapshot FR-01：轮锚点快照——干净 turn 边界
  // （status 已收敛 active、currentRunId 已清）对会话 cwd 的 git 工作区打内容锚。
  // fire-and-forget（void）：模块内部永不抛错 + per-session 串行链，不 await、
  // 不阻塞轮结果链路；非 git cwd / git 失败静默 null（观测面best-effort）。
  // 无条件执行（不挂 if (runId)）：锚是会话级内容观测，与 backend 是否下发 runId
  // 无关；记录里 runId 为 null 的锚消费方可按会话时刻对齐。
  void recordTurnAnchor({
    cwd: state.cwd,
    sessionId: state.sessionId,
    runId: runId ?? null,
  });
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
  // 2026-10-21-daemon-zombie-turn FR-01：任意轮事件到达即撤防看门狗（轮已启动，
  // 慢启动/审批等待的长轮不受误伤）。粒度取舍：后台任务的 system 事件也走本
  // 入口，偶发「无关事件误撤防」由 backend pending run 启动超时清扫兜底
  // （300s），不在事件流里做 run 归属精细判定的成本权衡。
  mgr._disarmTurnStartWatchdog(state.sessionId);
  // turn_phase=first_event（2026-10-26-session-stage-progress FR-03）：AI 首个
  // 事件到达（撤看门狗同点位）。防重键 (session_id, run_id) 的判定在 daemon 层
  // 拦截分支（D-013④，daemon 进程级有界 Set——本层每 envelope 无状态直发，主
  // envelope 流量大不在本层做 Map 记账）。fire-and-forget 走 deps.onTurnMessage
  // 桥（daemon 层拦截转 notifyTurnPhase，不进日志轨），失败静默（D-009）。
  // currentRunId 类型为 string | undefined：无 run 的 envelope（收尾窗口）跳过
  // 上报——first_event 语义绑定 run，无 run 无可归属阶段。
  const firstEventRunId = state.currentRunId;
  if (firstEventRunId) {
    // 2026-10-26-turn-phase-prod-fix task-02：补观测（FR-03）——到达记点（TRACE
    // 时 info）+ 失败首警 warn（此前纯吞 = 生产黑盒）。
    notePhaseEmit('events_first_event', state.sessionId, firstEventRunId, 'first_event');
    try {
      void Promise.resolve(
        mgr.deps.onTurnMessage(state.sessionId, firstEventRunId, {
          type: 'turn_phase_report',
          phase: 'first_event',
        }),
      ).catch((e: unknown) => {
        warnOncePhaseFailure('events_first_event', state.sessionId, firstEventRunId, 'first_event', e);
      });
    } catch (e) {
      // 同步抛（测试 mock 形态/桥未挂）兜底吞掉：上报绝不反向打断事件主链路。
      warnOncePhaseFailure('events_first_event', state.sessionId, firstEventRunId, 'first_event', e);
    }
  }
  // 2026-10-23-watchdog-steering-guard FR-02/FR-03：envelope 到达即轮内活动——
  // 刷新 stale 判定基准（lastTurnEventAt），并登记当前 run 为「已启动」。
  state.lastTurnEventAt = Date.now();
  if (state.currentRunId) rememberObservedRun(state, state.currentRunId);
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
      // ql-20260909-004：cursor 换轨跟随——CursorDriver 每轮 respawn + --resume
      // chatId，某轮 resume 失效时 cursor 会静默开新 chat，此后 init 帧携带新
      // session_id；write-once 会让落盘 resume key 永停旧 chat，daemon 重启恢复
      // 即与活会话上下文分叉。cursor 的 system/init 就是每轮 respawn 的主会话
      // 起点（无子代理 init 形态），主流 sid 变化=真实换轨，允许跟随覆盖并记
      // 日志。其它 provider 维持 write-once（D-003@v1 防误覆盖 resume key 的
      // 保守语义不变，claude 子代理 init 仍走 parent_tool_use_id 守卫）。
      const followLatestSessionId = state.provider === 'cursor';
      if (
        sid &&
        !isSubagentInit &&
        (state.agentSessionId === undefined ||
          (sid !== state.agentSessionId &&
            (state.forkedInitPending === true || followLatestSessionId)))
      ) {
        if (state.agentSessionId !== undefined && state.agentSessionId !== sid) {
          // eslint-disable-next-line no-console
          console.info('[session-manager] cursor chat switched; resume key follows', {
            session_id: state.sessionId,
            old_agent_session_id: state.agentSessionId,
            new_agent_session_id: sid,
          });
        }
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
    case 'context_compacting': {
      // ql-20260917-006：上下文压缩过程状态（system/status 帧 compacting /
      // compact_result 事件化）→ 落 [COMPACT_STATUS] 协议行（writeTaskLine 同款
      // legacy flat 形态直接经 onTurnMessage，backend 按 stdout 文本行持久 +
      // SSE 推送）。前端分类器识别该前缀：运行中轮实时显示「上下文正在重新
      // 压缩」/失败提示，终态成功不渲染（紧随的续接摘要段已是完成标记）。
      // 无 active turn（runId 空）丢弃——压缩状态只在轮内产生，口径同 bash_*。
      const runId = state.currentRunId;
      if (!runId) return;
      const meta = eventMetaOf(ev);
      const phase = strOf(meta?.['phase']) ?? 'compacting';
      const payload: Record<string, unknown> = {
        phase: phase === 'success' || phase === 'failed' ? phase : 'compacting',
      };
      const error = strOf(meta?.['error']);
      if (error) payload['error'] = error;
      await mgr.deps.onTurnMessage(state.sessionId, runId, {
        event_type: 'text',
        content: `[COMPACT_STATUS] ${JSON.stringify(payload)}`,
        channel: 'stdout',
      });
      return;
    }
    case 'api_retry': {
      // 2026-10-28-model-retry-visible：模型 API 重试过程信号 → [MODEL_RETRY]
      // 协议行（形态对齐 ql-20260917-006 [COMPACT_STATUS]：legacy flat 文本行
      // 直接经 onTurnMessage，backend 按 stdout 文本行持久 + SSE 推送，前端
      // 分类器识别前缀在运行中轮实时显示「模型限流重试中 第N/M次」）。
      // 无 active turn（runId 空）丢弃——重试状态只在轮内产生，口径同 compact。
      // error_status 连接类为 null 原样保留（不伪造 0 不省略键）；error 截断 200。
      const runId = state.currentRunId;
      if (!runId) return;
      const meta = eventMetaOf(ev);
      const payload: Record<string, unknown> = {};
      const attempt = numOf(meta?.['attempt']);
      if (attempt !== undefined) payload['attempt'] = attempt;
      const maxRetries = numOf(meta?.['max_retries']);
      if (maxRetries !== undefined) payload['max_retries'] = maxRetries;
      const delayMs = numOf(meta?.['retry_delay_ms']);
      if (delayMs !== undefined) payload['retry_delay_ms'] = delayMs;
      const errorStatus = meta?.['error_status'];
      if (errorStatus === null || typeof errorStatus === 'number') {
        payload['error_status'] = errorStatus;
      }
      const errorText = strOf(meta?.['error']);
      if (errorText) payload['error'] = errorText.slice(0, 200);
      await mgr.deps.onTurnMessage(state.sessionId, runId, {
        event_type: 'text',
        content: `[MODEL_RETRY] ${JSON.stringify(payload)}`,
        channel: 'stdout',
      });
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
 *
 * 2026-10-27-task-wakeup-precision-fix FR-02：登记面扩至 Bash（前台长命令
 * 同样有 task 生命周期帧——bsal4e1x9 前台 pnpm install 70s 实证），并解析
 * run_in_background 存 isBackground——终态唤醒前后台判定的主判据锚。恒登记
 * 布尔值（三态判定依赖：undefined 保留给「tool_use 事件未到达」场景走兜底）。
 */
export function registerAgentToolUseMeta(
  mgr: SessionManagerCore,
  state: SessionState,
  ev: AgentEvent,
): void {
  if (
    ev.tool_name !== 'Task' &&
    ev.tool_name !== 'Agent' &&
    ev.tool_name !== 'Bash'
  ) {
    return;
  }
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
  // 工具契约层前后台声明：无 run_in_background 参数的调用结果必然同轮返回
  // 主代理（前台）——缺省即 false，非 unknown。
  const isBackground = input['run_in_background'] === true;
  mgr._agentToolUseMeta.set(callId, {
    sessionId: state.sessionId,
    taskName,
    ...(subagentType ? { subagentType } : {}),
    isBackground,
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
