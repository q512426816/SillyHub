/**
 * interactive/session-manager/background-tasks.ts —— 后台任务状态簇
 * （task-03 后台任务注册表 + task-08 事件化消费）。
 *
 * task-02（2026-09-07-arch-large-file-split）：原 SessionManager 的
 * _handleAgentTaskStatusEvent / _handleTaskNotificationEvent /
 * _registerAsyncReceiptTask / _writeTaskLine /
 * _getOrCreateTaskMap / _clearBackgroundTasks 方法体原样下沉（仅 ``this`` →
 * ``mgr`` 改显式传参，行为零变化；类静态 TASK_PROGRESS_LINE_THROTTLE_MS
 * 随方法体落位为本模块常量）。
 *
 * 2026-10-13-task-wakeup-remove 曾将终态唤醒链整体移除（用户裁定自动汇报轮
 * 没必要）；2026-10-21-task-wakeup-restore 窄化恢复——会话 49d893ab 实证主代理
 * 派发子代理后结束回合、任务完成无唤醒即停摆。恢复后的口径：completed/failed
 * 终态经 2s debounce 合并注入「[后台任务通知]」（静默阈值 env 可配、0=关闭阀、
 * stopped 不唤醒），终态侧信道（emit/[TASK_NOTIFICATION] 落行/注销）不变。
 *
 * @module interactive/session-manager/background-tasks
 */

import type { AgentEvent } from '../../types.js';
import type { SessionState } from '../types.js';
import { taskWakeupQuietThresholdMs, taskWakeupRetryDelaysMs } from '../../daemon.js';
import { eventMetaOf, numOf, strOf } from './helpers.js';
import type { BackgroundTaskInfo, SessionManagerCore } from './types.js';

/**
 * task-03（design R-03 定案）：[TASK_PROGRESS] 行同任务落库最小间隔 ms
 * （spike 实测短任务零发射，节流保留默认值——发射稀疏时自然无感）。
 * 仅作用于落行；SSE emit 不节流（实时精度优先）。
 */
const TASK_PROGRESS_LINE_THROTTLE_MS = 2000;

/**
 * task-08（对账表 #8）：status/agent_task_status 统一处理器。
 *
 * 归一化器把 task_started/task_progress/task_updated 三类 system 帧都映射为
 * subtype='agent_task_status'（metadata.status running/终态六值映射，design §7 枚举
 * 无独立 started/progress subtype），消费侧按注册状态统一分派（注册表/
 * 节流/唤醒/[TASK_*] 行语义不变，SDK 契约依据同旧 _handleTask* 系列：
 *   - 终态（completed/failed/stopped）：对齐旧 _handleTaskUpdated——仅 emit 轻量事件
 *     （无行/无注销/无唤醒；权威终态走 task_notification）；任务表无记录时丢弃
 *     （轻量信号无从挂靠，对齐旧口径）；
 *   - running + 未注册：对齐旧 _handleTaskStarted——注册 + emit + [TASK_STARTED]
 *     行（skip_transcript ambient 任务归一化器已丢弃；重复 task_started 仅补关联键）。
 *     覆盖旧 _handleTaskProgress 的懒注册路径——差异：懒注册现也落
 *     [TASK_STARTED] 行（旧仅静默注册）；该路径仅在 task_started 丢失/daemon
 *     重启窗口触发，交付报告已列明；
 *   - running + 已注册：对齐旧 _handleTaskProgress——emit（不节流）+
 *     [TASK_PROGRESS] 行 ≥2000ms 节流（R-03）。已知差异（task_name 键判别的
 *     固有模糊）：重复 task_started（SDK 重放，注册后到达）走本分支会多一次
 *     running emit（旧实现静默 return）——注册/落行仍幂等（单一注册表条目 +
 *     单一 [TASK_STARTED] 行），交付报告已列明。
 *   - running 态 task_updated（metadata 无 task_name 键）：对齐旧
 *     _handleTaskUpdated——仅 emit 轻量事件，不落行、不动节流锚点。
 */
export async function handleAgentTaskStatusEvent(
  mgr: SessionManagerCore,
  state: SessionState,
  ev: AgentEvent,
): Promise<void> {
  const meta = eventMetaOf(ev);
  const taskId = strOf(meta?.['task_id']);
  if (!taskId) return; // 无 task_id 无法注册/关联（归一化器已过滤，防御运行时异常形态）
  const toolUseId = strOf(meta?.['tool_use_id']) || undefined;
  const status = strOf(meta?.['status']);

  // 终态（task_updated patch 映射）：仅 emit（任务表条目仍在——权威终态由
  // task_notification 注销）。
  if (status === 'completed' || status === 'failed' || status === 'stopped') {
    const terminalInfo = getOrCreateTaskMap(mgr, state.sessionId).get(taskId);
    if (!terminalInfo) {
      // 任务表无记录（未注册 / 已注销）→ 轻量信号无从挂靠。
      return;
    }
    const terminalRunId = terminalInfo.runId ?? state.currentRunId;
    if (!terminalRunId) return;
    const errorText = strOf(meta?.['summary']) || undefined;
    mgr._emitSessionEvent(state.sessionId, terminalRunId, {
      kind: 'agent_task_status',
      task_id: taskId,
      task_name: terminalInfo.taskName,
      status,
      ...(terminalInfo.toolUseId
        ? { tool_use_id: terminalInfo.toolUseId }
        : {}),
      ...(errorText ? { summary: errorText } : {}),
    });
    return;
  }

  const tasks = getOrCreateTaskMap(mgr, state.sessionId);
  const info = tasks.get(taskId);
  // 2026-10-30-task-resume-revive-notify-retry：running 帧的续唤打标——task_id
  // 在已终态集合（task_notification 注销过）即「注销后重开」铁证，emit 携带
  // resumed:true（平台终态行据此复活）。取标在各分支 runId 判定之后、emit
  // 之前（只在真正 emit 时消耗标记——提前 return 的极端时序不烧标，后续帧
  // 仍可打标；一次性，首帧后同任务 running 不再带标）。
  // task_updated 判别：归一化器的 task_updated 事件 metadata 只带
  // {task_id, status, summary?}（不带 task_name 键）；task_started/task_progress
  // 恒带 task_name 键（description || '后台任务'）。据此区分 updated 轻量信号
  //（emit-only，不落行）与 started/progress 家族（注册 + 落行）。
  const isUpdatedSignal =
    !meta || !('task_name' in (meta as Record<string, unknown>));
  if (isUpdatedSignal && info) {
    // running 态 task_updated（patch.status 映射 running/killed 前的中间态）：
    // 对齐旧 _handleTaskUpdated——仅 emit 轻量事件，不落行、不动节流锚点。
    const updatedRunId = info.runId ?? state.currentRunId;
    if (!updatedRunId) return;
    const updatedSummary = strOf(meta?.['summary']) || undefined;
    const updatedResumed = takeResumedFlag(mgr, state.sessionId, taskId);
    mgr._emitSessionEvent(state.sessionId, updatedRunId, {
      kind: 'agent_task_status',
      task_id: taskId,
      task_name: info.taskName,
      status: 'running',
      ...(info.toolUseId ? { tool_use_id: info.toolUseId } : {}),
      ...(updatedSummary ? { summary: updatedSummary } : {}),
      ...(updatedResumed ? { resumed: true } : {}),
    });
    return;
  }
  if (!info) {
    // running + 未注册：注册 + emit + [TASK_STARTED] 行。
    const taskName = strOf(meta?.['task_name']) || '后台任务';
    const subagentType = strOf(meta?.['subagent_type']) || undefined;
    // 2026-10-27-task-wakeup-precision-fix FR-02：从 tool_use 元数据带入前后台
    // 声明（task_started 帧自身不带 run_in_background；meta 未登记时保持
    // undefined——终态唤醒判定走时长阈值兜底，不误判前台）。
    const metaInfo = toolUseId
      ? mgr._agentToolUseMeta.get(toolUseId)
      : undefined;
    // 捕获派发 runId（task_notification 常在本 turn 收尾后到达，届时
    // currentRunId 已清空——注册表是唯一带 runId 的地方）。
    const runId = state.currentRunId;
    tasks.set(taskId, {
      ...(toolUseId ? { toolUseId } : {}),
      taskName,
      ...(subagentType ? { subagentType } : {}),
      ...(metaInfo?.isBackground !== undefined
        ? { isBackground: metaInfo.isBackground }
        : {}),
      async: true,
      startedAt: Date.now(),
      ...(runId ? { runId } : {}),
    });
    // 无 runId（极端时序）→ emit/落行双双跳过；注册表仍在，后续
    // progress/notification 用 info.runId ?? currentRunId 兜住。
    if (!runId) return;
    const startedResumed = takeResumedFlag(mgr, state.sessionId, taskId);
    mgr._emitSessionEvent(state.sessionId, runId, {
      kind: 'agent_task_status',
      task_id: taskId,
      task_name: taskName,
      status: 'running',
      ...(toolUseId ? { tool_use_id: toolUseId } : {}),
      ...(startedResumed ? { resumed: true } : {}),
    });
    await writeTaskLine(mgr, state.sessionId, runId, '[TASK_STARTED]', {
      task_id: taskId,
      ...(toolUseId ? { tool_use_id: toolUseId } : {}),
      task_name: taskName,
      ...(subagentType ? { subagent_type: subagentType } : {}),
      async: true,
    }, toolUseId);
    return;
  }

  // running + 已注册：进度（emit 不节流 + [TASK_PROGRESS] 行 ≥2000ms 节流）。
  if (toolUseId && !info.toolUseId) {
    // 重复信号补全缺失关联键（对齐旧 _handleTaskStarted 幅边）。
    info.toolUseId = toolUseId;
  }
  info.lastProgressAt = Date.now();
  const runId = info.runId ?? state.currentRunId;
  if (!runId) return;
  const lastToolName = strOf(meta?.['last_tool_name']) || undefined;
  const summary = strOf(meta?.['summary']) || undefined;
  const elapsedMs = numOf(meta?.['elapsed_ms']);
  const totalTokens = numOf(meta?.['total_tokens']);
  const toolUses = numOf(meta?.['tool_uses']);
  const progressResumed = takeResumedFlag(mgr, state.sessionId, taskId);
  // emit 不节流（SSE 实时精度优先；R-03 节流只作用于落行）。
  mgr._emitSessionEvent(state.sessionId, runId, {
    kind: 'agent_task_status',
    task_id: taskId,
    task_name: info.taskName,
    status: 'running',
    ...(info.toolUseId ? { tool_use_id: info.toolUseId } : {}),
    ...(lastToolName ? { last_tool_name: lastToolName } : {}),
    ...(summary ? { summary } : {}),
    ...(elapsedMs !== undefined ? { elapsed_ms: elapsedMs } : {}),
    ...(totalTokens !== undefined ? { total_tokens: totalTokens } : {}),
    ...(toolUses !== undefined ? { tool_uses: toolUses } : {}),
    ...(progressResumed ? { resumed: true } : {}),
  });
  // R-03：[TASK_PROGRESS] 行同任务 ≥2000ms 节流合并；首行（lastLineAt 未设）必落。
  const now = Date.now();
  if (
    now - (info.lastLineAt ?? 0) <
    TASK_PROGRESS_LINE_THROTTLE_MS
  ) {
    return;
  }
  info.lastLineAt = now;
  await writeTaskLine(mgr, state.sessionId, runId, '[TASK_PROGRESS]', {
    task_id: taskId,
    ...(elapsedMs !== undefined ? { elapsed_ms: elapsedMs } : {}),
    ...(totalTokens !== undefined ? { total_tokens: totalTokens } : {}),
    ...(toolUses !== undefined ? { tool_uses: toolUses } : {}),
    ...(lastToolName ? { last_tool_name: lastToolName } : {}),
    ...(summary ? { summary } : {}),
  }, info.toolUseId);
}

/**
 * task-08（对账表 #8）：status/task_notification 消费——emit 终态 +
 * 落 [TASK_NOTIFICATION] 行（不节流）+ 任务表注销（对齐旧
 * _handleTaskNotification，elapsed_ms 服务端权威值经归一化器
 * 从 usage.duration_ms 提升 metadata；缺失时不发，前端本地走秒兜底）。
 * 2026-10-21-task-wakeup-restore：completed/failed 恢复触发主代理唤醒
 * （别名补发之后、静默阈值门槛判定 + scheduleTaskWakeup；stopped 不唤醒）。
 */
export async function handleTaskNotificationEvent(
  mgr: SessionManagerCore,
  state: SessionState,
  ev: AgentEvent,
): Promise<void> {
  const meta = eventMetaOf(ev);
  const taskId = strOf(meta?.['task_id']);
  if (!taskId) return;
  const rawStatus = strOf(meta?.['status']);
  const tasks = getOrCreateTaskMap(mgr, state.sessionId);
  const info = tasks.get(taskId);
  const elapsedMs = numOf(meta?.['elapsed_ms']);
  const summary = strOf(meta?.['summary']) || strOf(ev.content);
  // 任务表注销（终态即注销——先删后 emit，防重复消费；后续同
  // task_id 的迟到 progress 会走懒注册兜底而非挂死条目）。
  tasks.delete(taskId);
  // 2026-10-30-task-resume-revive-notify-retry：登记已终态集合——此后同
  // task_id 的 running 帧即续唤重开（takeResumedFlag 打标复活信号）。
  recordTerminalTaskId(mgr, state.sessionId, taskId);
  // 2026-10-13-agent-task-stuck-running（FR-01）：tool_use 派生懒注册的别名
  // 条目（task_id=call id，toolUseId 同值）与真条目（SDK 帧 harness task_id）
  // 双 id 并存——真终态只到主 task_id，别名条目永卡 running。注销主条目后
  // 按 toolUseId 扫描一并注销别名；主条目从未注册（task_started 帧丢失）时
  // 尾部为别名补发终态。扫描在锚点判定之前，保证「注册表清空 → 清锚点」
  // 口径不被别名残留干扰。
  const metaToolUseId = strOf(meta?.['tool_use_id']) || undefined;
  const effectiveToolUseId = info?.toolUseId ?? metaToolUseId;
  const aliases: Array<[string, BackgroundTaskInfo]> = [];
  if (effectiveToolUseId) {
    for (const [aliasId, aliasInfo] of tasks) {
      if (aliasId !== taskId && aliasInfo.toolUseId === effectiveToolUseId) {
        aliases.push([aliasId, aliasInfo]);
        tasks.delete(aliasId);
      }
    }
  }
  // 2026-09-15-background-task-permission-lockout（FR-01）：末任务终态注销后若
  // 注册表清空，清掉后台锚点（onResult 因注册表非空保留的 currentRunId）——守卫
  // 放行条件 hasBackgroundTaskGrace 随注册表空自动失效，恢复 fail-closed。仅
  // status==='active' 时清：新一轮在跑（status=running）时 currentRunId 是活轮
  // 绑定，绝不可误清。非法终态分支同清（已注销即不再存活）。
  if (tasks.size === 0 && state.status === 'active') {
    state.currentRunId = undefined;
  }
  if (
    rawStatus !== 'completed' &&
    rawStatus !== 'failed' &&
    rawStatus !== 'stopped'
  ) {
    // 非法终态（归一化器已过滤，防御运行时异常形态）：
    // 已注销，不再 emit/落行。
    return;
  }
  const toolUseId = metaToolUseId;
  const taskName =
    info?.taskName ??
    aliases[0]?.[1].taskName ??
    (toolUseId
      ? mgr._agentToolUseMeta.get(toolUseId)?.taskName
      : undefined) ??
    '后台任务';
  // runId 兜底链末位加别名条目（FR-01）：task_started 丢失时主条目不存在，
  // 别名条目注册时捕获的派发 runId 是唯一归属证据——用它既救主 emit 也救
  // 别名补发（否则三无 return 会先于补发短路）。
  const runId = info?.runId ?? state.currentRunId ?? aliases[0]?.[1].runId;
  if (!runId) {
    // 注册表缺失且无在跑 turn（如 daemon 重启后孤儿终态）：无处可归——
    // 2026-10-13-agent-task-stuck-running（FR-01）起不再静默丢弃：留 WARN
    // 日志可事后排查（重启窗口 SDK 子进程已亡，通常不会再有后续信号），
    // 会话 end 收敛兜底不变。
    console.warn('[session-manager] task_notification dropped: no run attribution', {
      sessionId: state.sessionId,
      taskId,
      status: rawStatus,
      ...(summary ? { summary: summary.slice(0, 200) } : {}),
    });
    return;
  }
  mgr._emitSessionEvent(state.sessionId, runId, {
    kind: 'agent_task_status',
    task_id: taskId,
    task_name: taskName,
    status: rawStatus,
    ...(effectiveToolUseId ? { tool_use_id: effectiveToolUseId } : {}),
    ...(summary ? { summary } : {}),
    ...(elapsedMs !== undefined ? { elapsed_ms: elapsedMs } : {}),
  });
  // 终态行不节流（task_log_line_format 契约）。
  await writeTaskLine(mgr, state.sessionId, runId, '[TASK_NOTIFICATION]', {
    task_id: taskId,
    status: rawStatus,
    ...(elapsedMs !== undefined ? { elapsed_ms: elapsedMs } : {}),
    ...(summary ? { summary } : {}),
  }, effectiveToolUseId);

  // 2026-10-13-agent-task-stuck-running（FR-01）：主条目从未注册（task_started
  // 帧丢失，注册表仅有 tool_use 派生懒注册的别名条目）时，为别名补发同状态
  // 终态事件 + 落行——别名侧的前端 SSE 卡片与时间线段元数据才收敛。主条目
  // 存在时别名补发只会产生重复行（backend 幽灵收口 agent_task_store
  // _resolve_row_with_ghost_reconciliation 已管冒名行归并），此处静默——注销
  // 已在函数头完成。（原「放唤醒判定之前」的顺序约束随唤醒链移除而消——
  // 2026-10-13-task-wakeup-remove。）
  if (!info) {
    for (const [aliasId, aliasInfo] of aliases) {
      const aliasRunId = aliasInfo.runId ?? runId;
      if (!aliasRunId) continue;
      mgr._emitSessionEvent(state.sessionId, aliasRunId, {
        kind: 'agent_task_status',
        task_id: aliasId,
        task_name: aliasInfo.taskName,
        status: rawStatus,
        ...(aliasInfo.toolUseId ? { tool_use_id: aliasInfo.toolUseId } : {}),
        ...(summary ? { summary: summary } : {}),
        ...(elapsedMs !== undefined ? { elapsed_ms: elapsedMs } : {}),
      });
      await writeTaskLine(mgr, state.sessionId, aliasRunId, '[TASK_NOTIFICATION]', {
        task_id: aliasId,
        status: rawStatus,
        ...(elapsedMs !== undefined ? { elapsed_ms: elapsedMs } : {}),
        ...(summary ? { summary: summary } : ''),
      }, aliasInfo.toolUseId);
    }
  }

  // 2026-10-21-task-wakeup-restore：completed/failed 触发主代理唤醒（stopped
  // 多为用户/系统主动停止，结果无需汇报，不唤醒防噪）。放在别名补发之后：
  // 短任务门槛的提前 return 不得跳过补发。
  //
  // 2026-10-27-task-wakeup-precision-fix：判据反转——主判据从「时长 ≥ 静默
  // 阈值」改为 tool_use 的 run_in_background 前后台声明（时长只是相关性代理，
  // 两头误伤：61s 前台命令误唤醒冗余汇报轮、59s 真后台任务漏唤醒停摆）。
  // 三态：true → 完成即唤醒（真后台结果只在通知里；防灌屏职责由前台免唤醒
  // 承担——实证灌屏源是前台孙命令）；false → 免唤醒（前台结果必然同轮返回，
  // 注入即冗余）；undefined → 旧逻辑兜底（时长阈值防噪阀 + fail-open）。
  if (rawStatus === 'completed' || rawStatus === 'failed') {
    // 时长判定值 + 来源：显示（FR-01）与门槛（FR-03 兜底）与日志（FR-04）同源。
    const durationMs =
      elapsedMs !== undefined
        ? elapsedMs
        : info?.startedAt !== undefined
          ? Date.now() - info.startedAt
          : undefined;
    const durationSource: 'sdk-frame' | 'registry' | 'unknown' =
      elapsedMs !== undefined
        ? 'sdk-frame'
        : info?.startedAt !== undefined
          ? 'registry'
          : 'unknown';
    // 前后台判定链：注册条目 > 别名条目 > tool_use 元数据（均缺 = 信息不足）。
    const bg = resolveWakeupBackground(mgr, info, aliases, effectiveToolUseId);
    const gate = {
      task_id: taskId,
      task_name: taskName,
      status: rawStatus,
      duration_ms: durationMs,
      duration_source: durationSource,
      background: bg.isBackground,
      background_source: bg.source,
    };
    // 总关闭阀（FR-03）：阈值配置 0 时一律不注入（引擎原生自续跑出现双轮时的
    // 止血开关）——全局生效，先于三态判定。
    const quietMs = taskWakeupQuietThresholdMs();
    if (quietMs <= 0) {
      console.info(
        '[session-manager] task wakeup gate: disabled (SILLYHUB_TASK_WAKEUP_QUIET_MS=0)',
        gate,
      );
      return;
    }
    if (bg.isBackground === false) {
      // 前台免唤醒（FR-02）：终态 emit / [TASK_NOTIFICATION] 落行不受影响
      //（本分支只收敛注入面）。
      console.info(
        '[session-manager] task wakeup skipped: foreground task',
        gate,
      );
      return;
    }
    if (bg.isBackground === true) {
      // 真后台：完成即唤醒，不受时长阈值限制（短后台任务漏唤醒即停摆）。
      console.info(
        '[session-manager] task wakeup scheduled: background task terminal',
        gate,
      );
      scheduleTaskWakeup(mgr, state.sessionId, {
        taskId,
        taskName,
        status: rawStatus,
        elapsedMs: durationMs,
        summary,
      });
      return;
    }
    // undefined：信息不足兜底——时长阈值防噪阀 + 双缺失 fail-open（旧行为）。
    if (durationMs !== undefined && durationMs < quietMs) {
      console.info(
        '[session-manager] task wakeup skipped: below quiet threshold (no background marker)',
        gate,
      );
      return;
    }
    console.warn(
      '[session-manager] task wakeup fallback pass: no background marker',
      gate,
    );
    scheduleTaskWakeup(mgr, state.sessionId, {
      taskId,
      taskName,
      status: rawStatus,
      elapsedMs: durationMs,
      summary,
    });
  }
}

/**
 * 2026-10-27-task-wakeup-precision-fix FR-02：终态唤醒的前后台判定链。
 *
 * 优先级：注册条目 isBackground（task_started 注册时从 meta 带入 / 回执路径
 * 恒 true）> 别名条目（tool_use 派生懒注册同键）> tool_use 元数据
 * （registerAgentToolUseMeta 登记）。三处均缺 → undefined（信息不足，调用方
 * 走时长阈值兜底，不误判前台）。source 供结构化日志归因（FR-04）。
 */
function resolveWakeupBackground(
  mgr: SessionManagerCore,
  info: BackgroundTaskInfo | undefined,
  aliases: Array<[string, BackgroundTaskInfo]>,
  toolUseId: string | undefined,
): {
  isBackground: boolean | undefined;
  source: 'registry-entry' | 'alias' | 'tool-use-meta' | 'missing';
} {
  if (info?.isBackground !== undefined) {
    return { isBackground: info.isBackground, source: 'registry-entry' };
  }
  for (const [, aliasInfo] of aliases) {
    if (aliasInfo.isBackground !== undefined) {
      return { isBackground: aliasInfo.isBackground, source: 'alias' };
    }
  }
  const meta = toolUseId ? mgr._agentToolUseMeta.get(toolUseId) : undefined;
  if (meta?.isBackground !== undefined) {
    return { isBackground: meta.isBackground, source: 'tool-use-meta' };
  }
  return { isBackground: undefined, source: 'missing' };
}

/**
 * 2026-10-21-task-wakeup-restore（自 f889832d1^ 恢复，ql-20260827-007 原型）：
 * 后台任务终态唤醒调度——2s debounce 合并同会话多条通知后，经
 * deps.onTaskWakeupInject 注入一条「后台任务通知」user 消息（backend inject
 * 创建新 turn 唤醒主代理汇报；忙态由 queue_when_busy 排队）。未注入回调
 * （测试/旧构造点）时静默跳过。防环：prompt 明示「汇报后结束本轮、勿重执行」；
 * 每次唤醒都由真实终态触发，无自持循环（pi 影子任务走 agent_task_status
 * 路由不进本函数，无「轮结束→注入」反馈环）。
 */
export function scheduleTaskWakeup(
  mgr: SessionManagerCore,
  sessionId: string,
  info: {
    taskId: string;
    taskName: string;
    status: string;
    elapsedMs?: number;
    summary?: string;
  },
): void {
  const cb = mgr.deps.onTaskWakeupInject;
  if (!cb) return;
  const mm = Math.floor((info.elapsedMs ?? 0) / 60000);
  const ss = Math.floor(((info.elapsedMs ?? 0) % 60000) / 1000);
  const dur = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  const summaryClip = (info.summary ?? '').slice(0, 300);
  const line =
    `- 任务「${info.taskName}」已${info.status === 'completed' ? '完成' : '失败'}`
    + `（用时 ${dur}）`
    + (summaryClip ? `。结果摘要：${summaryClip}` : '')
    + `（task_id: ${info.taskId}，如需完整输出可调用 TaskOutput 查询，block=false）`;
  let entry = mgr._taskWakeupPending.get(sessionId);
  if (!entry) {
    const timer = setTimeout(() => {
      const e = mgr._taskWakeupPending.get(sessionId);
      mgr._taskWakeupPending.delete(sessionId);
      if (!e || e.lines.length === 0) return;
      // ql-20260827-008：头部明示总数+全部结束、尾部强制逐条核对——实证主代理
      // 曾只读第一行漏报后续任务、并凭历史执念声称"仍在等待"（会话 2fe664d9）。
      // 2026-10-27-task-wakeup-precision-fix FR-05：「后台子代理任务」改「后台
      // 任务」（通知对前台 Bash 命令同样触发，「子代理」失实）；「没有仍在运行
      // 的任务」改「本批次均已终止」（旧文案与会话任务面板「运行中 N」字面
      // 冲突——指本批次，非全会话）。backend _merge_task_wakeup_prompt 合并
      // 正则同步兼容形，前端识别锚 [后台任务通知] 前缀不变。
      const prompt =
        `[后台任务通知] 以下 ${e.lines.length} 个后台任务已全部结束` +
        '（本批次均已终止）：\n' +
        e.lines.join('\n') +
        `\n请逐条核对上述每个任务（共 ${e.lines.length} 个）的名称与结果，一次性向用户完整汇报（综合归纳，不要逐字照抄，不要遗漏任何一个任务）；` +
        '禁止声称仍在等待任何任务；汇报完即结束本轮；不要重复执行这些任务；此消息为系统通知，无需向用户复述本通知本身。';
      // 2026-10-27-task-wakeup-inject-retry：注入单发即弃改退避重试——原实现
      // catch 仅 console.error，撞后端短暂不可用窗（部署重建 502/504，e132e9bf
      // 实证 inject 504 DAEMON_RUNTIME_OFFLINE）即 interactive_inject_send_failed
      // 永久丢失，会话楔死至用户手动来消息（活跃坑
      // task-wakeup-inject-backend-relay-single-shot）。重试计划见
      // taskWakeupRetryDelaysMs（默认 6 档总窗约 9.3min；env 0/空=禁用回单发）。
      // 成功（含 queue_when_busy 排队）即止；退避等待后发现会话已从 _store 消失
      // （终态清理 lifecycle.ts _store.delete）即中止——不对已终态会话注入；
      // 耗尽 error 留痕放弃。fire-and-forget 语义不变（循环整体不抛）。
      void (async () => {
        const delays = taskWakeupRetryDelaysMs();
        for (let attempt = 1; ; attempt++) {
          try {
            await cb(sessionId, prompt);
            return;
          } catch (err) {
            const errText = err instanceof Error ? err.message : String(err);
            const retryIndex = attempt - 1;
            if (retryIndex >= delays.length) {
              console.error(
                '[session-manager] task wakeup inject failed (retries exhausted)',
                { sessionId, attempts: attempt, error: errText },
              );
              return;
            }
            const waitMs = delays[retryIndex]!;
            console.warn('[session-manager] task wakeup inject failed, retry scheduled', {
              sessionId,
              attempt,
              next_retry_in_ms: waitMs,
              error: errText,
            });
            await new Promise<void>((resolve) => {
              const t = setTimeout(resolve, waitMs);
              t.unref?.();
            });
            // 退避等待后、发起下一次注入前查会话存活（FR-02）——终态清理路径
            // 已 _store.delete，此时注入只会在 backend 侧撞已终态会话空转重试。
            if (!mgr._store.has(sessionId)) {
              console.warn(
                '[session-manager] task wakeup inject retry aborted: session gone',
                { sessionId, attempts: attempt },
              );
              return;
            }
          }
        }
      })();
    }, 2000);
    timer.unref?.();
    entry = { timer, lines: [line] };
    mgr._taskWakeupPending.set(sessionId, entry);
  } else {
    entry.lines.push(line);
  }
}

/**
 * task-03（design §5 P1.2）：异步启动回执兜底注册——user tool_result 文本含
 * "Async agent launched successfully" 且正则提取到 agentId 时调用。
 *
 * 以 tool_use_id 为关联键注册（task_id=agentId，async:true）；查重：CLI 已发
 * task_started 注册过同 tool_use_id（spike 结论 primary 路径）或同 agentId
 * 已注册 → 跳过（避免双 [TASK_STARTED] 行 + 双 running emit）。emit 的 extra
 * 必带 tool_use_id + async:true（design §8：「async 回执兜底路径必发」）——
 * 前端据此不再把 0.1s 配对的 tool_result 当完成信号（FR-01 假完成根因）。
 */
export async function registerAsyncReceiptTask(
  mgr: SessionManagerCore,
  state: SessionState,
  runId: string | undefined,
  agentId: string,
  toolUseId: string,
): Promise<void> {
  const tasks = getOrCreateTaskMap(mgr, state.sessionId);
  for (const info of tasks.values()) {
    if (info.toolUseId === toolUseId) {
      return; // task_started 已注册（primary 路径），回执仅是佐证。
    }
  }
  if (tasks.has(agentId)) {
    return; // 同 agentId 重复回执（理论不至），幂等跳过。
  }
  const meta = mgr._agentToolUseMeta.get(toolUseId);
  const taskName = meta?.taskName ?? '后台任务';
  tasks.set(agentId, {
    toolUseId,
    taskName,
    ...(meta?.subagentType ? { subagentType: meta.subagentType } : {}),
    // 2026-10-27-task-wakeup-precision-fix FR-02：异步启动回执恒后台——回执
    // 本身即「派发后不等待、结果经通知回传」的证据。
    isBackground: true,
    async: true,
    startedAt: Date.now(),
    ...(runId ? { runId } : {}),
  });
  if (!runId) {
    return;
  }
  mgr._emitSessionEvent(state.sessionId, runId, {
    kind: 'agent_task_status',
    task_id: agentId,
    task_name: taskName,
    status: 'running',
    tool_use_id: toolUseId,
    async: true,
  });
  await writeTaskLine(mgr, state.sessionId, runId, '[TASK_STARTED]', {
    task_id: agentId,
    tool_use_id: toolUseId,
    task_name: taskName,
    ...(meta?.subagentType ? { subagent_type: meta.subagentType } : {}),
    async: true,
  }, toolUseId);
}

/**
 * task-03（design §5 P1.3 / §8 契约）：[TASK_*] 持久行落库。
 *
 * 形状照抄 `_flushPartial` 先例——flat 消息 `{event_type:'text', content,
 * channel:'stdout'}`（backend submit_messages 顶层有 event_type/content 即
 * 原样透传，不走 _extract_sdk_messages 展开）；行级带**顶层**
 * parent_tool_use_id=tool_use_id（backend 落库读 msg.parent_tool_use_id 写
 * AgentRunLog 归属列 + P2.2 跨轮归位用，与 SDK 消息顶层字段同位）。
 * JSON.stringify 输出恒为单行（字符串内换行转义为 `\n` 字面量），满足
 * 「单行 JSON」契约；键名统一 task_name（不用 name，task-03 约束）。
 */
export async function writeTaskLine(
  mgr: SessionManagerCore,
  sessionId: string,
  runId: string,
  prefix: '[TASK_STARTED]' | '[TASK_PROGRESS]' | '[TASK_NOTIFICATION]',
  payload: Record<string, unknown>,
  parentToolUseId?: string,
): Promise<void> {
  const line: Record<string, unknown> = {
    event_type: 'text',
    content: `${prefix} ${JSON.stringify(payload)}`,
    channel: 'stdout',
    ...(parentToolUseId ? { parent_tool_use_id: parentToolUseId } : {}),
  };
  // task-08：SessionManager 内 SDK 类型清零——legacy flat 形态按 Record dict
  // 直传（原 InteractiveDriverMessage 别名已随 task-09 消费面清理退役删除）。
  await mgr.deps.onTurnMessage(sessionId, runId, line);
}

/** task-03：取或建会话级后台任务表（二级 Map 内层懒建）。 */
export function getOrCreateTaskMap(
  mgr: SessionManagerCore,
  sessionId: string,
): Map<string, BackgroundTaskInfo> {
  let tasks = mgr._backgroundTasks.get(sessionId);
  if (!tasks) {
    tasks = new Map();
    mgr._backgroundTasks.set(sessionId, tasks);
  }
  return tasks;
}

/**
 * 2026-10-30-task-resume-revive-notify-retry：task_notification 终态注销时
 * 登记已终态集合——此后同 task_id 的 running 帧即「注销后重开」（主代理
 * 续唤）铁证。别名条目不登记（call-id 冒名行由真 task_id 终态收口，续唤
 * 重开走真 id）。
 */
export function recordTerminalTaskId(
  mgr: SessionManagerCore,
  sessionId: string,
  taskId: string,
): void {
  let set = mgr._terminalTaskIds.get(sessionId);
  if (!set) {
    set = new Set();
    mgr._terminalTaskIds.set(sessionId, set);
  }
  set.add(taskId);
}

/**
 * 2026-10-30-task-resume-revive-notify-retry：running 帧的续唤打标（一次性）
 * ——task_id 在已终态集合内 → 返回 true 并即移除（后续同任务 running 帧不带
 * 标，防长重跑期重复复活信号）；不在集合（普通运行/迟到帧）→ false。
 */
export function takeResumedFlag(
  mgr: SessionManagerCore,
  sessionId: string,
  taskId: string,
): boolean {
  const set = mgr._terminalTaskIds.get(sessionId);
  if (!set || !set.has(taskId)) return false;
  set.delete(taskId);
  if (set.size === 0) mgr._terminalTaskIds.delete(sessionId);
  return true;
}

/**
 * 2026-10-11-task-sweep-daemon-truth：会话活跃后台任务只读快照——backend
 * `session_live_tasks` RPC 的数据源（死活判定唯一真相源；用户两轮指正废除了
 * 「run 终态即死」「超时无心跳即死」两类启发式）。只读 `.get`（不像
 * getOrCreateTaskMap 建空条目——查询不该有写副作用）；未注册会话 = 空数组
 * （该 daemon 上无此会话的活跃任务）。
 */
export function sessionLiveTaskIds(
  mgr: SessionManagerCore,
  sessionId: string,
): string[] {
  return [...(mgr._backgroundTasks.get(sessionId)?.keys() ?? [])];
}

/**
 * task-03：清理指定 session 的后台任务表 + Task/Agent tool_use 元数据。
 * 会话终态（end/fail）调用——SDK 进程已 kill，后台任务随进程消亡，后续
 * task_* 不会再到达；防 Map 泄漏（对齐 _clearRunningBashCommands 语义）。
 *
 * 2026-09-15-background-task-permission-lockout（FR-01）：同步清后台锚点
 * （state.currentRunId）——注册表被本函数清空后，守卫放行条件
 * hasBackgroundTaskGrace 若仍见 currentRunId 在会延长放行窗；兜底收敛
 * （对齐 R-01 注册表泄漏缓解路径，清在删表后，终态会话无在跑轮）。
 */
export function clearBackgroundTasks(
  mgr: SessionManagerCore,
  sessionId: string,
): void {
  mgr._backgroundTasks.delete(sessionId);
  // 2026-10-30-task-resume-revive-notify-retry：已终态集合同生命周期清理
  //（SDK 进程已 kill 不会再有续唤重开帧；防 Map 泄漏同上）。
  mgr._terminalTaskIds.delete(sessionId);
  const state = mgr._store.get(sessionId);
  if (state && state.status === 'active') {
    state.currentRunId = undefined;
  }
  for (const [toolUseId, meta] of mgr._agentToolUseMeta) {
    if (meta.sessionId === sessionId) {
      mgr._agentToolUseMeta.delete(toolUseId);
    }
  }
}
