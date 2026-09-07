/**
 * interactive/session-manager/background-tasks.ts —— 后台任务状态簇
 * （task-03 后台任务注册表 + task-08 事件化消费 + 终态唤醒 debounce）。
 *
 * task-02（2026-09-07-arch-large-file-split）：原 SessionManager 的
 * _handleAgentTaskStatusEvent / _handleTaskNotificationEvent /
 * _scheduleTaskWakeup / _registerAsyncReceiptTask / _writeTaskLine /
 * _getOrCreateTaskMap / _clearBackgroundTasks 方法体原样下沉（仅 ``this`` →
 * ``mgr`` 改显式传参，行为零变化；类静态 TASK_PROGRESS_LINE_THROTTLE_MS
 * 随方法体落位为本模块常量）。
 *
 * @module interactive/session-manager/background-tasks
 */

import type { AgentEvent } from '../../types.js';
import type { SessionState } from '../types.js';
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
    mgr._emitSessionEvent(state.sessionId, updatedRunId, {
      kind: 'agent_task_status',
      task_id: taskId,
      task_name: info.taskName,
      status: 'running',
      ...(info.toolUseId ? { tool_use_id: info.toolUseId } : {}),
      ...(updatedSummary ? { summary: updatedSummary } : {}),
    });
    return;
  }
  if (!info) {
    // running + 未注册：注册 + emit + [TASK_STARTED] 行。
    const taskName = strOf(meta?.['task_name']) || '后台任务';
    const subagentType = strOf(meta?.['subagent_type']) || undefined;
    // 捕获派发 runId（task_notification 常在本 turn 收尾后到达，届时
    // currentRunId 已清空——注册表是唯一带 runId 的地方）。
    const runId = state.currentRunId;
    tasks.set(taskId, {
      ...(toolUseId ? { toolUseId } : {}),
      taskName,
      ...(subagentType ? { subagentType } : {}),
      async: true,
      startedAt: Date.now(),
      ...(runId ? { runId } : {}),
    });
    // 无 runId（极端时序）→ emit/落行双双跳过；注册表仍在，后续
    // progress/notification 用 info.runId ?? currentRunId 兜住。
    if (!runId) return;
    mgr._emitSessionEvent(state.sessionId, runId, {
      kind: 'agent_task_status',
      task_id: taskId,
      task_name: taskName,
      status: 'running',
      ...(toolUseId ? { tool_use_id: toolUseId } : {}),
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
 * 落 [TASK_NOTIFICATION] 行（不节流）+ 任务表注销 + 完成/失败触发主代理
 * 唤醒（对齐旧 _handleTaskNotification，elapsed_ms 服务端权威值经归一化器
 * 从 usage.duration_ms 提升 metadata；缺失时不发，前端本地走秒兜底）。
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
  if (
    rawStatus !== 'completed' &&
    rawStatus !== 'failed' &&
    rawStatus !== 'stopped'
  ) {
    // 非法终态（归一化器已过滤，防御运行时异常形态）：
    // 已注销，不再 emit/落行。
    return;
  }
  const toolUseId = strOf(meta?.['tool_use_id']) || undefined;
  const taskName =
    info?.taskName ??
    (toolUseId
      ? mgr._agentToolUseMeta.get(toolUseId)?.taskName
      : undefined) ??
    '后台任务';
  const runId = info?.runId ?? state.currentRunId;
  if (!runId) {
    // 注册表缺失且无在跑 turn（如 daemon 重启后孤儿终态）：无处可归，
    // 跳过（会话 end 收敛兜底）。
    return;
  }
  const effectiveToolUseId = info?.toolUseId ?? toolUseId;
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

  // ql-20260827-007：completed/failed 触发主代理唤醒（stopped 多为用户/系统主动
  // 停止，结果无需汇报，不唤醒防噪）。
  if (rawStatus === 'completed' || rawStatus === 'failed') {
    scheduleTaskWakeup(mgr, state.sessionId, {
      taskId,
      taskName,
      status: rawStatus,
      elapsedMs,
      summary,
    });
  }
}

/**
 * ql-20260827-007：后台任务终态唤醒调度——2s debounce 合并同会话多条通知后，
 * 经 deps.onTaskWakeupInject 注入一条「后台任务通知」user 消息（backend inject
 * 创建新 turn 唤醒主代理汇报；忙态由 queue_when_busy 排队）。未注入回调
 * （测试/旧构造点）时静默跳过。防环：prompt 明示「汇报后结束本轮、勿重执行」；
 * 每次唤醒都由真实终态触发，无自持循环。
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
      const prompt =
        `[后台任务通知] 以下 ${e.lines.length} 个后台子代理任务已全部结束` +
        '（列表中的每一个都已终止，没有仍在运行的任务）：\n' +
        e.lines.join('\n') +
        `\n请逐条核对上述每个任务（共 ${e.lines.length} 个）的名称与结果，一次性向用户完整汇报（综合归纳，不要逐字照抄，不要遗漏任何一个任务）；` +
        '禁止声称仍在等待任何任务；汇报完即结束本轮；不要重复执行这些任务；此消息为系统通知，无需向用户复述本通知本身。';
      void (async () => {
        try {
          await cb(sessionId, prompt);
        } catch (err) {
          console.error('[session-manager] task wakeup inject failed', {
            sessionId,
            error: err instanceof Error ? err.message : String(err),
          });
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
 * task-03：清理指定 session 的后台任务表 + Task/Agent tool_use 元数据。
 * 会话终态（end/fail）调用——SDK 进程已 kill，后台任务随进程消亡，后续
 * task_* 不会再到达；防 Map 泄漏（对齐 _clearRunningBashCommands 语义）。
 */
export function clearBackgroundTasks(
  mgr: SessionManagerCore,
  sessionId: string,
): void {
  mgr._backgroundTasks.delete(sessionId);
  for (const [toolUseId, meta] of mgr._agentToolUseMeta) {
    if (meta.sessionId === sessionId) {
      mgr._agentToolUseMeta.delete(toolUseId);
    }
  }
}
