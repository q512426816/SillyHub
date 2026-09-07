/**
 * interactive/session-manager/lifecycle.ts —— 空闲扫描/终止/清理/状态查询簇。
 *
 * task-02（2026-09-07-arch-large-file-split）：原 SessionManager 的
 * getIdleTimeoutSec / start / stop / scanOnce / _scanIdle / _onIdleExpire /
 * end / fail / _terminateSession / _scheduleTerminalCleanup /
 * _cancelTerminalCleanup / _abortPermissionResolver / get / hasRunningTurn
 * 方法体原样下沉（仅 ``this`` → ``mgr`` 改显式传参，行为零变化；类静态
 * TERMINAL_CLEANUP_DELAY_MS 随方法体落位为本模块常量）。
 *
 * @module interactive/session-manager/lifecycle
 */

import type { SessionState } from '../types.js';
import type { InteractiveDriverHandle } from '../driver.js';
import type { SessionManagerCore } from './types.js';

/** 终态条目延迟清理时长（ms）：给终态对账 / 立即查询留 10 分钟窗口。 */
const TERMINAL_CLEANUP_DELAY_MS = 10 * 60 * 1000;

/**
 * task-07（FR-06 / D-004@v1）：当前空闲阈值秒（env / opts / 默认 1800）。
 * 测试 + daemon 透传 env 校验用。
 */
export function getIdleTimeoutSec(mgr: SessionManagerCore): number {
  return mgr._idleTimeoutSec;
}

/**
 * task-07（FR-06 / D-004@v1）：启动空闲扫描定时器。daemon.start 后调用。幂等。
 *
 * 守卫：_idleTimer 已存在直接 return（多次 start 不创建多个定时器）。
 * unref：不阻止 node 进程退出（daemon.shutdown 显式 stop）。
 * 单 session end 失败由 _scanIdle 外层 catch 隔离，不中断本轮扫描、不崩 daemon。
 */
export function start(mgr: SessionManagerCore): void {
  if (mgr._idleTimer) return;
  // D-001@v1：idle 默认禁用（_idleTimeoutSec=0）。仅显式 >0 才启动定时器，
  // 避免 scan 等长 turn 被 idle 误杀。完成驱动 end（D-002@v1）+ 用户手动 end 负责收口。
  if (mgr._idleTimeoutSec <= 0) return;
  mgr._idleTimer = setInterval(() => {
    void mgr._scanIdle().catch((err) => {
      // 扫描异常不崩 daemon；console.error 兜底（真实 log 在 daemon 层，此处仅兜底）。
      // eslint-disable-next-line no-console
      console.error('[session-manager] idle scan failed', err);
    });
  }, mgr._idleScanSec * 1000);
  // node 标准：定时器不阻塞 daemon 退出。
  if (typeof mgr._idleTimer.unref === 'function') {
    mgr._idleTimer.unref();
  }
}

/**
 * task-07（FR-06 / D-004@v1）：停空闲扫描定时器。daemon.shutdown 调用（顺序在 WS close
 * 之前，避免 shutdown 中途扫描又触发 end→onSessionEnd→WS 已关报错）。幂等。
 *
 * 不主动 end 所有 session（避免 shutdown 风暴 backend）；active session 内存态随进程
 * 退出丢失（D-003 Wave1/2=failed），backend 侧 lease 心跳超时/WS 断开兜底收口。
 */
export function stop(mgr: SessionManagerCore): void {
  if (mgr._idleTimer) {
    clearInterval(mgr._idleTimer);
    mgr._idleTimer = null;
  }
  // ql-20260825-f3#1：清终态延迟清理定时器（进程即将退出，_store 内存随进程
  // 消亡；不让 unref'd timer 在退出途中 fire 触发已销毁状态的访问）。
  for (const timer of mgr._terminalCleanupTimers.values()) {
    clearTimeout(timer);
  }
  mgr._terminalCleanupTimers.clear();
  // ql-20260621-partial（task-08 改造）：partial flush 定时器已随缓冲链下沉
  // 归一化器（driver.consume finally dispose），daemon 侧无 timer 需清；此处仅
  // 清会话级 usage 台账（纯内存 Map，防退出途中残留引用）。
  for (const sid of Array.from(mgr._sessionUsageBase.keys())) {
    mgr._destroyUsageLedger(sid);
  }
}

/**
 * task-07 D-004 扫描一轮：active/running 且空闲超阈值的 session → end。
 *
 * 快照 sessionId 列表（避免 end 修改 _store 时迭代异常）；ended/failed/reconnecting
 * 跳过；单 session end 抛错外层 catch 隔离，不中断本轮其余 session 扫描。
 *
 * 公开为 scanOnce（生产定时器调 + 测试直接驱动单轮 + 未来运维手动触发），
 * 避免测试依赖 setInterval 在 fake timer 下的嵌套宏任务时序。
 */
export async function scanOnce(mgr: SessionManagerCore): Promise<void> {
  return mgr._scanIdle();
}

export async function scanIdle(mgr: SessionManagerCore): Promise<void> {
  // D-001@v1：idle 禁用（_idleTimeoutSec<=0）时直接返回，即使 scanOnce 被显式
  // 调用也不 end。完成驱动 end（D-002@v1）+ 用户手动 end 负责收口。
  if (mgr._idleTimeoutSec <= 0) return;
  const now = Date.now();
  // 快照 sessionId 列表，避免 end 修改 _store 时迭代异常。
  const ids = Array.from(mgr._store.keys());
  for (const sessionId of ids) {
    const state = mgr._store.get(sessionId);
    if (!state) continue;
    // 守卫：仅 active/running 回收；ended/failed/reconnecting 跳过。
    if (state.status !== 'active' && state.status !== 'running') continue;
    const idleSec = (now - state.lastActiveAt) / 1000;
    if (idleSec > mgr._idleTimeoutSec) {
      try {
        await onIdleExpire(mgr, state);
      } catch (err) {
        // 单 session end 失败不中断本轮其余扫描；记日志后继续下一周期。
        // eslint-disable-next-line no-console
        console.error('[session-manager] idle expire failed', sessionId, err);
      }
    }
  }
}

/**
 * task-07 空闲到期：走 end 统一收口（design §8.5 service.end_session）。
 *
 * running turn 进行中：先 interrupt（spike D1 turn 级）兜底，避免 end 时
 * InputQueue.close 与 SDK 当前 turn result 竞态无人收尾；interrupt 抛错忽略，
 * 靠 end 的 InputQueue.close 让 query 自然结束。
 */
async function onIdleExpire(
  mgr: SessionManagerCore,
  state: SessionState,
): Promise<void> {
  if (state.status === 'running') {
    // task-02（D-001）：用 provider-neutral _interruptInternal（不再全局 deps.driver）。
    // interrupt 失败不阻塞 end；end 会 close InputQueue 让 driver 自然结束。
    try {
      await mgr._interruptInternal(state);
    } catch {
      // noop
    }
  }
  await mgr.end(state.sessionId);
  // backend end_session 统一更新 agent_sessions.status=ended + lease=completed（design §8.5）
}

/**
 * 结束 session：经 `_terminateSession` 统一收口（task-01 起接入 driverHandle.close
 * 接通 SDK kill 链 + InputQueue.close + abort resolver + 清 partial buffer + 设 status）。
 * 幂等：已 ended/failed 直接返回。
 */
export async function end(
  mgr: SessionManagerCore,
  sessionId: string,
): Promise<void> {
  const state = mgr._store.get(sessionId);
  if (!state) return;
  if (state.status === 'ended' || state.status === 'failed') return;
  await terminateSession(mgr, state, 'manual');
}

/**
 * 标 failed（driver onError / 不可恢复异常）：经 `_terminateSession` 统一收口。幂等。
 */
export async function fail(
  mgr: SessionManagerCore,
  sessionId: string,
): Promise<void> {
  const state = mgr._store.get(sessionId);
  if (!state) return;
  if (state.status === 'ended' || state.status === 'failed') return;
  await terminateSession(mgr, state, 'driver_error');
}

/**
 * task-01（D-001@v2 / D-003 / D-004 / R-01）：统一 interactive session 终止收口。
 *
 * 收敛 end()/fail() 的既有清理步骤（**保留原始顺序**，design §12 自审唯一遗留项），
 * 仅新增 `driverHandle.close?.()` 这一步接通 SDK kill 链（stdin EOF → 2s → SIGTERM →
 * 5s → SIGKILL），止血 P0「当前 turn 卡死（如 hang 死的 bash）→ claude 不退 → consume
 * 永久挂起 → 僵尸进程持续烧 token」。原 end/fail 只 inputQueue.close（stdin EOF）+
 * q.interrupt（控制消息），均不 kill；SDK 内部已有的强制 kill 链由本次 close 触发。
 *
 * reason 语义（沿用原 end/fail 各自语义）：
 *   - 'manual'       → status='ended'（用户/空闲主动结束，对应原 end()）
 *   - 'driver_error' → status='failed'（driver onError/不可恢复异常，对应原 fail()）
 *
 * close 是可选契约（FR-07 brownfield，base InteractiveDriverHandle.close 已声明可选）：
 *   - Claude：运行时 state.query 实为 ClaudeDriverHandle（task-01 已补 close → query.close()）；
 *   - Codex ：state.driverHandle.close 经 _close（SIGTERM + 2s SIGKILL）已可达
 *     （codex-app-server-driver.ts:531）；
 *   - 其他/旧 driver 不实现 close → `?.()` no-op，不报错。
 * close 异常 try/catch 包裹不阻塞 terminate（R-01；SDK 内部已有 SIGTERM→SIGKILL 升级兜底）。
 *
 * **interrupt() 不调本方法**（守 D-001@v2：「打断本轮」按钮保持软 q.interrupt，
 * session 仍 active 可续轮；只有 end/fail/cancel 走硬杀终止链）。
 */
export async function terminateSession(
  mgr: SessionManagerCore,
  state: SessionState,
  reason: 'manual' | 'driver_error',
  opts: { notifyBackend?: boolean } = {},
): Promise<void> {
  const isManual = reason === 'manual';

  // 保留原 end()/fail() 步骤的原始顺序（design §12 铁律，不得丢弃任何既有步骤）：

  // 0. ql-20260825-002：清挂起首句的 fallback timer（终态会话不再提交）。
  const _pf = mgr._pendingFirstPrompt.get(state.sessionId);
  if (_pf) {
    clearTimeout(_pf.timer);
    mgr._pendingFirstPrompt.delete(state.sessionId);
  }

  // 1. 设终态 status（原 end→'ended' / fail→'failed'）。
  state.status = isManual ? 'ended' : 'failed';

  // 2. task-08（AC-08.7）：abort 当前 session 的 pending 审批 resolver + 移除
  //    （session 终态，resolver 无存在意义）。
  mgr._abortPermissionResolver(
    state.sessionId,
    isManual ? 'session_ended' : 'session_failed',
  );

  // 3. task-09：清借用沙箱登记（session 已终态，写守卫注册表不再需要本条）。
  mgr._clearBorrowSandbox(state.sessionId);

  // 4. task-08（FR-02）：运行中 Bash 追踪已下沉归一化器（随 SDK 进程消亡），
  //    daemon 侧不再持索引（旧 _clearRunningBashCommands 移除）。

  // 4b. task-03（2026-08-27-background-subagent-progress）：清后台任务注册表 +
  //     Task/Agent tool_use 元数据（session 终态 SDK 进程已 kill，后台任务随之
  //     消亡，task_* 不会再到达；防 Map 泄漏）。
  mgr._clearBackgroundTasks(state.sessionId);

  // ql-20260827-007：取消未 fire 的唤醒 debounce（会话已终态，注入无处可去）。
  const pendingWakeup = mgr._taskWakeupPending.get(state.sessionId);
  if (pendingWakeup) {
    clearTimeout(pendingWakeup.timer);
    mgr._taskWakeupPending.delete(state.sessionId);
  }

  // 5. task-08：销毁会话级 usage 台账 + budget 软切断登记（旧 _destroyPartialBuffer
  //    的清理职责收口；partial 定时器已随缓冲链下沉归一化器，由 driver.dispose 兜底）。
  mgr._destroyUsageLedger(state.sessionId);

  // 6. task-01 新增（D-003 / D-004 / R-01）：接通 driver kill 链。
  //    Claude 句柄运行时存在 state.query（实为 ClaudeDriverHandle，经 task-01 已补
  //    close）；Codex 句柄存在 state.driverHandle（_close 已存在）。按 provider 取
  //    目标（同 _interruptInternal 的 provider 分流模式，line 1803-1805）。
  //    可选契约 close?.()：其他/旧 driver 不实现也不报错。try/catch 不阻塞（R-01）。
  const terminateTarget: InteractiveDriverHandle | undefined =
    state.provider === 'claude'
      ? (state.query as unknown as InteractiveDriverHandle | undefined)
      : state.driverHandle;
  try {
    terminateTarget?.close?.();
  } catch {
    /* R-01: close 异常不阻塞 terminate 流程（SDK 内部已有 SIGTERM→SIGKILL 升级兜底）。 */
  }

  // 7. close InputQueue（给 stdin EOF；幂等，已 closed 不抛）。
  try {
    state.inputQueue.close();
  } catch {
    /* close 幂等，已 closed 不抛 */
  }

  // 8. 通知 backend 终态（原 end→'ended' / fail→'failed'）。
  //    ql-20260825-f6#4：onSessionEnd 入 per-session 终态通知链——若同会话有
  //    在飞的 onTurnResult（_onResult 的 await 窗口），本通知必排在其后，
  //    backend 侧顺序恒 result → end。
  //    ql-20260823-006：notifyBackend=false 供 restoreAndReconnect 驱逐内存
  //    残留条目用——backend 正推进 reconnecting→active，回发终态会与之竞态
  //    把刚要恢复的会话误翻 failed。
  if (opts.notifyBackend !== false) {
    await mgr._runNotifyChain(state.sessionId, () =>
      mgr.deps.onSessionEnd(
        state.sessionId,
        isManual ? 'ended' : 'failed',
      ),
    );
  }

  // 9. task-10：终态从落盘集合移除后 flush（不复活 ended/failed session）。
  mgr._scheduleFlush();

  // 10. ql-20260825-f3#1：终态延迟清理——到点删 _store + _pendingInjectCount 条目
  //     （含凭证 env / subagentDepth / inputQueue buffer 的 SessionState 不再永久
  //     滞留）。到点时条目若已被重建（状态非终态）则跳过；stop() 时 clearTimeout。
  scheduleTerminalCleanup(mgr, state.sessionId);
}

/**
 * ql-20260825-f3#1：安排终态条目延迟删除（幂等：同 session 已有待清理 timer
 * 不叠加——end→fail 重入、restore 驱逐后再 terminate 均复用同一 timer）。
 */
export function scheduleTerminalCleanup(
  mgr: SessionManagerCore,
  sessionId: string,
): void {
  if (mgr._terminalCleanupTimers.has(sessionId)) return;
  const timer = setTimeout(() => {
    mgr._terminalCleanupTimers.delete(sessionId);
    const current = mgr._store.get(sessionId);
    if (!current) return;
    // 重建守卫：restoreAndReconnect / create 重建的新条目（reconnecting/active/
    // running）不动。重建路径正常会先 _cancelTerminalCleanup，此处状态守卫兜底
    // 同 id 重建的时序竞态。
    if (current.status !== 'ended' && current.status !== 'failed') return;
    mgr._store.delete(sessionId);
    mgr._pendingInjectCount.delete(sessionId);
  }, TERMINAL_CLEANUP_DELAY_MS);
  // node 标准：定时器不阻塞 daemon 退出。
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  mgr._terminalCleanupTimers.set(sessionId, timer);
}

/**
 * ql-20260825-f3#1：取消终态延迟清理（restoreAndReconnect / create 重建同 id
 * 条目时调用，防到点误删新条目——时间窗内新条目可能恰好又进入终态，但那次
 * terminate 会重新 schedule，语义不受影响）。
 */
export function cancelTerminalCleanup(
  mgr: SessionManagerCore,
  sessionId: string,
): void {
  const timer = mgr._terminalCleanupTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    mgr._terminalCleanupTimers.delete(sessionId);
  }
}

/**
 * task-08：abort 当前 session 的 pending resolver 并从 map 移除（幂等）。
 * manualApproval=false 时该 session 无 resolver，no-op。
 */
export function abortPermissionResolver(
  mgr: SessionManagerCore,
  sessionId: string,
  reason: string,
): void {
  const r = mgr._resolversBySession.get(sessionId);
  if (r) {
    r.abortAll(reason);
    mgr._resolversBySession.delete(sessionId);
  }
}

/** 查询（测试用 + daemon 路由校验用）。 */
export function get(
  mgr: SessionManagerCore,
  sessionId: string,
): Readonly<SessionState> | undefined {
  return mgr._store.get(sessionId);
}

/**
 * task-01（2026-08-29-daemon-selfupdate-safety / FR-01 / D-001@v1）：是否存在
 * 进行中的 interactive turn——任一 session ``status === 'running'`` 即 true。
 *
 * 空闲屏障的忙判定查询口，供 daemon 升级编排器（tryUpdate，task-04）判定是否
 * 推迟升级。口径仅 'running' 算忙：'active'（空闲可接 inject）/ 'reconnecting'
 * 可经挂起/恢复链路无损穿越升级窗口；'ended'/'failed' 终态延迟清理残留条目
 * （_terminalCleanupTimers 窗口内，见 ql-20260825-f3#1）同样不算。遍历口径照
 * create 内活会话计数先例（本文件 for..of _store.values()）。
 *
 * quick-bfec20a6 例外臂：stale-flip 宽限窗内（active + currentRunId 仍在 +
 * staleRunResetAt 新鲜，见 _withinStaleFlipGrace）也算忙——等 AskUserQuestion
 * 作答等安静长 turn 被 >60s 启发式误翻 active 后，忙屏障若只认 running 会放行
 * 自更新重启杀掉活轮（事故会话 e148364e，12:39 daemon 自更新重启杀等答轮）。
 * 正常 result 收尾清 currentRunId，active+currentRunId ⟺ stale-flip 态；窗口
 * 有界（60min），真死 turn 不会永久阻塞升级。
 *
 * 零副作用纯查询：不修改 _store 生命周期、不触发挂起/取消。
 */
export function hasRunningTurn(mgr: SessionManagerCore): boolean {
  for (const state of mgr._store.values()) {
    if (state.status === 'running') return true;
    if (mgr._withinStaleFlipGrace(state)) return true;
  }
  return false;
}
