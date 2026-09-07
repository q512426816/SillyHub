/**
 * interactive/session-manager/turn-control.ts —— 注入/计划响应/中断/附件簇。
 *
 * task-02（2026-09-07-arch-large-file-split）：原 SessionManager 的
 * refreshClaimToken / _writeAttachmentFile / _downloadAttachmentWithTimeout /
 * inject / resolvePlanResponse / interrupt / _interruptInternal /
 * getPendingInjectCount 方法体原样下沉（仅 ``this`` → ``mgr`` 改显式传参，
 * 行为零变化；类静态 ATTACHMENT_EXT_RE / ATTACHMENT_DOWNLOAD_TIMEOUT_MS
 * 随方法体落位为本模块常量）。
 *
 * @module interactive/session-manager/turn-control
 */

import { basename, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { InjectResult, SessionState } from '../types.js';
import {
  SessionAttachmentTimeoutError,
  SessionNotFoundError,
  SessionNotActiveError,
} from '../types.js';
import type { SessionInjectAttachment } from '../../protocol.js';
import { SessionQueueClosedError } from '../input-queue.js';
import type {
  InteractiveDriverHandle,
  UserTurnInput,
} from '../driver.js';
import type { SessionManagerCore } from './types.js';
import type { SessionManagerDepsWithQueued } from './types.js';

/**
 * 追问：push 新 SDKUserMessage（spike H2/S1）。
 *
 * task-07 增量（R-conv / spike S1 排队检测，非拒绝）：
 *   - status=running（上一 turn 未 result）时 push 仍入 buffer（SDK 在当前 turn result
 *     后按 FIFO 消费 → 新 turn）；额外 pendingInjectCount++ + onTurnQueued 回调通知
 *     backend「排队中」（UI 可提示），让 inject 行为可观察、可解释。
 *   - 绝不拒绝并发 inject（spike S1 实测：priority:'now' 仍排队到下一 turn）。
 *
 * @throws {SessionNotFoundError}
 * @throws {SessionNotActiveError} status ∈ {ended, failed, reconnecting}
 */
/**
 * gap-8.4（design §11）：刷新 session 的 lease 级 claim_token。
 *
 * 恢复路径（restoreAndReconnect）claimToken 占位空串（session-manager.ts:761）；
 * backend SESSION_INJECT 带 rotated claim_token（recover_session_after_daemon_restart
 * step 7 rotate），daemon 收到后调此方法刷新，让后续 onTurnMessage（submitMessages）
 * + onTurnResult（notifyRunResult）能用新 token（否则 warn 不调 → turn 卡）。
 * session 不存在 / token 空 → 静默 no-op。
 */
/**
 * task-09 / ql-20260827-010-e472：附件落盘——内容寻址命名
 * ``{cwd}/attachments/{sha256}.{白名单ext}``（与 backend MinIO 端
 * ``attachments/{user_id}/{sha256}.{ext}`` 同哲学：同内容必同路径）。
 *
 * - 扩展名取展示名后缀白名单化（字母数字 1-8 位；非法/无后缀回退 ``bin``，
 *   对齐 backend storage 的 ``_EXT_RE``）；展示名不进键路径（防穿越 +
 *   消灭同名歧义——旧的同名 (n) 序号机制已废弃）。
 * - 同哈希已存在（``wx`` 独占探测 EEXIST）即跳过写入直接复用：内容寻址
 *   不可变，agent 从路径即可唯一锁定本次发送的文件，无需读目录比对。
 * - 返回相对路径 ``attachments/xxx``（prompt 路径清单用相对形态）。
 */
const ATTACHMENT_EXT_RE = /^[A-Za-z0-9]{1,8}$/;

export async function writeAttachmentFile(
  _mgr: SessionManagerCore,
  cwd: string,
  rawName: string,
  buf: Buffer,
): Promise<string> {
  const dir = join(cwd, 'attachments');
  await mkdir(dir, { recursive: true });
  const safe = basename(rawName) || 'attachment';
  const dot = safe.lastIndexOf('.');
  const rawExt = dot > 0 ? safe.slice(dot + 1).trim().toLowerCase() : '';
  const ext = ATTACHMENT_EXT_RE.test(rawExt) ? rawExt : 'bin';
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const rel = `attachments/${sha256}.${ext}`;
  try {
    await writeFile(join(cwd, rel), buf, { flag: 'wx' });
  } catch (err) {
    // EEXIST = 同内容对象已落盘（不可变）→ 跳过写入直接复用；其余照抛。
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
  return rel;
}

export async function refreshClaimToken(
  mgr: SessionManagerCore,
  sessionId: string,
  claimToken: string,
): Promise<void> {
  const state = mgr._store.get(sessionId);
  if (!state || !claimToken) return;
  state.claimToken = claimToken;
}

/**
 * ql-20260825-f6#3：附件下载超时（ms）。downloadAttachment 闭包由 backend WS 注入，
 * 无信号参数可传，后端 / 网络挂起时 inject 会永久卡在 await——60s 强制收口，
 * 超时抛 SessionAttachmentTimeoutError（带会话 id），由 inject 的单附件 catch
 * 降级为「下载失败: <name>」标注（不中断 turn）。
 */
const ATTACHMENT_DOWNLOAD_TIMEOUT_MS = 60_000;

/**
 * ql-20260825-f6#3：带超时的附件下载。Promise.race 输家（超时后到达的下载
 * settle）由 race 已安装的 handler 吞掉，不产生 unhandled rejection。
 */
export function downloadAttachmentWithTimeout(
  sessionId: string,
  downloadAttachment: (id: string) => Promise<Buffer>,
  attachmentId: string,
): Promise<Buffer> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    downloadAttachment(attachmentId),
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new SessionAttachmentTimeoutError(
              sessionId,
              attachmentId,
              ATTACHMENT_DOWNLOAD_TIMEOUT_MS,
            ),
          ),
        ATTACHMENT_DOWNLOAD_TIMEOUT_MS,
      );
      // node 标准：超时定时器不阻塞 daemon 退出。
      if (typeof timer.unref === 'function') {
        timer.unref();
      }
    }),
  ]).finally(() => {
    // 下载先到（成功 / 失败）：取消等待中的超时定时器。
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
}

export async function inject(
  mgr: SessionManagerCore,
  sessionId: string,
  prompt: string,
  runId: string,
  attachments?: SessionInjectAttachment[],
  downloadAttachment?: (id: string) => Promise<Buffer>,
): Promise<InjectResult> {
  const state = mgr._store.get(sessionId);
  if (!state) {
    throw new SessionNotFoundError(sessionId);
  }
  if (state.status === 'ended' || state.status === 'failed' || state.status === 'reconnecting') {
    throw new SessionNotActiveError(sessionId, state.status);
  }
  // task-08（D-006 软切断）：已超 budget 的 session 拒绝新 turn。当前 turn 已由
  // _onResult → _checkBudgetCutoff 自然 result 完成（不硬杀），后续 inject 在此拦截，
  // 防止「累计再涨」。session 仍 active（不进 ended/failed），budget_exceeded 事件
  // 已在 _checkBudgetCutoff 发出；此处用 SessionNotActiveError（status='ended'）
  // 表达「不再接 inject」语义，与 ended 等价拒绝。
  if (mgr._overBudgetSessions.has(sessionId)) {
    throw new SessionNotActiveError(sessionId, 'ended');
  }

  // ql-20260825-002：消费挂起的首句——本条 inject 即权威首句（prompt/attachments
  // 版本），清除 create 挂起的 metadata fallback（防双提交）。
  const pendingFirst = mgr._pendingFirstPrompt.get(sessionId);
  if (pendingFirst) {
    clearTimeout(pendingFirst.timer);
    mgr._pendingFirstPrompt.delete(sessionId);
  }

  // task-07 排队检测：在切换 status 前抓取「前一 turn 是否未 result」。
  // status=running（driver 正在跑 turn）→ 本条 inject 排队到下一 turn（spike S1）。
  // P0 修复（2026-08-27，服务器重启死锁）：running 态超时（60s 无 result）→
  // 前一 turn 可能已被 backend 终态化（service restart cleanup），SDK query
  // 挂死或 WS 断后 result 永远不会到达 → 排队消息永远不被消费（死锁）。
  // 超时阈值 60s：正常 turn 可跑几分钟，但 result 事件（含长时间思考的
  // heartbeat）不会间隔 60s 无任何回调——超时说明 SDK 通道已断。
  // 强制重置为 active 让本条 inject 直接消费，自愈死锁。
  //
  // 坑 subagent-write-channel（2026-09-03 实证）：该启发式会误伤「仍活着但安静」
  // 的长 turn（长时间无流式回调的工具执行）——翻转后旧 turn 的写类工具调用全撞
  // "session not in running turn"（30 分钟级封锁，turn 真正结束才恢复）。翻转时
  // 记 staleRunResetAt 且不清 currentRunId（正常 result 收尾才清）：写通道守卫据此
  // 在宽限窗内放行（见 _writeChannelGuardDeny）。
  if (
    state.status === 'running' &&
    Date.now() - state.lastActiveAt > 60_000
  ) {
    // eslint-disable-next-line no-console
    console.warn(
      '[session-manager] inject: stale running state detected (>60s no result), ' +
        'resetting to active. Possible backend restart while turn was running. ' +
        '(write-channel grace armed: staleRunResetAt recorded; quiet long turns stay writable)',
      { sessionId, lastActiveAt: state.lastActiveAt },
    );
    state.status = 'active';
    state.staleRunResetAt = Date.now();
    // 清理可能挂起的 pending 计数（旧 turn 的排队消息已无意义）。
    mgr._pendingInjectCount.delete(sessionId);
  }
  const wasRunningBeforeInject = state.status === 'running';

  // spike S1：push 永远进 InputQueue（turn 级串行由 SDK result 边界保证），不拒绝。
  // currentRunId 在前 turn result 收尾前由本 inject 切换（task-04 既有行为，保留）：
  // inject 时 backend 行锁已防重复创建，daemon 侧 currentRunId 反映「即将执行的 run」。
  // task-02（D-009）：push provider-neutral UserTurnInput（不再构造 SDKUserMessage；
  // Claude driver 内部做形态转换，task-03）。
  // 2026-08-20-session-multimodal-attachments task-09：附件消费（deliver 由
  // backend 全权决策）。block=多模态块（内联 data 或经下载闭包回拉）；disk=落盘
  // {cwd}/attachments/{sha256}.{ext}（ql-20260827-010-e472 内容寻址，同内容复用）
  // + text 追加路径清单（注原文件名，明确无需浏览比对其他文件）；单文件失败
  // 降级标注不中断 turn。无附件路径与原 push 逐字一致（零回归）。
  // ql-20260825-f6#3：下载闭包 60s 超时（挂起不卡死 inject）；下载 await 窗口内
  // 会话被 end/fail 收口（queue 已 close）→ push 抛 SessionQueueClosedError，
  // 此处转译为 SessionNotActiveError（不把队列内部错误类泄漏给 WS 调用方）。
  let turnText = prompt;
  let blocks: UserTurnInput['blocks'];
  let filesToFetch: UserTurnInput['filesToFetch'];
  if (attachments && attachments.length > 0) {
    const blockList: NonNullable<UserTurnInput['blocks']> = [];
    // ql-20260827-010-e472：rel → 展示名列表（内容寻址后同内容附件并入同一行，
    // 原文件名并列注记）。
    const savedRelNames = new Map<string, string[]>();
    const fetched: NonNullable<UserTurnInput['filesToFetch']> = [];
    const failedNames: string[] = [];
    for (const att of attachments) {
      try {
        if (att.deliver === 'block') {
          let b64 = att.data;
          if (!b64 && downloadAttachment) {
            // ql-20260825-f6#3：60s 超时（后端挂起不卡死 inject），超时抛
            // SessionAttachmentTimeoutError → 下方 catch 降级标注。
            b64 = (
              await downloadAttachmentWithTimeout(
                sessionId,
                downloadAttachment,
                att.id,
              )
            ).toString('base64');
          }
          if (!b64) {
            failedNames.push(att.name);
            continue;
          }
          if (att.media_type === 'application/pdf') {
            blockList.push({ type: 'document', mediaType: 'application/pdf', base64: b64 });
          } else {
            blockList.push({ type: 'image', mediaType: att.media_type, base64: b64 });
          }
        } else {
          if (!downloadAttachment) {
            failedNames.push(att.name);
            continue;
          }
          const buf = await downloadAttachmentWithTimeout(
            sessionId,
            downloadAttachment,
            att.id,
          );
          const rel = await writeAttachmentFile(mgr, state.cwd, att.name, buf);
          const names = savedRelNames.get(rel);
          if (names) {
            if (!names.includes(att.name)) names.push(att.name);
          } else {
            savedRelNames.set(rel, [att.name]);
          }
          fetched.push({ id: att.id, name: att.name });
        }
      } catch {
        failedNames.push(att.name);
      }
    }
    if (blockList.length > 0) blocks = blockList;
    if (fetched.length > 0) filesToFetch = fetched;
    const lines: string[] = [];
    if (savedRelNames.size > 0) {
      // ql-20260827-010-e472：清单行 = 内容寻址路径 + 原文件名注记；头部明确
      // 「只读列出的路径」，消除旧 (1)(2) 序号下 agent 全目录读比对的歧义。
      lines.push(
        '[附件已落盘，直接读取以下列出的路径即可；attachments/ 下其他文件与本次发送无关，无需浏览比对]',
      );
      for (const [rel, names] of savedRelNames) {
        lines.push('- ' + rel + '（原文件名: ' + names.join('、') + '）');
      }
    }
    for (const n of failedNames) lines.push('(下载失败: ' + n + ')');
    if (lines.length > 0) {
      turnText = (prompt ? prompt + '\n\n' : '') + lines.join('\n');
    }
  }
  try {
    state.inputQueue.push(
      blocks || filesToFetch
        ? { type: 'user', text: turnText, ...(blocks ? { blocks } : {}), ...(filesToFetch ? { filesToFetch } : {}) }
        : { type: 'user', text: turnText },
    );
  } catch (err) {
    if (err instanceof SessionQueueClosedError) {
      // ql-20260825-f6#3：附件下载 await 窗口内 end()/fail() 已收口（inputQueue
      // 被 close）→ 转译为既有「会话已结束」语义错误（WS 调用方按
      // SessionNotActiveError 统一处理），不把队列内部错误类泄漏给上层。
      // status 此刻已是终态（queue 仅 terminate 链会 close），如实透传。
      throw new SessionNotActiveError(sessionId, state.status);
    }
    throw err;
  }
  state.currentRunId = runId;
  state.status = 'running';
  state.lastActiveAt = Date.now();
  // task-10：inject push 后排队 flush（含 currentRunId，崩溃对账用）。
  mgr._scheduleFlush();

  if (wasRunningBeforeInject) {
    // 本条 inject 排在前一未 result turn 之后（spike S1 QUEUED 语义）。
    const next = (mgr._pendingInjectCount.get(sessionId) ?? 0) + 1;
    mgr._pendingInjectCount.set(sessionId, next);
    // onTurnQueued 可选（types.ts 的 SessionManagerDeps 未声明该字段，结构探测消费，
    // 不改 task-04 接口签名）。未注入则只计数不通知，不报错。
    const cb = (mgr.deps as SessionManagerDepsWithQueued).onTurnQueued;
    if (typeof cb === 'function') {
      await cb(sessionId, runId, next);
    }
  } else {
    // 首条 inject（无前置 turn 在跑）：确保计数存在且为 0（_onResult 递减不会负）。
    if (!mgr._pendingInjectCount.has(sessionId)) {
      mgr._pendingInjectCount.set(sessionId, 0);
    }
  }

  return { runId };
}

/**
 * task-02 verify P0 返工（FR-02 / D-001@v1）：用户 plan 决策送达当前会话。
 *
 * daemon 收到 WS ``daemon:plan_response``（用户在 Web 端 PlanApprovalCard 选择
 * confirm/revise/cancel，backend 落库后推送）后经此方法把决策注入 turn：
 * 决策格式化为用户消息，复用 inject 进 InputQueue——当前 turn 在跑则排队到
 * 下一 turn（spike S1 语义），turn 已结束则直接开新 turn，Agent 据此继续执行 /
 * 修订计划 / 终止。
 *
 * 新旧校验：run_id 与 state.currentRunId 不一致（决策属于更早的 plan 轮，会话
 * 已推进到后续 turn）→ warn 丢弃返回 false，不回注旧消息（inject 会把
 * currentRunId 切回旧 run，污染日志归属）。currentRunId 为空（恢复后尚未有
 * turn）时放行——inject 会顺带回填。
 *
 * 全部失败路径（session 不存在 / 已终态 / inject 抛错）只 warn 返回 false，
 * 不向上抛——决策已在 backend session.config 落库，可经 UI 重发。
 */
export async function resolvePlanResponse(
  mgr: SessionManagerCore,
  sessionId: string,
  runId: string,
  decision: 'confirm' | 'revise' | 'cancel',
  feedback?: string | null,
): Promise<boolean> {
  const state = mgr._store.get(sessionId);
  if (!state) {
    // eslint-disable-next-line no-console
    console.warn('[session-manager] plan_response_session_not_found', { sessionId });
    return false;
  }
  if (state.status === 'ended' || state.status === 'failed' || state.status === 'reconnecting') {
    // eslint-disable-next-line no-console
    console.warn('[session-manager] plan_response_session_inactive', {
      sessionId,
      status: state.status,
    });
    return false;
  }
  if (state.currentRunId && state.currentRunId !== runId) {
    // eslint-disable-next-line no-console
    console.warn('[session-manager] plan_response_stale_run', {
      sessionId,
      planRunId: runId,
      currentRunId: state.currentRunId,
    });
    return false;
  }
  const trimmed = (feedback ?? '').trim();
  let message: string;
  if (decision === 'confirm') {
    message = '【计划确认】用户已确认当前计划，请按计划继续执行。';
  } else if (decision === 'revise') {
    message =
      '【计划修订】用户要求修改计划后再执行。修改意见：' +
      (trimmed || '（未填写）') +
      '。请据此调整计划；如需再次确认，请重新提交计划摘要。';
  } else {
    message =
      '【计划取消】用户已取消当前计划。原因：' +
      (trimmed || '（未填写）') +
      '。请停止执行该计划的后续步骤，并简要总结当前进展。';
  }
  try {
    await mgr.inject(sessionId, message, runId);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[session-manager] plan_response_inject_failed', {
      sessionId,
      runId,
      decision,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
  return true;
}

/**
 * spike D1：turn 级 interrupt。
 *   - session 不存在 / 无 query → no-op false
 *   - status=active（无 running turn）→ no-op false
 *   - status=running → driver.interrupt(query)，返回其结果
 *
 * task-07 增量：interrupt 本身不改 status（spike D1：终态由 _onResult 按 SDK 实际
 * result subtype=error_during_execution 收尾）；但更新 lastActiveAt（算用户活动）。
 * driver.interrupt 返回 false（q=null/已结束）→ SessionManager 保守返回 false，不改
 * status、不调 onTurnResult（避免对已结束 query 误标 failed）。
 */
export async function interrupt(
  mgr: SessionManagerCore,
  sessionId: string,
): Promise<boolean> {
  const state = mgr._store.get(sessionId);
  if (!state) return false;
  if (state.status !== 'running') return false;
  // task-02（D-001/FR-03）：按 session 归属 driver interrupt（不用全局 deps.driver），
  // 避免 codex session 误调 ClaudeSdkDriver.interrupt(null) 静默失效。target 按 provider 选。
  const interrupted = await interruptInternal(mgr, state);
  if (interrupted) {
    // interrupt 信号本身不等同 run 终态（spike D1：等 SDK 吐 result subtype=
    // error_during_execution 才收敛）。但算用户活动（影响空闲回收）。
    state.lastActiveAt = Date.now();
    // task-08：interrupt 已生效，pending 审批不再有意义 → abortAll deny。
    mgr._resolversBySession.get(sessionId)?.abortAll('session_interrupted');
    // task-08（FR-02）：运行中 Bash 追踪已下沉归一化器（随 SDK 进程消亡），
    // 此处不再清 daemon 侧索引（旧 _clearRunningBashCommands 已移除）。
    // task-10：interrupt 后排队 flush（currentRunId 仍在，等 result 收尾）。
    mgr._scheduleFlush();
  }
  return interrupted;
}

/**
 * task-02（D-001/FR-03）：provider-neutral interrupt 内部实现。interrupt 与
 * _onIdleExpire 复用。按 `state.driver`（fallback `_drivers.claude` 兼容旧 state）
 * + 按 provider 选 target（claude=query / codex=driverHandle）调用 driver.interrupt。
 * 无 driver / 无 target → 返回 false（不抛）。
 */
export async function interruptInternal(
  mgr: SessionManagerCore,
  state: SessionState,
): Promise<boolean> {
  const driver = state.driver ?? mgr._drivers.claude;
  if (!driver) return false;
  // 按 provider 选 target：claude=query / codex=driverHandle。缺省 null（与原
  // `state.query ?? null` 语义一致，FR-10 不回退：query undefined 时仍调
  // driver.interrupt(null) 让 driver 自行 no-op 返回 false）。
  const rawTarget =
    state.provider === 'claude' ? state.query : state.driverHandle;
  const target = (rawTarget ?? null) as InteractiveDriverHandle | null;
  try {
    return await driver.interrupt(target);
  } catch {
    // interrupt 抛错保守返回 false（不冒泡，与现有 ClaudeSdkDriver.interrupt no-op 一致）。
    return false;
  }
}

/**
 * task-07（R-conv 可观察性）：查询某 session 当前排队中的 inject 计数。
 * session 不存在或无排队返回 0。
 */
export function getPendingInjectCount(
  mgr: SessionManagerCore,
  sessionId: string,
): number {
  return mgr._pendingInjectCount.get(sessionId) ?? 0;
}
