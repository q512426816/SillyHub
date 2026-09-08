/**
 * interactive/session-manager/notify-chain.ts —— per-session 终态通知串行链。
 *
 * task-02（2026-09-07-arch-large-file-split）：原 SessionManager._runNotifyChain
 * 方法体原样下沉（仅 ``this`` → ``mgr`` 改显式传参，行为零变化）。
 *
 * @module interactive/session-manager/notify-chain
 */

import type { SessionManagerCore } from './types.js';

/**
 * ql-20260825-f6#4：把终态通知（onTurnResult / onSessionEnd）排入 per-session
 * 串行链执行。返回值保留原 promise 的 settle 语义（含 rejection，向上传播不变）。
 *
 * 空链时**同步直调** fn（与改造前直调时序逐字一致——consume 逐条 await 下同会话
 * turn result 本就顺序执行，空链排队只多一跳 microtask 无增益，且既有调用方 /
 * 测试依赖 emitResult 后同步可见）；有在飞通知时排队（等其 settle 再执行 fn）。
 */
export function runNotifyChain<T>(
  mgr: SessionManagerCore,
  sessionId: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  const settleTail = (run: Promise<T>): void => {
    // 链尾永不 reject（供下一轮 await；rejection 已由调用方 await run 传播）。
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    mgr._notifyChains.set(sessionId, tail);
    void tail.then(() => {
      // 自愈摘除：本轮回 finish 且没有更新一轮入链时删掉链尾（比较引用防误删后轮）。
      if (mgr._notifyChains.get(sessionId) === tail) {
        mgr._notifyChains.delete(sessionId);
      }
    });
  };

  const prev = mgr._notifyChains.get(sessionId);
  if (!prev) {
    // 空链：同步执行（Promise.resolve 容忍 fn 返回非 promise，对齐 await 语义）。
    // fn 同步抛 → 链尾直接放行（空跳，下一轮通知不等错）+ 向上重抛
    //（与直调的同步抛时序一致）。
    let run: Promise<T>;
    try {
      run = Promise.resolve(fn());
    } catch (err) {
      settleTail(Promise.resolve() as Promise<T>);
      throw err;
    }
    settleTail(run);
    return run;
  }
  const run = prev.catch(() => undefined).then(fn);
  settleTail(run);
  return run;
}
